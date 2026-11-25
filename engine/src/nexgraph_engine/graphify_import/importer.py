"""NG-IMP-1 — nạp `graph.json` của Graphify vào `graph.db` (ADR 0023).

Đồ thị nguồn là `graph.json` do pipeline Graphify ghi vào `<dự án>/.nexgraph/`; SQLite chỉ là
chỉ mục truy vấn. Bộ nạp không trích xuất lại mã nguồn: nó ánh xạ thẳng nút/cạnh/cộng đồng,
sinh `TESTED_BY` bằng `impact.tested_by`, và (NG-IMP-2) bổ sung các trường graph.json không có
bằng cách đọc lại từng tệp một.

Id giữ ổn định giữa các lần nạp: nút ký hiệu là `<id vendor>#<kind>`, nút tệp là
`nexgraph_engine.ids.file_node_id(rel_path)` để `impact.analyze` tìm được hạt giống `…​#file`.
"""
from __future__ import annotations

import hashlib
import json
import time
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from nexgraph_engine.graphify_import.enrich import enrich_missing_fields
from nexgraph_engine.graphify_import.mapping import (
    EXTERNAL_FILE, NEEDS_EVIDENCE, normalise_rel_path, origin_of, parse_location, relation_to_edge,
)
from nexgraph_engine.graphify_import.paths import resolve_inside_root, root_realpath
from nexgraph_engine.ids import file_node_id
from nexgraph_engine.impact.tested_by import derive_tested_by
from nexgraph_engine.index.discovery import is_test_path, language_of
from nexgraph_engine.index.keywords import search_keywords
from nexgraph_engine.schema.enums import Confidence, EdgeType, NodeKind, Origin
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.models import FileRec

CHUNK = 2000
_ZERO_SHA = "0" * 64
_CODE_KINDS = (NodeKind.CLASS, NodeKind.FUNCTION, NodeKind.METHOD)
# Tên cộng đồng đã đặt (AI/người dùng) được giữ khi tập thành viên đổi nhưng còn đủ trùng.
_KEEP_NAME_JACCARD = 0.8


@dataclass(frozen=True)
class CommunityRow:
    key: int
    name: str
    cohesion: float | None


@dataclass(frozen=True)
class NodeRow:
    """Một nút đã ánh xạ, chưa ghi CSDL (dùng chung cho nạp đầy đủ và nạp tăng dần)."""

    gid: str
    node_id: str
    kind: NodeKind
    label: str
    qualified_name: str
    file: str
    line_start: int | None
    line_end: int | None
    origin: Origin
    doc: str | None
    community: int | None


@dataclass(frozen=True)
class EdgeRow:
    source: str  # node_id, không phải id vendor
    target: str
    type: EdgeType
    subtype: str | None
    confidence: Confidence
    score: float
    origin: Origin
    line: int | None


@dataclass
class ParsedGraph:
    """Kết quả đọc graph.json, chưa phụ thuộc CSDL."""

    files: list[str] = field(default_factory=list)
    communities: list[CommunityRow] = field(default_factory=list)
    nodes: list[NodeRow] = field(default_factory=list)
    edges: list[EdgeRow] = field(default_factory=list)
    kinds: dict[str, int] = field(default_factory=dict)
    built_at_commit: str | None = None
    degraded_no_line: int = 0
    skipped_nodes: int = 0
    skipped_edges: int = 0
    rejected_paths: list[str] = field(default_factory=list)

    def node_by_id(self) -> dict[str, NodeRow]:
        return {n.node_id: n for n in self.nodes}


@dataclass(frozen=True)
class ImportReport:
    graph_json: str
    files: int
    nodes: int
    edges: int
    communities: int
    tested_by: int
    skipped_nodes: int
    skipped_edges: int
    degraded_no_line: int
    missing_files: tuple[str, ...]
    kinds: dict[str, int]
    enriched_nodes: int
    estimated_nodes: int
    rejected_paths: tuple[str, ...]
    seconds: float


