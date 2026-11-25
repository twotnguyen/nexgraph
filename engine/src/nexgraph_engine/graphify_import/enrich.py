"""NG-IMP-2 — bổ sung các trường `graph.json` không có, cho đúng những tệp đã nạp.

`graph.json` chỉ cho dòng bắt đầu; thiếu dòng kết thúc, chữ ký, loại nút chi tiết và sha256
(spike A1 §4.2). Bước này đọc lại **từng tệp nguồn** bằng tree-sitter (`spans.file_spans`) —
không chạy resolver, không dựng đồ thị lần hai — rồi ghi đè giá trị ước lượng.

Cờ nguồn của trường: nút đọc được span mang `nguon_goc = 'ast'`; nút còn giá trị ước lượng
(tệp thiếu/không parse được, hoặc nút biến không có span) mang `nguon_goc = 'resolver'`.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

from nexgraph_engine.graphify_import.mapping import EXTERNAL_FILE
from nexgraph_engine.graphify_import.spans import Span, file_spans
from nexgraph_engine.schema.enums import NodeKind
from nexgraph_engine.store.graph_store import GraphStore

_CODE_KINDS = ("class", "function", "method", "variable")
_SPAN_KINDS = ("class", "function", "method")


@dataclass(frozen=True)
class EnrichReport:
    files_read: int
    files_refreshed: int
    nodes_enriched: int
    nodes_estimated: int


def _names(label: str, qualified_name: str) -> set[str]:
    """Tên để khớp span: nhãn (`greet()`, `.hello()`) và phần cuối `ten_day_du`."""
    out = set()
    for raw in (label, qualified_name.rsplit("::", 1)[-1]):
        name = raw.strip().rstrip("()").lstrip(".")
        if name:
            out.add(name.split(".")[-1])
    return out


def _match(spans: list[Span], names: set[str], line_start: int | None, kind: str) -> Span | None:
    """Chọn span của đúng khai báo: ưu tiên trùng dòng bắt đầu, rồi chứa dòng, rồi cách ≤ 8 dòng
    (decorator của Python làm `source_location` lùi về trước `def`), cuối cùng là duy nhất theo tên."""
    if line_start is None:
        return None
    candidates = [span for span in spans if span.name in names]
    if not candidates:
        return None

    def rank(span: Span) -> tuple[int, int]:
        if span.start == line_start:
            position = 0
        elif span.start <= line_start <= span.end:
            position = 1
        elif span.start > line_start and span.start - line_start <= 8:
            position = 2
        else:
            position = 3
        return position, 0 if span.kind == kind else 1

    candidates.sort(key=rank)
    best = candidates[0]
    if rank(best)[0] == 3 and sum(1 for span in candidates if rank(span)[0] == 3) > 1:
        return None  # nhiều khai báo cùng tên, không dòng nào khớp: không đoán
    return best


def _node_rows(conn, paths: list[str] | None) -> list:
    sql = ("SELECT t.duong_dan_tuong_doi AS path, n.ma_nut, n.id_nut, n.loai_nut, n.nhan,"
           " n.ten_day_du, n.dong_bat_dau FROM nut n JOIN tep t ON t.ma_tep = n.ma_tep")
    if paths is None:
        return conn.execute(sql).fetchall()
    rows: list = []
    for start in range(0, len(paths), 400):
        part = paths[start:start + 400]
        rows += conn.execute(f"{sql} WHERE t.duong_dan_tuong_doi IN ({','.join('?' * len(part))})", part).fetchall()
    return rows


def _evidence_lines(conn, pks: set[int]) -> dict[int, int]:
    """Dòng bằng chứng lớn nhất của cạnh xuất phát từ mỗi nút (RB22: span thật phải chứa nó)."""
    out: dict[int, int] = {}
    pks_list = list(pks)
    for start in range(0, len(pks_list), 400):
        part = pks_list[start:start + 400]
        for row in conn.execute(
                f"SELECT ma_nut_nguon, max(dong_bang_chung) AS line FROM canh"
                f" WHERE ma_nut_nguon IN ({','.join('?' * len(part))}) GROUP BY ma_nut_nguon", part):
            if row["line"] is not None:
                out[row["ma_nut_nguon"]] = row["line"]
    return out


def _file_paths(conn, rel_paths: list[str] | None) -> list[str]:
    if rel_paths is not None:
        return sorted(set(rel_paths))
    return [row[0] for row in conn.execute("SELECT duong_dan_tuong_doi FROM tep ORDER BY ma_tep")]


def enrich_missing_fields(store: GraphStore, root: Path, rel_paths: list[str] | None = None) -> EnrichReport:
    """Bổ sung dòng kết thúc/chữ ký/loại nút/sha256 cho các tệp đã nạp (tất cả khi `rel_paths=None`).

    Chạy trong giao dịch hiện tại của người gọi (import đầy đủ hoặc nạp tăng dần).
    """
    root = Path(root)
    conn = store.conn
    paths = [path for path in _file_paths(conn, rel_paths) if path != EXTERNAL_FILE]
    if not paths:
        return EnrichReport(0, 0, 0, 0)
    rows = _node_rows(conn, paths)
    evidence = _evidence_lines(conn, {row["ma_nut"] for row in rows})
    files_read = files_refreshed = enriched = estimated = 0
    by_path: dict[str, list] = {}
    for row in rows:
        by_path.setdefault(row["path"], []).append(row)

    for rel_path in paths:
        path = root / rel_path
        digest = None
        try:
            stat = path.stat()
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError:
            stat, digest = None, None
        if digest is not None and stat is not None:
            store.update_file_stat(rel_path, size=stat.st_size, mtime=int(stat.st_mtime), sha256=digest)
            files_refreshed += 1
        spans = file_spans(path) if digest is not None else None
        if spans is not None:
            files_read += 1
        for row in by_path.get(rel_path, []):
            kind = row["loai_nut"]
            if kind not in _CODE_KINDS:
                continue
            span = _match(spans or [], _names(row["nhan"], row["ten_day_du"]), row["dong_bat_dau"], kind)
            if span is None:
                if kind in _SPAN_KINDS:  # nút biến không có span: giữ ước lượng, chỉ ghi cờ
                    store.mark_node_estimated(row["id_nut"])
                estimated += 1
                continue
            end = max(span.end, evidence.get(row["ma_nut"], 0))
            new_kind = NodeKind(span.kind)
            store.update_node_span(row["id_nut"], kind=new_kind, line_end=end, signature=span.signature)
            enriched += 1
    store.commit()
    return EnrichReport(files_read=files_read, files_refreshed=files_refreshed,
                        nodes_enriched=enriched, nodes_estimated=estimated)
