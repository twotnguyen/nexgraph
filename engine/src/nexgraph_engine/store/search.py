"""Tìm kiếm toàn văn trên `nut_fts` (nhãn, tên đầy đủ, chữ ký, tài liệu, từ khoá đã tách)."""
from __future__ import annotations

import re
import sqlite3

from nexgraph_engine.index.keywords import split_identifier
from nexgraph_engine.schema.enums import NodeKind
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.models import Node

MAX_TERMS = 8
MAX_CANDIDATES = 500
# Trọng số cột theo thứ tự nhan, ten_day_du, chu_ky, tai_lieu, tu_khoa.
BM25_WEIGHTS = "10, 4, 3, 1, 5"


def build_match_query(q: str, any_terms: bool = False) -> str | None:
    """Biến chuỗi người dùng nhập thành truy vấn FTS5 an toàn: mọi từ nằm trong ngoặc kép nên toán tử không có nghĩa.
    any_terms=True (Hỏi graph): khớp từ nào cũng được, bm25 xếp nút khớp nhiều từ hiếm lên trước."""
    terms: list[str] = []
    for token in re.findall(r"\w+", q, re.UNICODE)[:MAX_TERMS]:
        parts = split_identifier(token)
        if not parts:  # chỉ gồm gạch dưới
            continue
        low = token.lower()
        if len(parts) == 1:
            terms.append(f'"{low}"*')
        else:
            terms.append(f'("{low}"* OR ({" AND ".join(f"{chr(34)}{p}{chr(34)}" for p in parts)}))')
    return (" OR " if any_terms else " AND ").join(terms) or None


def search(conn: sqlite3.Connection, q: str, *, kinds: set[NodeKind] | None = None,
           limit: int = 20, any_terms: bool = False) -> list[tuple[Node, float]]:
    match = build_match_query(q, any_terms)
    if match is None:
        return []
    where, args = "nut_fts MATCH ? AND n.loai_nut <> 'repository'", [match]
    if kinds:
        where += f" AND n.loai_nut IN ({','.join('?' * len(kinds))})"
        args += sorted(k.value for k in kinds)
    rows = conn.execute(
        "SELECT n.*, t.duong_dan_tuong_doi AS file, t.ngon_ngu AS language"
        " FROM nut_fts JOIN nut n ON n.ma_nut = nut_fts.rowid LEFT JOIN tep t ON t.ma_tep = n.ma_tep"
        f" WHERE {where} ORDER BY bm25(nut_fts, {BM25_WEIGHTS}) LIMIT ?",
        [*args, min(limit * 5, MAX_CANDIDATES)]).fetchall()
    needle = q.strip().casefold()
    scored: list[tuple[Node, float]] = []
    for rank, row in enumerate(rows):  # rows đã theo bm25 tăng dần (tốt nhất trước)
        node = GraphStore.row_to_node(row)
        label = node.label.casefold()
        tier = 2.0 if label == needle else 1.0 if label.startswith(needle) else 0.0
        scored.append((node, tier + 1.0 / (1 + rank)))
    scored.sort(key=lambda p: -p[1])
    return scored[:limit]
