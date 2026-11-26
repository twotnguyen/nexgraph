"""Danh sách bằng chứng (tệp:dòng) đứng sau một mũi tên giữa hai khối."""
from __future__ import annotations

import json
import sqlite3

from nexgraph_engine.analysis.arch.builder import LINK_TYPES, files_of_block
from nexgraph_engine.storage.store.graph_store import GraphStore
from nexgraph_engine.storage.store.models import StoredEdge


def evidence_between(conn: sqlite3.Connection, source_block: str, target_block: str, *,
                     limit: int = 50) -> list[StoredEdge]:
    src = files_of_block(conn, source_block)
    dst = files_of_block(conn, target_block)
    rows = conn.execute(
        "SELECT c.*, ns.id_nut AS src_id, nd.id_nut AS dst_id, ts.duong_dan_tuong_doi AS ev_file"
        " FROM canh c JOIN nut ns ON ns.ma_nut = c.ma_nut_nguon JOIN nut nd ON nd.ma_nut = c.ma_nut_dich"
        " JOIN tep ts ON ts.ma_tep = ns.ma_tep JOIN tep td ON td.ma_tep = nd.ma_tep"
        f" WHERE c.loai_canh IN ({','.join('?' * len(LINK_TYPES))}) AND ns.ma_tep <> nd.ma_tep"
        " AND ts.duong_dan_tuong_doi IN (SELECT value FROM json_each(?))"
        " AND td.duong_dan_tuong_doi IN (SELECT value FROM json_each(?))"
        " ORDER BY ts.duong_dan_tuong_doi, c.dong_bang_chung, c.ma_canh LIMIT ?",
        [*LINK_TYPES, json.dumps(src), json.dumps(dst), limit]).fetchall()
    return [GraphStore.row_to_edge(r) for r in rows]
