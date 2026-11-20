"""Hỏi graph không cần AI: chọn hạt giống và mở rộng BFS/DFS trong ngân sách token như `graphify query`.

Hạt giống chấm bằng chính hàm của Graphify (`serve.py`: tầng exact/prefix/substring nhân IDF, giảm ×0.3 cho
test/tài liệu/cấu hình, đảm bảo mỗi từ một hạt giống) trên đồ thị cầu nối, nên id nút là `id_nut`.
"""
from __future__ import annotations

from collections import deque
from typing import Literal

from graphify.serve import (
    _RELATIONAL_INTENT_TERMS,
    _pick_seeds,
    _query_name_refusal,
    _query_path_weight,
    _query_terms,
    _score_query,
    find_node_ambiguity,
)

from nexgraph_engine.bridge.to_nx import Scope, build_nx
from nexgraph_engine.flows.query import flows_for_nodes
from nexgraph_engine.query.common import edges_between, nodes_by_pk
from nexgraph_engine.query.contracts import edge_json, node_json
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.search import build_match_query

HUB_FLOOR = 50  # nút có bậc >= max(50, p99) không được mở rộng tiếp (trừ hạt giống), như `_bfs` của Graphify
_TYPES = ("CALLS", "IMPORTS", "INHERITS", "IMPLEMENTS", "REFERENCES", "USES_TYPE", "TESTED_BY", "DEFINES",
          "DOCUMENTS", "DEPENDS_ON", "SEMANTIC_RELATED", "COMPOSES", "NAVIGATES_TO")  # bỏ CONTAINS (cây thư mục)


def _cost(label: str, qname: str, file: str | None) -> int:
    return max(1, (len(label) + len(qname) + len(file or "")) // 4)  # ~4 ký tự một token, như Graphify


def _seed_ids(G, question: str) -> tuple[list[str], list[str]]:
    """(hạt giống, ứng viên trùng tên). Câu hỏi là đúng tên của nhiều nút ở nhiều tệp thì không chọn bừa."""
    if _query_name_refusal(G, question):
        return [], find_node_ambiguity(G, question)
    terms = _query_terms(question)
    qs = _score_query(G, terms, collect_per_term_seeds=True, path_weight=_query_path_weight(terms))
    best = qs.best_seed_by_term
    intent = {t for t in best if t in _RELATIONAL_INTENT_TERMS}
    if intent and any(t not in _RELATIONAL_INTENT_TERMS for t in terms):  # "calls", "uses"… không làm hạt giống
        best = {t: nid for t, nid in best.items() if t not in intent}
    return _pick_seeds(qs.ranked, G=G, best_seed_by_term=best, term_order=qs.term_order), []


def _hubs(G) -> set[str]:
    degrees = sorted(d for _, d in G.degree())
    threshold = max(HUB_FLOOR, degrees[int(len(degrees) * 0.99)]) if degrees else HUB_FLOOR
    return {n for n, d in G.degree() if d >= threshold}


def ask_graph(store: GraphStore, question: str, depth: int = 2, budget: int = 2000,
              mode: Literal["bfs", "dfs"] = "bfs") -> dict:
    if build_match_query(question) is None:
        raise ValueError("Câu hỏi không có từ nào tìm được")
    # shortcut: dựng lại đồ thị cầu nối mỗi câu hỏi (~9 ms/1.000 cạnh); repo trên ~100.000 cạnh thì cache G theo lần index.
    G = build_nx(store, Scope(limit=10**9)).G
    seed_ids, rivals = _seed_ids(G, question)
    if rivals:
        return {"seeds": [], "nodes": [], "edges": [], "flows": [], "truncated": False,
                "ambiguous": [node_json(n) for n in (store.get_node(r) for r in rivals) if n is not None]}
    seeds = [n for n in (store.get_node(i) for i in seed_ids) if n is not None]
    hubs = _hubs(G) - set(seed_ids)
    conn = store.conn
    marks_t = ",".join("?" * len(_TYPES))
    taken: list[int] = []
    spent, truncated = 0, False
    queue: deque[tuple[int, int]] = deque((store.pk_of(n.id), 0) for n in seeds)
    seen = {pk for pk, _ in queue}
    while queue:
        pk, d = queue.popleft() if mode == "bfs" else queue.pop()
        row = conn.execute("SELECT n.nhan, n.ten_day_du, t.duong_dan_tuong_doi, n.id_nut FROM nut n"
                           " LEFT JOIN tep t ON t.ma_tep = n.ma_tep WHERE n.ma_nut = ?", (pk,)).fetchone()
        cost = _cost(row[0], row[1], row[2])
        if spent + cost > budget:
            truncated = True
            break
        spent += cost
        taken.append(pk)
        if d >= depth or row[3] in hubs:
            continue
        for r in conn.execute(
                f"SELECT ma_nut_dich FROM canh WHERE ma_nut_nguon = ? AND loai_canh IN ({marks_t})"
                f" UNION SELECT ma_nut_nguon FROM canh WHERE ma_nut_dich = ? AND loai_canh IN ({marks_t})",
                [pk, *_TYPES, pk, *_TYPES]):
            if r[0] not in seen:
                seen.add(r[0])
                queue.append((r[0], d + 1))
    seed_pks = [store.pk_of(n.id) for n in seeds]
    flows = flows_for_nodes(store, seed_pks, limit=3)
    return {"seeds": [node_json(n) for n in seeds], "nodes": [node_json(n) for n in nodes_by_pk(store, taken)],
            "edges": [edge_json(e) for e in edges_between(store, taken, _TYPES)], "flows": flows,
            "truncated": truncated, "ambiguous": []}
