"""Phát hiện cộng đồng (Louvain) trên đồ thị cấp tệp và lưu thành khối kiến trúc (`khoi_kien_truc`)."""
from __future__ import annotations

import posixpath
import sqlite3
from collections import Counter

import networkx as nx

from nexgraph_engine.store.graph_store import GraphStore

MIN_FILES = 2
_SEED = 42  # cố định để cùng đầu vào luôn ra cùng phân hoạch


def file_graph(conn: sqlite3.Connection) -> nx.Graph:
    """Nút là rel_path của tệp; trọng số cạnh = số cạnh IMPORTS + CALLS giữa hai tệp (hai chiều cộng lại)."""
    g = nx.Graph()
    rows = conn.execute(
        "SELECT ts.duong_dan_tuong_doi AS a, td.duong_dan_tuong_doi AS b, count(*) AS w"
        " FROM canh c JOIN nut ns ON ns.ma_nut = c.ma_nut_nguon JOIN nut nd ON nd.ma_nut = c.ma_nut_dich"
        " JOIN tep ts ON ts.ma_tep = ns.ma_tep JOIN tep td ON td.ma_tep = nd.ma_tep"
        " WHERE c.loai_canh IN ('IMPORTS', 'CALLS') AND ns.ma_tep <> nd.ma_tep GROUP BY a, b").fetchall()
    for r in rows:
        prev = g.get_edge_data(r["a"], r["b"], default={"weight": 0})["weight"]
        g.add_edge(r["a"], r["b"], weight=prev + r["w"])
    return g


def _cohesion(files: set[str], g: nx.Graph) -> float:
    inside = outside = 0
    for a, b, w in g.edges(files, data="weight"):
        if a in files and b in files:
            inside += w
        else:
            outside += w
    total = inside + outside
    return inside / total if total else 0.0


def _name(files: list[str], g: nx.Graph, dir_counts: Counter[str]) -> str:
    dirs = {posixpath.dirname(f) for f in files}
    prefix = posixpath.commonpath(sorted(dirs)) if dirs else ""
    only_part_of_a_dir = len(dirs) == 1 and dir_counts[next(iter(dirs))] > len(files)
    if prefix and not only_part_of_a_dir:
        return prefix.rsplit("/", 1)[-1]
    return "Cụm quanh " + posixpath.basename(max(files, key=lambda f: (g.degree(f, weight="weight"), f)))


def _ai_name(store: GraphStore, files: list[str]) -> str | None:
    """Tên do AI/người dùng đặt (`nhan_cum`) khi cụm vẫn đúng các tệp như lúc đặt tên (W9)."""
    from nexgraph_engine.ids import membership_signature
    row = store.conn.execute("SELECT ten FROM nhan_cum WHERE chu_ky_thanh_vien = ? ORDER BY nguon = 'nguoi_dung' DESC,"
                             " tao_luc DESC LIMIT 1", (membership_signature(files),)).fetchone()
    return row[0] if row else None


def detect_communities(store: GraphStore) -> int:
    store.clear_communities()
    g = file_graph(store.conn)
    if g.number_of_nodes() < MIN_FILES:
        return 0
    groups = [sorted(c) for c in nx.community.louvain_communities(g, weight="weight", seed=_SEED) if len(c) >= MIN_FILES]
    groups.sort(key=lambda c: c[0])
    dir_counts: Counter[str] = Counter(
        posixpath.dirname(r[0]) for r in store.conn.execute("SELECT duong_dan_tuong_doi FROM tep"))
    used: Counter[str] = Counter()
    for files in groups:
        name = _ai_name(store, files) or _name(files, g, dir_counts)
        used[name] += 1
        if used[name] > 1:
            name = f"{name} {used[name]}"
        store.add_community(name, _cohesion(set(files), g), files)
    store.commit()
    return len(groups)
