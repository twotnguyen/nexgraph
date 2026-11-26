"""Nguồn bổ sung (W11): lược đồ PostgreSQL, Cargo workspace, manifest gói, SCIP JSON, cấu hình MCP.

Mỗi nguồn là một tệp ảo `nguon://<nguồn>` (RB11 bắt mọi nút phải thuộc một tệp). Đường dẫn thật không bao giờ chứa
`://` nên không trùng tệp thật; refresh và độ mới bỏ qua các tệp này. DSN chỉ nằm trong bộ nhớ khi job chạy.
"""
from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from nexgraph_engine.adapters.graphify.ingest import introspect_cargo
from nexgraph_engine.adapters.graphify.ingest import extract_package_manifest
from nexgraph_engine.adapters.graphify.ingest import extract_mcp_config
from nexgraph_engine.adapters.graphify.ingest import ingest_scip_json

from nexgraph_engine.ids import REPOSITORY_ID, file_node_id, node_id
from nexgraph_engine.index.discovery import discover
from nexgraph_engine.schema.enums import Confidence, EdgeType, NodeKind, Origin
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.models import Edge, FileRec, Node

PREFIX = "nguon://"
MAX_FILE_BYTES = 16 * 1024 * 1024  # SCIP JSON 28 MB đã đẩy RSS lên 824 MB (json.loads + ingest giữ cả cây)


def introspect_postgres(dsn: str) -> dict:
    # Import muộn: graphify.pg_introspect cần psycopg (không đóng gói), test thay hàm này bằng mock.
    from nexgraph_engine.adapters.graphify.ingest import introspect_postgres as real
    return real(dsn)


@dataclass(frozen=True)
class ExtraSources:
    postgres_dsn: str | None = field(default=None, repr=False)
    cargo: bool = False
    manifests: bool = False
    scip_files: tuple[str, ...] = ()
    mcp_files: tuple[str, ...] = ()

    def any(self) -> bool:
        return bool(self.postgres_dsn or self.cargo or self.manifests or self.scip_files or self.mcp_files)


def is_source_path(rel_path: str) -> bool:
    return rel_path.startswith(PREFIX)


def is_source_language(language: str) -> bool:
    return language.startswith("nguon_")


# --- ánh xạ graphify → NexGraph -------------------------------------------------------------------
_RELATIONS: dict[str, EdgeType] = {
    "contains": EdgeType.DEFINES, "scip_def": EdgeType.DEFINES,
    "depends_on": EdgeType.DEPENDS_ON, "crate_depends_on": EdgeType.DEPENDS_ON,
    "scip_impl": EdgeType.IMPLEMENTS, "scip_typed": EdgeType.USES_TYPE, "calls": EdgeType.CALLS,
}  # còn lại (references, reads_from, writes_to, requires_env, scip_ref…) → REFERENCES
_NEEDS_LINE = {EdgeType.CALLS, EdgeType.IMPLEMENTS, EdgeType.REFERENCES, EdgeType.USES_TYPE}  # RB12
_SCIP_KINDS = [("class", NodeKind.CLASS), ("enum", NodeKind.ENUM), ("method", NodeKind.METHOD),
               ("constructor", NodeKind.METHOD), ("function", NodeKind.FUNCTION), ("macro", NodeKind.FUNCTION),
               ("module", NodeKind.MODULE), ("namespace", NodeKind.MODULE), ("package", NodeKind.MODULE),
               ("field", NodeKind.VARIABLE), ("variable", NodeKind.VARIABLE), ("constant", NodeKind.VARIABLE),
               ("property", NodeKind.VARIABLE), ("parameter", NodeKind.VARIABLE)]
_MCP_KINDS = {"mcp_config_file": NodeKind.MODULE, "mcp_server": NodeKind.RESOURCE, "mcp_command": NodeKind.RESOURCE,
              "mcp_package": NodeKind.PACKAGE, "env_var": NodeKind.CONFIG_KEY}


def _postgres_kind(n: dict) -> NodeKind | None:
    if n.get("source_location") is None:  # nút gốc của extract_sql đại diện cho cả CSDL = tệp ảo
        return None
    return NodeKind.FUNCTION if str(n.get("label", "")).endswith("()") else NodeKind.TABLE


def _scip_kind(n: dict) -> NodeKind:
    kind = str((n.get("metadata") or {}).get("scip_kind", "")).lower()
    return next((k for key, k in _SCIP_KINDS if key in kind), NodeKind.TYPE)


