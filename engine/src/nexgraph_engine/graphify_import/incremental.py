"""NG-IMP-3 — nạp tăng dần theo `manifest.json`: thay cả tệp đã đổi, không diff toàn đồ thị.

Spike A1 §3.5: `graph_diff` chậm và thiếu `kind`/`source_file`/`source_location` nên không dùng.
`manifest.json` của Graphify cho `ast_hash` từng tệp → tập tệp đổi → `GraphStore.replace_file`
xoá nút/cạnh cũ của tệp rồi ghi lại từ `graph.json` mới (nút giữ `id_nut` nên cạnh đi vào còn nguyên).

Tệp có cạnh phụ thuộc trỏ vào tệp đã đổi cũng được nạp lại: đổi tên ký hiệu làm id đích đổi,
cạnh từ tệp khác phải lấy lại từ `graph.json` mới.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from nexgraph_engine.graphify_import.enrich import enrich_missing_fields
from nexgraph_engine.graphify_import.importer import (
    ParsedGraph, file_records, parse_graph, snapshot_communities, sync_communities,
)
from nexgraph_engine.graphify_import.paths import has_nul, report_path, resolve_inside_root, root_realpath
from nexgraph_engine.index.tested_by import derive_tested_by
from nexgraph_engine.index.discovery import is_test_path
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.models import Edge, Node


@dataclass(frozen=True)
class ReplaceReport:
    files_changed: int
    files_removed: int
    expanded_files: tuple[str, ...]
    rejected_files: tuple[str, ...]
    nodes: int
    edges: int
    tested_by: int


def changed_files_from_manifest(old: dict | None, new: dict | None) -> list[str]:
    """Tệp thêm/đổi/xoá giữa hai `manifest.json` (khoá là đường dẫn tương đối, `ast_hash` là nội dung)."""
    old, new = old or {}, new or {}
    changed = {path for path, info in new.items()
               if path not in old or old[path].get("ast_hash") != info.get("ast_hash")}
    changed |= set(old) - set(new)
    return sorted(changed)


def _nodes_of(parsed: ParsedGraph, path: str) -> list[Node]:
    return [Node(id=row.node_id, kind=row.kind, label=row.label, qualified_name=row.qualified_name,
                 file=row.file, line_start=row.line_start, line_end=row.line_end,
                 is_test=is_test_path(row.file), origin=row.origin, signature=None, doc=row.doc)
            for row in parsed.nodes if row.file == path]


def _edges_of(parsed: ParsedGraph, path: str) -> list[Edge]:
    file_of = {row.node_id: row.file for row in parsed.nodes}
    return [Edge(source=edge.source, target=edge.target, type=edge.type, subtype=edge.subtype,
                 confidence=edge.confidence, confidence_score=edge.score, origin=edge.origin, line=edge.line)
            for edge in parsed.edges if file_of.get(edge.source) == path]


def _node_pks_of(store: GraphStore, paths: list[str]) -> list[int]:
    if not paths:
        return []
    pks: list[int] = []
    for start in range(0, len(paths), 400):
        part = paths[start:start + 400]
        pks += [row[0] for row in store.conn.execute(
            "SELECT n.ma_nut FROM nut n JOIN tep t ON t.ma_tep = n.ma_tep"
            f" WHERE t.duong_dan_tuong_doi IN ({','.join('?' * len(part))})", part)]
    return pks


def replace_files(store: GraphStore, changed_paths: list[str], graph_json_path: Path, *,
                  analysis_path: Path | None = None, root: Path | None = None) -> ReplaceReport:
    """Nạp lại các tệp đã đổi từ `graph.json` mới; một giao dịch, lỗi thì đồ thị cũ còn nguyên.

    `root` mặc định là thư mục cha của thư mục chứa graph.json (production: `<root>/.nexgraph/`).
    """
    graph_json_path = Path(graph_json_path)
    root = Path(root) if root is not None else graph_json_path.parent.parent
    root_real = root_realpath(root)
    analysis_path = analysis_path or graph_json_path.parent / ".graphify_analysis.json"
    parsed = parse_graph(graph_json_path, root=root, analysis_path=analysis_path)
    in_graph = set(parsed.files)

    requested: list[str] = []
    rejected: list[str] = []
    invalid: list[str] = []  # NUL: không phải đường dẫn, không thể có trong chỉ mục; chỉ ghi báo cáo
    for path in sorted(set(changed_paths)):
        if has_nul(path):
            invalid.append(report_path(path))
            continue
        (requested if resolve_inside_root(root_real, path) is not None else rejected).append(path)

    conn = store.conn
    with store.atomic():
        prior = snapshot_communities(store)  # TRƯỚC replace_file/remove_file xoá nút (QA vòng 3.2)
        existing = {row[0] for row in conn.execute("SELECT duong_dan_tuong_doi FROM tep")}
        removed = [path for path in requested if path not in in_graph and path in existing]
        reload = {path for path in requested if path in in_graph}
        expanded = {path for path in store.files_with_edges_into(_node_pks_of(store, sorted(reload))) if path in in_graph}
        expanded -= reload
        reload |= expanded

        run_id = store.begin_run(files_total=len(reload), kind="tang_dan")
        nodes_total = 0
        for path in sorted(reload):
            rec, missing, rejected_read = file_records(root, [path])
            if path in rejected_read:  # đích đổi giữa chừng: bỏ, không đọc
                rejected.append(path)
                continue
            if path not in existing:
                store.add_file(run_id, rec[path])
            errors = [("read", "graph.json nhắc tới nhưng không có trên đĩa")] if missing else []
            nodes = _nodes_of(parsed, path)
            nodes_total += len(nodes)
            store.replace_file(run_id, rec[path], nodes, [], [], {}, errors)
        for path in removed:
            store.remove_file(path)
        for path in rejected:  # tệp không còn hợp lệ trong dự án: gỡ khỏi chỉ mục
            if path in existing:
                store.remove_file(path)

        edge_rows = {path: _edges_of(parsed, path) for path in reload}
        known = {row[0] for row in conn.execute("SELECT id_nut FROM nut")}
        inserted = 0
        for path in sorted(reload):
            edges = [edge for edge in edge_rows[path] if edge.source in known and edge.target in known]
            inserted += store.add_edges(edges)

        sync_communities(store, parsed, prior)
        enrich_missing_fields(store, root, sorted(reload))
        tested_by = derive_tested_by(store)
        # Không chụp lại `moc_tep`: mốc của Changes (dự án không Git) là lần lập chỉ mục đầy đủ gần nhất
        # (docs/srs/data-model.md), như refresh của đường legacy.
        store.set_run_state(run_id, "hoan_tat", files_done=len(reload), files_total=len(reload))

    return ReplaceReport(files_changed=len(reload), files_removed=len(removed),
                         expanded_files=tuple(sorted(expanded)), rejected_files=tuple(sorted(set(rejected) | set(invalid))),
                         nodes=nodes_total, edges=inserted, tested_by=tested_by)
