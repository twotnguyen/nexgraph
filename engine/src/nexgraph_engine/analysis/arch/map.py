"""Bản đồ toàn cảnh (F12): gộp đồ thị tệp thành tối đa `detail` nút (thư mục và tệp).

Mở dần thư mục lớn nhất cho tới khi hết chỗ; cạnh là tổng IMPORTS/CALLS thật giữa các tệp thuộc hai nút khác nhau.
Id nút dùng dạng id khối của thẻ Kiến trúc (`dir:<path>`, `file:<path>`) nên route bằng chứng sẵn có dùng lại được.
"""
from __future__ import annotations

import heapq
import posixpath
import sqlite3
from collections import Counter, defaultdict

from nexgraph_engine.analysis.arch.builder import UnknownBlock, file_pair_counts

MAX_EDGES = 5000


def build_map(conn: sqlite3.Connection, parent: str | None = None, detail: int = 400) -> dict:
    kind, _, base = (parent or "").partition(":")
    if parent and kind != "dir":
        raise UnknownBlock(parent)
    all_files = [r[0] for r in conn.execute("SELECT duong_dan_tuong_doi FROM tep ORDER BY 1")]
    files = [f for f in all_files if f.startswith(base + "/")] if parent else all_files
    if parent and not files:
        raise UnknownBlock(parent)
    symbols: Counter[str] = Counter(dict(conn.execute(
        "SELECT t.duong_dan_tuong_doi, count(*) FROM nut n JOIN tep t ON t.ma_tep = n.ma_tep"
        " WHERE n.loai_nut <> 'file' GROUP BY 1").fetchall()))

    # Cây thư mục của phạm vi: đường dẫn thư mục -> các con trực tiếp (thư mục hoặc tệp), số tệp bên dưới.
    children: dict[str, list[tuple[str, bool]]] = defaultdict(list)   # dir -> [(đường dẫn, là_thư_mục)]
    n_files: Counter[str] = Counter()
    seen_dirs: set[str] = set()
    for f in files:
        d = posixpath.dirname(f)
        children[d].append((f, False))
        chain = []
        while d != base and d not in seen_dirs:
            seen_dirs.add(d)
            chain.append(d)
            d = posixpath.dirname(d)
        for c in chain:
            children[posixpath.dirname(c)].append((c, True))
        d = posixpath.dirname(f)
        while True:
            n_files[d] += 1
            if d == base or d == "":
                break
            d = posixpath.dirname(d)

    def collapse(path: str, is_dir: bool) -> tuple[str, bool]:
        while is_dir and len(children[path]) == 1:
            path, is_dir = children[path][0]
        return path, is_dir

    def expand(path: str) -> list[tuple[str, bool]]:
        return sorted({collapse(p, d) for p, d in children[path]})

    nodes_now = expand(base)
    truncated = False
    if len(nodes_now) > detail:   # gốc có quá nhiều mục: giữ các mục nhiều symbol nhất
        def weight(item: tuple[str, bool]) -> int:
            p, d = item
            return sum(symbols[f] for f in files if f.startswith(p + "/")) if d else symbols[p]
        nodes_now = sorted(sorted(nodes_now), key=lambda it: -weight(it))[:detail]
        truncated = True
    heap = [(-n_files[p], p) for p, d in nodes_now if d]
    heapq.heapify(heap)
    chosen = set(nodes_now)
    while heap:
        _, path = heapq.heappop(heap)
        kids = expand(path)
        if len(chosen) - 1 + len(kids) > detail:
            continue
        chosen.discard((path, True))
        for k in kids:
            chosen.add(k)
            if k[1]:
                heapq.heappush(heap, (-n_files[k[0]], k[0]))

    # Ánh xạ tệp -> nút chứa nó: đi ngược từ tệp lên tới thư mục đã chọn.
    chosen_dirs = {p for p, d in chosen if d}
    chosen_files = {p for p, d in chosen if not d}
    node_of: dict[str, str] = {}
    members: dict[str, list[str]] = defaultdict(list)
    for f in files:
        if f in chosen_files:
            nid = f"file:{f}"
        else:
            d = posixpath.dirname(f)
            while d and d not in chosen_dirs and d != base:
                d = posixpath.dirname(d)
            if d not in chosen_dirs:
                continue
            nid = f"dir:{d}"
        node_of[f] = nid
        members[nid].append(f)

    comm: dict[str, int] = dict(conn.execute(
        "SELECT t.duong_dan_tuong_doi, n.ma_khoi FROM nut n JOIN tep t ON t.ma_tep = n.ma_tep"
        " WHERE n.loai_nut = 'file' AND n.ma_khoi IS NOT NULL").fetchall())
    out_nodes = []
    for p, d in sorted(chosen, key=lambda it: (-n_files[it[0]] if it[1] else -1, it[0])):
        nid = f"{'dir' if d else 'file'}:{p}"
        fs = members[nid]
        votes = Counter(comm[f] for f in fs if f in comm)
        community = min(votes, key=lambda k: (-votes[k], k)) if votes else None
        label = p[len(base) + 1:] if base else p
        out_nodes.append({"id": nid, "label": label, "kind": "directory" if d else "file", "files": len(fs),
                          "symbols": sum(symbols[f] for f in fs), "community": community, "drillable": d})

    agg: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
    for a, b, t, n in file_pair_counts(conn):
        s, g = node_of.get(a), node_of.get(b)
        if s and g and s != g:
            agg[(s, g)][t] += n
    edges = [{"source": s, "target": g, "weight": sum(c.values()), "types": dict(sorted(c.items()))}
             for (s, g), c in agg.items()]
    edges.sort(key=lambda e: (-e["weight"], e["source"], e["target"]))
    if len(edges) > MAX_EDGES:
        edges, truncated = edges[:MAX_EDGES], True
    return {"parent": {"id": parent, "label": base.rsplit("/", 1)[-1]} if parent else None,
            "nodes": out_nodes, "edges": edges, "truncated": truncated,
            "totals": {"files": len(files), "nodes": len(out_nodes)}}
