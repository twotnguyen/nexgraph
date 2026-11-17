"""Gói ngữ cảnh theo ngân sách token cho chat và MCP, cộng định vị nút theo `tệp:dòng`.

Ý tưởng (hợp nhất xếp hạng bằng Reciprocal Rank Fusion, dựng ngữ cảnh theo ngân sách token) port từ coderag
(Apache-2.0, commit a3b13ceac38dfd0f420e0dd9e94447675e1a4a69, `retrieval/fusion.py` và `context/builder.py`).
Modified by NexGraph contributors, 2026.
"""
from __future__ import annotations

from pathlib import Path

from nexgraph_engine.errors import ApiError
from nexgraph_engine.flows.query import flow_json, flows_for_nodes
from nexgraph_engine.query.contracts import node_json, read_code
from nexgraph_engine.schema.enums import EdgeType
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.search import search

WEIGHTS = {"search": 1.0, "flow": 0.8, "neighbors": 0.6}
MAX_CODE_SPAN = 60
SEEDS = 3
NEIGHBORS_PER_SEED = 20


def rrf(lists: dict[str, list[str]], weights: dict[str, float], k: int = 60) -> list[tuple[str, float, list[str]]]:
    score: dict[str, float] = {}
    why: dict[str, list[str]] = {}
    for name, ids in lists.items():
        for rank, nid in enumerate(ids, start=1):
            score[nid] = score.get(nid, 0.0) + weights[name] / (k + rank)
            why.setdefault(nid, []).append(name)
    return sorted(((i, s, why[i]) for i, s in score.items()), key=lambda t: (-t[1], t[0]))


def build_context(store: GraphStore, root: Path, question: str, budget: int = 4000) -> dict:
    hits = [n for n, _ in search(store.conn, question, limit=20, any_terms=True)]
    if not hits:
        raise ValueError("Câu hỏi không có từ nào tìm được")
    seeds = hits[:SEEDS]
    seed_pks = [store.pk_of(n.id) for n in seeds]
    neighbor_ids: list[str] = []
    for n in seeds:
        hood = store.neighbors(n.id, types={EdgeType.CALLS}, direction="both", depth=1, limit=NEIGHBORS_PER_SEED + 1)
        neighbor_ids += [m.id for m in hood.nodes if m.id != n.id][:NEIGHBORS_PER_SEED]
    flow_ids: list[str] = []
    top_flow = flows_for_nodes(store, seed_pks, limit=1)
    if top_flow:
        flow_ids = [s["node"]["id"] for s in flow_json(store, top_flow[0]["id"])["steps"]]
    ranked = rrf({"search": [n.id for n in hits], "neighbors": neighbor_ids, "flow": flow_ids}, WEIGHTS)

    q = question.lower()
    want_tests = "test" in q or "kiểm thử" in q
    items: list[dict] = []
    spans: dict[str, list[tuple[int, int]]] = {}
    tokens, truncated = 0, False
    for nid, score, reasons in ranked:
        node = store.get_node(nid)
        if node is None or not node.file or node.line_start is None or node.line_end is None:
            continue
        if node.is_test and not want_tests:
            continue
        if any(a <= node.line_start and node.line_end <= b for a, b in spans.get(node.file, [])):
            continue
        end = min(node.line_end, node.line_start + MAX_CODE_SPAN - 1)
        try:
            code = read_code(store, root, node.file, node.line_start, end)
        except ApiError:
            continue
        cost = len(code["text"]) // 4 + 20
        if tokens + cost > budget:
            truncated = True
            break
        tokens += cost
        spans.setdefault(node.file, []).append((node.line_start, node.line_end))
        items.append({"node": node_json(node), "score": score, "reasons": sorted(reasons),
                      "code": {"file": node.file, "start": code["start"], "end": code["end"], "text": code["text"]}})
    return {"items": items, "flows": flows_for_nodes(store, seed_pks, limit=3), "tokens": tokens, "truncated": truncated}


def locate_json(store: GraphStore, file: str, line: int) -> dict:
    if store.file_record(file) is None:
        raise ApiError(404, "file_not_found", f"Tệp chưa được lập chỉ mục: {file}")
    row = store.conn.execute(
        "SELECT n.id_nut FROM nut n JOIN tep t ON t.ma_tep = n.ma_tep WHERE t.duong_dan_tuong_doi = ?"
        " AND n.loai_nut <> 'file' AND n.dong_bat_dau <= ? AND n.dong_ket_thuc >= ?"
        " ORDER BY n.dong_ket_thuc - n.dong_bat_dau, n.id_nut LIMIT 1", (file, line, line)).fetchone()
    node = store.get_node(row[0] if row else f"{file}#file")
    if node is None:
        raise ApiError(404, "file_not_found", f"Tệp chưa được lập chỉ mục: {file}")
    return {"node": node_json(node)}