def _mcp_kind(n: dict) -> NodeKind:
    return _MCP_KINDS.get((n.get("metadata") or {}).get("mcp_kind", ""), NodeKind.RESOURCE)


def _line(loc: object) -> int | None:
    m = re.match(r"L(\d+)", loc if isinstance(loc, str) else "")
    return int(m.group(1)) or None if m else None


def convert(vpath: str, kind_of: Callable[[dict], NodeKind | None], results: list[dict]) -> tuple[list[Node], list[Edge]]:
    """Kết quả graphify `{nodes, edges}` → nút/cạnh của tệp ảo. `kind_of` trả None cho nút đại diện chính tệp."""
    fid = file_node_id(vpath)
    raw: dict[str, dict] = {}
    for r in results:
        for n in r.get("nodes", []):
            if isinstance(n, dict) and n.get("id"):
                raw.setdefault(n["id"], n)
    ids: dict[str, str] = {}
    meta: dict[str, tuple[NodeKind, str, int]] = {}
    for gid, n in raw.items():
        kind = kind_of(n)
        if kind is None:
            ids[gid] = fid
            continue
        q = re.sub(r"\(\)$", "", str(n.get("label") or gid)).replace('"', "") or gid
        nid = node_id(vpath, q, kind)
        if nid in meta:
            nid = node_id(vpath, f"{q}@{gid}", kind)
        ids[gid] = nid
        meta[nid] = (kind, q, _line(n.get("source_location")) or 1)
    end = {nid: start for nid, (_, _, start) in meta.items()}
    edges: list[Edge] = []
    for r in results:
        for e in r.get("edges", []):
            src, dst = ids.get(e.get("source")), ids.get(e.get("target"))
            if not src or not dst or src == dst:
                continue  # graphify cũng bỏ cạnh treo (gói ngoài không có manifest)
            rel = str(e.get("relation", ""))
            etype = _RELATIONS.get(rel, EdgeType.REFERENCES)
            line = _line(e.get("source_location"))
            if line is None and etype in _NEEDS_LINE:
                line = meta[src][2] if src in meta else 1
            if line and src in end:
                end[src] = max(end[src], line)  # RB22: khoảng dòng của nút nguồn phải chứa dòng bằng chứng
            conf = Confidence.INFERRED if e.get("confidence") == "INFERRED" else Confidence.EXTRACTED
            edges.append(Edge(source=src, target=dst, type=etype, subtype=None if rel == "contains" or rel.upper() == etype.value else rel[:50],
                              confidence=conf, confidence_score=1.0 if conf == Confidence.EXTRACTED else 0.8, line=line))
    defined = {e.target for e in edges if e.type == EdgeType.DEFINES}
    edges += [Edge(source=fid, target=nid, type=EdgeType.DEFINES) for nid in meta if nid not in defined]
    nodes = [Node(id=nid, kind=k, label=q[:255], qualified_name=q, file=vpath, line_start=start, line_end=end[nid],
                  origin=Origin.AST) for nid, (k, q, start) in meta.items()]
    return nodes, edges


# --- đọc từng nguồn ---------------------------------------------------------------------------------
def _resolve(root: Path, p: str) -> Path:
    path = Path(p).expanduser()
    return path if path.is_absolute() else root / path


def _read_files(root: Path, paths: tuple[str, ...], read: Callable[[Path], dict]) -> tuple[list[dict], list[str]]:
    results, errors = [], []
    for p in paths:
        path = _resolve(root, p)
        try:
            if not path.is_file():
                errors.append(f"Không thấy tệp {p}")
                continue
            if path.stat().st_size > MAX_FILE_BYTES:
                errors.append(f"{p} lớn hơn {MAX_FILE_BYTES // (1024 * 1024)} MB")
                continue
            result = read(path)
        except Exception as exc:  # noqa: BLE001 — tệp người dùng chọn có thể hỏng bất kỳ kiểu nào
            errors.append(f"{p}: {type(exc).__name__}: {exc}")
            continue
        if result.get("error"):
            errors.append(f"{p}: {result['error']}")
        else:
            results.append(result)
    return results, errors