def _chunks(items: list, size: int = CHUNK):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _confidence(raw: object) -> Confidence:
    return Confidence(raw) if raw in ("EXTRACTED", "INFERRED", "AMBIGUOUS") else Confidence.INFERRED


def _score(raw: object, confidence: Confidence) -> float:
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        return max(0.0, min(1.0, float(raw)))
    return 1.0 if confidence is Confidence.EXTRACTED else 0.6


def _load_cohesion(analysis_path: Path | None) -> dict[str, float]:
    if analysis_path is None or not analysis_path.is_file():
        return {}
    try:
        raw = json.loads(analysis_path.read_text(encoding="utf-8")).get("cohesion") or {}
    except (OSError, ValueError):
        return {}
    out: dict[str, float] = {}
    for key, value in raw.items():
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            out[str(key)] = max(0.0, min(1.0, float(value)))
    return out


def load_graph_json(graph_json_path: Path) -> dict:
    """Đọc graph.json; lỗi định dạng là lỗi thật (không im lặng nạp đồ thị rỗng)."""
    data = json.loads(Path(graph_json_path).read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("nodes"), list) or not isinstance(data.get("links"), list):
        raise ValueError(f"graph.json không đúng định dạng node-link: {graph_json_path}")
    return data


def parse_graph(graph_json_path: Path, *, root: Path, analysis_path: Path | None = None,
                sourceless: str = "external") -> ParsedGraph:
    """Ánh xạ graph.json → các hàng chờ ghi. Hàm thuần, không mở CSDL."""
    data = load_graph_json(graph_json_path)
    raw_nodes: list[dict] = data["nodes"]
    raw_links: list[dict] = data["links"]
    root = Path(root).resolve()

    # ---- tệp ---------------------------------------------------------------------
    files: set[str] = set()
    node_file: dict[int, str] = {}
    rejected: set[str] = set()
    need_external = False
    for index, node in enumerate(raw_nodes):
        raw = node.get("source_file")
        rel = normalise_rel_path(raw, root)
        node_file[index] = rel
        if rel:
            files.add(rel)
        else:
            if isinstance(raw, str) and raw.strip():
                rejected.add(raw.strip())
            if sourceless == "external":
                need_external = True
    for link in raw_links:
        raw = link.get("source_file")
        rel = normalise_rel_path(raw, root)
        if rel:
            files.add(rel)
        elif isinstance(raw, str) and raw.strip():
            rejected.add(raw.strip())
    if need_external:
        files.add(EXTERNAL_FILE)

    # ---- cộng đồng ----------------------------------------------------------------
    cohesion = _load_cohesion(analysis_path)
    names: dict[int, str] = {}
    for node in raw_nodes:
        cid, name = node.get("community"), node.get("community_name")
        if cid is not None and name and int(cid) not in names:
            names[int(cid)] = str(name)[:200]
    community_ids = sorted({int(node["community"]) for node in raw_nodes if node.get("community") is not None})
    communities = [CommunityRow(key=cid, name=names.get(cid, f"Community {cid}"),
                               cohesion=cohesion.get(str(cid))) for cid in community_ids]

    # ---- nút -----------------------------------------------------------------------
    file_node_gid: dict[str, str] = {}
    for index, node in enumerate(raw_nodes):
        rel = node_file[index]
        if rel and (node.get("label") == rel.rsplit("/", 1)[-1] or node.get("label") == rel):
            file_node_gid[str(node.get("id"))] = rel
    method_targets = {str(link.get("target")) for link in raw_links if link.get("relation") == "method"}
    max_evidence: dict[str, int] = {}
    for link in raw_links:
        line = parse_location(link.get("source_location"))
        source = str(link.get("source"))
        if line is not None and max_evidence.get(source, 0) < line:
            max_evidence[source] = line

    nodes: list[NodeRow] = []
    seen_ids: set[str] = set()
    kinds: Counter = Counter()
    degraded = skipped = 0
    for index, node in enumerate(raw_nodes):
        gid = str(node.get("id") or "")
        rel = node_file[index]
        if not gid:
            skipped += 1
            continue
        raw_label = node.get("label") or "?"
        file_type = str(node.get("file_type") or "code").lower()
        if gid in file_node_gid:
            kind = NodeKind.FILE
        elif file_type in ("rationale", "document"):
            kind = NodeKind.DOCUMENT
        elif file_type == "concept":
            kind = NodeKind.CONCEPT
        elif node.get("_callable_class"):
            kind = NodeKind.CLASS
        elif gid in method_targets:
            kind = NodeKind.METHOD
        elif node.get("_callable"):
            kind = NodeKind.FUNCTION
        else:
            kind = NodeKind.VARIABLE

        start = parse_location(node.get("source_location"))
        if kind in _CODE_KINDS and start is None:
            degraded += 1
            kind = NodeKind.VARIABLE  # RB10: class/function/method bắt buộc có khoảng dòng
        end = start
        if start is not None and kind in (*_CODE_KINDS, NodeKind.VARIABLE):
            end = max(start, max_evidence.get(gid, start))
        if kind in (NodeKind.FILE, NodeKind.DOCUMENT, NodeKind.CONCEPT):
            start = end = None if kind is NodeKind.FILE else start

        # Nút không có source_file: gắn vào tệp tổng hợp (RB11 chỉ cho repository/directory không tệp).
        file_ref = rel or (EXTERNAL_FILE if sourceless == "external" else "")
        if not file_ref:
            skipped += 1
            continue
        if gid in file_node_gid:
            node_id = file_node_id(file_node_gid[gid])
            qualified = file_node_gid[gid]
            start = end = None
        else:
            node_id = f"{gid}#{kind.value}"[:2048]
            qualified = (f"{rel}::{raw_label}" if rel else raw_label)[:1024]
        if node_id in seen_ids:
            skipped += 1
            continue
        seen_ids.add(node_id)
        label = str(raw_label).strip()[:255] or "?"
        doc = str(raw_label) if file_type in ("rationale", "document") else None
        cid = node.get("community")
        nodes.append(NodeRow(
            gid=gid, node_id=node_id, kind=kind, label=label, qualified_name=qualified,
            file=file_ref, line_start=start, line_end=end, origin=origin_of(node.get("_origin")),
            doc=doc, community=int(cid) if cid is not None else None,
        ))
        kinds[kind.value] += 1

    # ---- cạnh ---------------------------------------------------------------------
    by_gid = {row.gid: row for row in nodes}
    ranges = {row.gid: (row.line_start, row.line_end) for row in nodes}
    edges: list[EdgeRow] = []
    skipped_edges = 0
    for link in raw_links:
        source, target = by_gid.get(str(link.get("source"))), by_gid.get(str(link.get("target")))
        if source is None or target is None or source.node_id == target.node_id:
            skipped_edges += 1
            continue
        edge_type, subtype = relation_to_edge(str(link.get("relation") or "")[:50])
        line = parse_location(link.get("source_location"))
        first, last = ranges.get(source.gid, (None, None))
        if line is not None and first is not None and not (first <= line <= (last or first)):
            line = first if edge_type.value in NEEDS_EVIDENCE else None
        if line is None and edge_type.value in NEEDS_EVIDENCE:
            if first is None:
                skipped_edges += 1
                continue
            line = first
        confidence = _confidence(link.get("confidence"))
        edges.append(EdgeRow(
            source=source.node_id, target=target.node_id, type=edge_type, subtype=subtype,
            confidence=confidence, score=_score(link.get("confidence_score"), confidence),
            origin=origin_of(link.get("_origin")), line=line,
        ))

    commit = data.get("built_at_commit")
    return ParsedGraph(
        files=sorted(files), communities=communities, nodes=nodes, edges=edges, kinds=dict(kinds),
        built_at_commit=commit if isinstance(commit, str) and 40 <= len(commit) <= 64 else None,
        degraded_no_line=degraded, skipped_nodes=skipped, skipped_edges=skipped_edges,
        rejected_paths=sorted(rejected),
    )


