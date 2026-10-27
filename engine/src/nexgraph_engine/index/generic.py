"""Bộ chuyển đổi cho các ngôn ngữ ngoài Dart (đồ thị chung, spec §6.3 mục 3).

Gọi bộ trích xuất đa ngôn ngữ cho từng tệp một vì id của nó (dựa trên tên tệp không kèm thư mục) có thể trùng giữa các thư mục.
Bộ trích xuất này chỉ cho dòng bắt đầu nên `line_end` là ước lượng: dòng lớn nhất trong bằng chứng của các cạnh xuất phát từ nút.
"""
from __future__ import annotations

import atexit
import re
import tempfile
from pathlib import Path

from graphify.extract import extract

from nexgraph_engine.dart.extractor import FileExtraction
from nexgraph_engine.ids import file_node_id, node_id
from nexgraph_engine.schema.enums import Confidence, EdgeType, NodeKind, Origin
from nexgraph_engine.store.models import Edge, Node, UnresolvedRef

_cache_dir: tempfile.TemporaryDirectory | None = None


def _cache_root() -> Path:
    # Một thư mục cache duy nhất cho cả tiến trình (bộ trích xuất cảnh báo khi đổi cache root giữa các lần gọi).
    global _cache_dir
    if _cache_dir is None:
        _cache_dir = tempfile.TemporaryDirectory(prefix="nexgraph-extract-")
        atexit.register(_cache_dir.cleanup)
    return Path(_cache_dir.name)


def _line(loc: str | None) -> int | None:
    m = re.match(r"L(\d+)", loc or "")
    return int(m.group(1)) if m else None


def extract_generic(root: Path, rel_path: str, language: str, *, is_test: bool) -> FileExtraction:
    path = Path(root) / rel_path
    if not path.is_file():
        return FileExtraction(errors=[("read", f"Không đọc được {rel_path}")])
    try:
        result = extract([path], cache_root=_cache_root(), root=Path(root), parallel=False)
    except Exception as exc:  # bộ trích xuất có thể ném lỗi trên cú pháp lạ; không để job dừng
        return FileExtraction(errors=[("extract", f"Bộ trích xuất lỗi: {exc}")])
    if result.get("failed_sources"):
        return FileExtraction(errors=[("extract", f"Bộ trích xuất không đọc được {rel_path} ({language})")])

    fid = file_node_id(rel_path)
    base = path.name
    raw = {n["id"]: n for n in result["nodes"] if n.get("label") != base and n.get("_callable")}
    raw_edges = result["edges"]

    parent_class: dict[str, str] = {e["target"]: e["source"] for e in raw_edges if e["relation"] == "method"}
    qnames: dict[str, tuple[str, NodeKind]] = {}
    for gid, n in raw.items():
        name = _plain_name(raw, gid)
        if n.get("_callable_class"):
            qnames[gid] = (name, NodeKind.CLASS)
        elif gid in parent_class and parent_class[gid] in raw:
            qnames[gid] = (f"{_plain_name(raw, parent_class[gid])}.{name}", NodeKind.METHOD)
        else:
            qnames[gid] = (name, NodeKind.FUNCTION)
    ids: dict[str, str] = {}
    used: set[str] = set()
    for gid in sorted(qnames, key=lambda g: _line(raw[g].get("source_location")) or 1):
        q, k = qnames[gid]
        nid = node_id(rel_path, q, k)
        if nid in used:  # hàm lồng cùng tên, hoặc khai báo lặp: cùng quy ước `@dòng` với Dart
            nid = node_id(rel_path, f"{q}@{_line(raw[gid].get('source_location')) or 1}", k)
        used.add(nid)
        ids[gid] = nid

    # line_end ước lượng: dòng lớn nhất trong bằng chứng các cạnh đi ra; lớp bao luôn các phương thức của nó.
    end: dict[str, int] = {gid: _line(raw[gid].get("source_location")) or 1 for gid in raw}
    for e in raw_edges:
        if e["source"] in end and e["relation"] in ("calls", "imports", "imports_from"):
            end[e["source"]] = max(end[e["source"]], _line(e.get("source_location")) or 0)
    for child, cls in parent_class.items():
        if cls in end and child in end:
            end[cls] = max(end[cls], end[child])

    nodes = [
        Node(id=ids[gid], kind=qnames[gid][1], label=qnames[gid][0].split(".")[-1], qualified_name=qnames[gid][0],
             file=rel_path, line_start=_line(raw[gid].get("source_location")) or 1, line_end=end[gid],
             is_test=is_test, origin=Origin.AST)
        for gid in raw
    ]
    edges: list[Edge] = []
    refs: list[UnresolvedRef] = []
    for e in raw_edges:
        rel, src, dst, line = e["relation"], e["source"], e["target"], _line(e.get("source_location"))
        conf = Confidence.INFERRED if e.get("confidence") == "INFERRED" else Confidence.EXTRACTED
        score = 1.0 if conf == Confidence.EXTRACTED else 0.8
        if rel in ("contains", "method"):
            parent = ids.get(src) if rel == "method" else fid
            if parent and dst in ids:
                edges.append(Edge(source=parent, target=ids[dst], type=EdgeType.DEFINES))
        elif rel in ("imports", "imports_from") and line:
            refs.append(UnresolvedRef(source=fid, name=dst, type=EdgeType.IMPORTS, line=line, col=0))
        elif rel == "calls" and src in ids and line:
            if dst in ids:
                edges.append(Edge(source=ids[src], target=ids[dst], type=EdgeType.CALLS, confidence=conf,
                                  confidence_score=score, line=line,
                                  subtype="construct" if qnames[dst][1] == NodeKind.CLASS else None))
            else:
                refs.append(UnresolvedRef(source=ids[src], name=dst, type=EdgeType.CALLS, line=line, col=0))
        elif rel == "inherits" and src in ids and line:
            refs.append(UnresolvedRef(source=ids[src], name=dst, type=EdgeType.INHERITS, line=line, col=0))
    return FileExtraction(nodes=nodes, edges=edges, refs=refs)


def _plain_name(raw: dict, gid: str) -> str:
    return re.sub(r"\(\)$", "", raw[gid]["label"]).lstrip(".")
