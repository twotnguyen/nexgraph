"""Vòng phụ thuộc giữa các tệp: thành phần liên thông mạnh của đồ thị IMPORTS tệp -> tệp."""
from __future__ import annotations

import sqlite3

import networkx as nx

MAX_FILES_PER_CYCLE = 50


def import_cycles(conn: sqlite3.Connection, limit: int = 20) -> dict:
    g = nx.DiGraph()
    for a, b in conn.execute(
            "SELECT DISTINCT ts.duong_dan_tuong_doi, td.duong_dan_tuong_doi FROM canh c"
            " JOIN nut ns ON ns.ma_nut = c.ma_nut_nguon JOIN nut nd ON nd.ma_nut = c.ma_nut_dich"
            " JOIN tep ts ON ts.ma_tep = ns.ma_tep JOIN tep td ON td.ma_tep = nd.ma_tep"
            " WHERE c.loai_canh = 'IMPORTS' AND ns.ma_tep <> nd.ma_tep"):
        g.add_edge(a, b)
    comps = sorted((sorted(c) for c in nx.strongly_connected_components(g) if len(c) >= 2),
                   key=lambda fs: (-len(fs), fs[0]))
    return {"cycles": [{"files": fs[:MAX_FILES_PER_CYCLE], "size": len(fs)} for fs in comps[:limit]],
            "total": len(comps)}