def file_records(root: Path, files: list[str]) -> tuple[dict[str, FileRec], list[str], list[str]]:
    """`(FileRec, tệp thiếu trên đĩa, đường dẫn bị chặn vì thoát gốc dự án)`.

    Đường dẫn được xác thực đích thật **trước khi** stat/đọc (QA #67.2): tuyệt đối, `..` hoặc
    symlink ra ngoài bị bỏ và ghi vào danh sách thứ ba, không đọc nội dung.
    """
    root = Path(root)
    root_real = root_realpath(root)
    records: dict[str, FileRec] = {}
    missing: list[str] = []
    rejected: list[str] = []
    for rel in files:
        if rel == EXTERNAL_FILE:
            records[rel] = FileRec(rel_path=rel, language="external", size=0, mtime=0, sha256=_ZERO_SHA)
            continue
        path = resolve_inside_root(root_real, rel)
        if path is None:
            rejected.append(rel)
            continue
        try:
            stat = path.stat()
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            size, mtime = stat.st_size, int(stat.st_mtime)
        except OSError:
            missing.append(rel)
            size, mtime, digest = 0, 0, _ZERO_SHA
        language = (language_of(rel, root) or Path(rel).suffix.lstrip(".").lower() or "unknown")[:20]
        records[rel] = FileRec(rel_path=rel, language=language, size=size, mtime=mtime,
                               sha256=digest, is_test=is_test_path(rel))
    return records, missing, sorted(rejected)