def _read_scip(path: Path) -> dict:
    try:
        doc = json.loads(path.read_text(encoding="utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        # shortcut: chỉ nhận dạng JSON như graphify; nâng lên khi cần đọc tệp protobuf `index.scip` của scip-*.
        return {"error": "chỉ nhận SCIP dạng JSON"}
    if not isinstance(doc, dict) or not isinstance(doc.get("documents"), list):
        return {"error": "SCIP JSON sai cấu trúc (cần đối tượng có mảng documents)"}  # vendor sẽ lặng lẽ trả rỗng
    return ingest_scip_json(doc, source_file=path.name)


def _with_timeout(dsn: str) -> str:
    """CSDL không trả lời thì job index không được treo theo timeout mặc định (vô hạn) của libpq."""
    if "connect_timeout" in dsn:
        return dsn
    if "://" in dsn:
        return dsn + ("&" if "?" in dsn else "?") + "connect_timeout=10"
    return dsn + " connect_timeout=10"


def _postgres(dsn: str) -> tuple[list[dict], list[str]]:
    try:
        return [introspect_postgres(_with_timeout(dsn))], []
    except ImportError:
        return [], ["Cần cài psycopg vào môi trường engine để đọc PostgreSQL"]
    except ConnectionError as exc:  # vendor đã cắt thông báo của psycopg về dòng đầu, không mang DSN
        return [], [f"Không kết nối được PostgreSQL: {str(exc).replace(dsn, '***')}"]
    except Exception as exc:  # noqa: BLE001 — lỗi khác (DSN sai cú pháp…) có thể trích lại DSN: chỉ ghi tên kiểu lỗi
        return [], [f"Không đọc được PostgreSQL ({type(exc).__name__}). Kiểm tra lại chuỗi kết nối."]


def _cargo(root: Path) -> tuple[list[dict], list[str]]:
    try:
        return [introspect_cargo(root)], []
    except OSError:
        return [], ["Không thấy Cargo.toml ở gốc dự án (hoặc sâu 2 cấp)"]
    except Exception as exc:  # noqa: BLE001 — TOML hỏng
        return [], [f"Cargo.toml lỗi: {exc}"]


def ingest_sources(store: GraphStore, run_id: int, root: Path, sources: ExtraSources, *, subdir: str | None = None,
                   exclude: list[str] | None = None, cancel: threading.Event | None = None) -> None:
    """Đọc các nguồn đã bật rồi ghi mỗi nguồn thành một tệp ảo. Lỗi của nguồn thành lỗi phân tích, không dừng job."""
    root = Path(root)
    jobs: list[tuple[str, Callable[[dict], NodeKind | None], Callable[[], tuple[list[dict], list[str]]]]] = []
    if sources.postgres_dsn:
        jobs.append(("postgres", _postgres_kind, lambda: _postgres(sources.postgres_dsn or "")))
    if sources.cargo:
        jobs.append(("cargo", lambda n: NodeKind.PACKAGE, lambda: _cargo(root)))
    if sources.manifests:
        manifests = tuple(f.rel_path for f in discover(root, subdir=subdir, exclude=exclude, include_config=True)
                          if f.language == "package_manifest")
        jobs.append(("manifest", lambda n: NodeKind.PACKAGE, lambda: _read_files(root, manifests, extract_package_manifest)))
    if sources.scip_files:
        jobs.append(("scip", _scip_kind, lambda: _read_files(root, sources.scip_files, _read_scip)))
    if sources.mcp_files:
        jobs.append(("mcp", _mcp_kind, lambda: _read_files(root, sources.mcp_files, extract_mcp_config)))
    for name, kind_of, read in jobs:
        if cancel is not None and cancel.is_set():
            return
        results, errors = read()
        vpath = PREFIX + name
        nodes, edges = convert(vpath, kind_of, results)
        blob = json.dumps([[n.id for n in nodes], [(e.source, e.target, e.type) for e in edges]]).encode()
        store.add_file(run_id, FileRec(vpath, f"nguon_{name}", len(blob), int(time.time()),
                                       hashlib.sha256(blob).hexdigest()))
        store.add_nodes([Node(id=file_node_id(vpath), kind=NodeKind.FILE, label=vpath, qualified_name=vpath,
                              file=vpath), *nodes])
        store.add_edges([Edge(source=REPOSITORY_ID, target=file_node_id(vpath), type=EdgeType.CONTAINS), *edges])
        if errors:
            store.add_file_error(vpath, "extract", "; ".join(errors)[:2000])
    store.commit()
