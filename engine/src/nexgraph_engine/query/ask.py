"""Hỏi graph không cần AI: hạt giống từ tìm kiếm, mở rộng BFS/DFS trong ngân sách token như `graphify query`."""
from __future__ import annotations

from collections import deque
from typing import Literal

from nexgraph_engine.api.serialize import edge_json, node_json
from nexgraph_engine.flows.query import flows_for_nodes
from nexgraph_engine.query.common import edges_between, nodes_by_pk
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.search import build_match_query, search

SEEDS = 3
_TYPES = ("CALLS", "IMPORTS", "INHERITS", "IMPLEMENTS", "REFERENCES", "USES_TYPE", "TESTED_BY", "DEFINES",
          "DOCUMENTS", "DEPENDS_ON", "SEMANTIC_RELATED", "COMPOSES", "NAVIGATES_TO")  # bỏ CONTAINS (cây thư mục)


def _cost(label: str, qname: str, file: str | None) -> int:
    return max(1, (len(label) + len(qname) + len(file or "")) // 4)  # ~4 ký tự một token, như Graphify


def ask_graph(store: GraphStore, question: str, depth: int = 2, budget: int = 2000,
              mode: Literal["bfs", "dfs"] = "bfs") -> dict:
    if build_match_query(question) is None:
        raise ValueError("Câu hỏi không có từ nào tìm được")
    seeds = [n for n, _ in search(store.conn, question, limit=SEEDS, any_terms=True)]
    conn = store.conn
    marks_t = ",".join("?" * len(_TYPES))
    taken: list[int] = []
    spent, truncated = 0, False
    queue: deque[tuple[int, int]] = deque((store._pk(n.id), 0) for n in seeds)  # noqa: SLF001
    seen = {pk for pk, _ in queue}
    while queue:
        pk, d = queue.popleft() if mode == "bfs" else queue.pop()
        row = conn.execute("SELECT n.nhan, n.ten_day_du, t.duong_dan_tuong_doi FROM nut n"
                           " LEFT JOIN tep t ON t.ma_tep = n.ma_tep WHERE n.ma_nut = ?", (pk,)).fetchone()
        cost = _cost(row[0], row[1], row[2])
        if spent + cost > budget:
            truncated = True
            break
        spent += cost
        taken.append(pk)
        if d >= depth:
            continue
        for r in conn.execute(
                f"SELECT ma_nut_dich FROM canh WHERE ma_nut_nguon = ? AND loai_canh IN ({marks_t})"
                f" UNION SELECT ma_nut_nguon FROM canh WHERE ma_nut_dich = ? AND loai_canh IN ({marks_t})",
                [pk, *_TYPES, pk, *_TYPES]):
            if r[0] not in seen:
                seen.add(r[0])
                queue.append((r[0], d + 1))
    seed_pks = [store._pk(n.id) for n in seeds]
    flows = flows_for_nodes(store, seed_pks, limit=3)
    return {"seeds": [node_json(n) for n in seeds], "nodes": [node_json(n) for n in nodes_by_pk(store, taken)],
            "edges": [edge_json(e) for e in edges_between(store, taken, _TYPES)], "flows": flows,
            "truncated": truncated}