def sync_communities(store: GraphStore, parsed: ParsedGraph) -> int:
    """Đồng bộ bảng cộng đồng + quan hệ thành viên toàn bộ theo `graph.json` (QA #67.1, vòng 2.2).

    Nạp đầy đủ và nạp tăng dần dùng chung bước này. Giữ tên đã đặt (AI/người dùng ghi vào
    `nhan_cum` + `khoi_kien_truc.ten`): cộng đồng có tập thành viên không đổi giữ nguyên
    `ma_khoi`/id và tên; tập đổi thì nhận tên cũ nếu Jaccard ≥ 0.8 với đúng một cộng đồng cũ.
    Còn lại dùng tên mặc định của graph.json.
    """
    conn = store.conn
    old_rows = conn.execute("SELECT ma_khoi, ten FROM khoi_kien_truc").fetchall()
    old_names = {int(row["ma_khoi"]): row["ten"] for row in old_rows}
    old_members: dict[int, set[str]] = {int(row["ma_khoi"]): set() for row in old_rows}
    for row in conn.execute("SELECT ma_khoi, id_nut FROM nut WHERE ma_khoi IS NOT NULL"):
        old_members.setdefault(int(row["ma_khoi"]), set()).add(row["id_nut"])

    # `id_nut` thật trong CSDL cho từng nút parse (bước enrich có thể đã đổi `#kind`).
    db_ids = {row[0] for row in conn.execute("SELECT id_nut FROM nut")}
    by_gid: dict[str, list[str]] = {}
    for node_id in db_ids:
        by_gid.setdefault(node_id.rpartition("#")[0], []).append(node_id)

    def db_id(row: NodeRow) -> str:
        if row.node_id in db_ids:
            return row.node_id
        candidates = by_gid.get(row.gid) or []
        return candidates[0] if len(candidates) == 1 else row.node_id

    member_sets: dict[int, set[str]] = {}
    for row in parsed.nodes:
        if row.community is not None:
            member_sets.setdefault(row.community, set()).add(db_id(row))
    meta = {row.key: row for row in parsed.communities}
    keys = sorted(set(meta) | set(member_sets))

    used_old: set[int] = set()
    assigned: dict[int, tuple[int | None, str]] = {}

    exact: dict[frozenset[str], list[int]] = {}
    for old_id, members in old_members.items():
        if members:
            exact.setdefault(frozenset(members), []).append(old_id)
    for key in keys:  # 1) tập thành viên không đổi → giữ nguyên id + tên
        members = member_sets.get(key, set())
        candidates = exact.get(frozenset(members)) if members else None
        if candidates and len(candidates) == 1 and candidates[0] not in used_old:
            old_id = candidates[0]
            used_old.add(old_id)
            assigned[key] = (old_id, old_names[old_id])
    for key in keys:  # 2) Jaccard ≥ 0.8 với đúng một cộng đồng cũ → giữ tên cũ
        if key in assigned or not member_sets.get(key):
            continue
        new_set = member_sets[key]
        best: int | None = None
        best_score, tie = 0.0, False
        for old_id, old_set in old_members.items():
            if old_id in used_old or not old_set:
                continue
            score = len(new_set & old_set) / len(new_set | old_set)
            if score > best_score + 1e-9:
                best, best_score, tie = old_id, score, False
            elif abs(score - best_score) <= 1e-9 and score >= _KEEP_NAME_JACCARD:
                tie = True
        if best is not None and best_score >= _KEEP_NAME_JACCARD and not tie:
            used_old.add(best)
            assigned[key] = (best, old_names[best])

    used_ids = {old_id for old_id, _ in assigned.values() if old_id is not None}
    next_id = 1
    final: dict[int, tuple[int, str, float | None]] = {}
    for key in keys:  # 3) còn lại: id trống nhỏ nhất + tên mặc định
        old_id, name = assigned.get(key, (None, ""))
        if old_id is None:
            while next_id in used_ids:
                next_id += 1
            old_id = next_id
            used_ids.add(old_id)
            name = meta[key].name if key in meta else f"Community {key}"
        final[key] = (old_id, name, meta[key].cohesion if key in meta else None)

    conn.execute("UPDATE nut SET ma_khoi = NULL")
    conn.execute("DELETE FROM khoi_kien_truc")
    if final:
        conn.executemany("INSERT INTO khoi_kien_truc (ma_khoi, ten, do_gan_ket) VALUES (?, ?, ?)",
                         [(old_id, name, cohesion) for old_id, name, cohesion in final.values()])
    member_map: dict[str, int] = {}
    for row in parsed.nodes:
        if row.community is not None and row.community in final:
            member_map[db_id(row)] = final[row.community][0]
    if member_map:
        conn.execute("CREATE TEMP TABLE _thanh_vien_cong_dong (id TEXT PRIMARY KEY, ma_khoi INTEGER)")
        conn.executemany("INSERT OR REPLACE INTO temp._thanh_vien_cong_dong (id, ma_khoi) VALUES (?, ?)",
                         list(member_map.items()))
        conn.execute(
            "UPDATE nut SET ma_khoi = (SELECT ma_khoi FROM temp._thanh_vien_cong_dong t"
            " WHERE t.id = nut.id_nut)")
        conn.execute("DROP TABLE temp._thanh_vien_cong_dong")
    return len(final)


def edge_insert_rows(parsed: ParsedGraph, pk_of_id: dict[str, int]) -> list[tuple]:
    rows: list[tuple] = []
    for edge in parsed.edges:
        a, b = pk_of_id.get(edge.source), pk_of_id.get(edge.target)
        if a is None or b is None:
            continue
        rows.append((a, b, edge.type.value, edge.subtype, edge.confidence.value, edge.score,
                     edge.origin.value, edge.line, None))
    return rows


def import_graph_json(store: GraphStore, root: Path, graph_json_path: Path,
                      analysis_path: Path | None = None) -> ImportReport:
    """Nạp đầy đủ một `graph.json` vào CSDL hiện có; một giao dịch, đồ thị cũ bị thay trọn vẹn.

    `root` là gốc dự án (khoá tương đối của `source_file`). `analysis_path` mặc định là
    `.graphify_analysis.json` cạnh graph.json (độ gắn kết cộng đồng; thiếu thì bỏ trống).
    """
    started = time.perf_counter()
    root = Path(root).resolve()
    graph_json_path = Path(graph_json_path)
    analysis_path = analysis_path or graph_json_path.parent / ".graphify_analysis.json"
    parsed = parse_graph(graph_json_path, root=root, analysis_path=analysis_path)
    records, missing, rejected_disk = file_records(root, parsed.files)

    conn = store.conn
    with store.atomic():
        if store.project_id() is None:
            store.init_project(root.name, has_git=(root / ".git").exists())
        store.clear_graph()
        run_id = store.begin_run(files_total=len(records), commit_sha=parsed.built_at_commit, kind="day_du")

        file_pk: dict[str, int] = {}
        for rel in parsed.files:
            record = records.get(rel)
            if record is None:  # bị chặn ở bước đọc (symlink đổi đích giữa parse và đọc)
                continue
            file_pk[rel] = store.add_file(run_id, record)
            if rel in missing:
                store.add_file_error(rel, "read", "graph.json nhắc tới nhưng không có trên đĩa")

        pk_of_id: dict[str, int] = {}
        node_rows: list[tuple] = []
        fts_rows: list[tuple] = []
        for row in parsed.nodes:
            if row.file not in file_pk:
                continue
            pk = len(pk_of_id) + 1
            pk_of_id[row.node_id] = pk
            is_test = 1 if is_test_path(row.file) else 0
            node_rows.append((pk, row.node_id, row.kind.value, row.label, row.qualified_name,
                              row.line_start, row.line_end, is_test, row.origin.value, None, row.doc,
                              file_pk[row.file], None))
            fts_rows.append((pk, row.label, row.qualified_name, None, row.doc,
                             search_keywords(row.label, row.qualified_name)))
        for part in _chunks(node_rows):
            conn.executemany(
                "INSERT INTO nut (ma_nut, id_nut, loai_nut, nhan, ten_day_du, dong_bat_dau, dong_ket_thuc,"
                " la_kiem_thu, nguon_goc, chu_ky, tai_lieu, ma_tep, ma_khoi)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", part)
        for part in _chunks(fts_rows):
            conn.executemany(
                "INSERT INTO nut_fts (rowid, nhan, ten_day_du, chu_ky, tai_lieu, tu_khoa)"
                " VALUES (?, ?, ?, ?, ?, ?)", part)
        sync_communities(store, parsed)

        edge_rows = edge_insert_rows(parsed, pk_of_id)
        inserted = 0
        for part in _chunks(edge_rows):
            cur = conn.executemany(
                "INSERT OR IGNORE INTO canh (ma_nut_nguon, ma_nut_dich, loai_canh, loai_con,"
                " muc_tin_cay, diem_tin_cay, nguon_goc, dong_bang_chung, cot_bang_chung)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", part)
            inserted += cur.rowcount
        enrich = enrich_missing_fields(store, root)
        tested_by = derive_tested_by(store)
        store.snapshot_baseline()
        store.set_run_state(run_id, "hoan_tat", files_done=len(file_pk), files_total=len(file_pk))

    conn.execute("PRAGMA optimize")
    return ImportReport(
        graph_json=str(graph_json_path), files=len(file_pk), nodes=len(node_rows), edges=inserted,
        communities=len(parsed.communities), tested_by=tested_by, skipped_nodes=parsed.skipped_nodes,
        skipped_edges=len(parsed.edges) - len(edge_rows) + parsed.skipped_edges,
        degraded_no_line=parsed.degraded_no_line, missing_files=tuple(missing), kinds=parsed.kinds,
        enriched_nodes=enrich.nodes_enriched, estimated_nodes=enrich.nodes_estimated,
        rejected_paths=tuple(sorted(set(parsed.rejected_paths) | set(rejected_disk))),
        seconds=round(time.perf_counter() - started, 3),
    )
