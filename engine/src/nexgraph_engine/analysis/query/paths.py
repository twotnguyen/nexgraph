"""Tìm đường giữa các nút chỉ qua cạnh thật (spec gốc §5.8) và vùng ảnh hưởng của một nút."""
from __future__ import annotations


from nexgraph_engine.analysis.impact.analyze import propagate, tests_for
from nexgraph_engine.analysis.query.common import edges_by_id, nodes_by_pk
from nexgraph_engine.analysis.query.contracts import edge_json, node_json
from nexgraph_engine.core.schema.enums import EdgeType
from nexgraph_engine.storage.store.graph_store import GraphStore

PATH_TYPES = {EdgeType.CALLS, EdgeType.IMPORTS, EdgeType.INHERITS, EdgeType.IMPLEMENTS, EdgeType.REFERENCES,
              EdgeType.USES_TYPE, EdgeType.COMPOSES, EdgeType.NAVIGATES_TO}
_TYPES = tuple(sorted(t.value for t in PATH_TYPES))


def _step(store: GraphStore, pks: list[int], directed: bool) -> list[tuple[int, int, int]]:
    """(nút đang ở, nút kế, mã cạnh) cho cả tầng `pks`."""
    marks, marks_t = ",".join("?" * len(pks)), ",".join("?" * len(_TYPES))
    rows = [(r[0], r[1], r[2]) for r in store.conn.execute(
        f"SELECT ma_nut_nguon, ma_nut_dich, ma_canh FROM canh WHERE ma_nut_nguon IN ({marks})"
        f" AND loai_canh IN ({marks_t}) ORDER BY ma_canh", [*pks, *_TYPES])]
    if not directed:
        rows += [(r[1], r[0], r[2]) for r in store.conn.execute(
            f"SELECT ma_nut_nguon, ma_nut_dich, ma_canh FROM canh WHERE ma_nut_dich IN ({marks})"
            f" AND loai_canh IN ({marks_t}) ORDER BY ma_canh", [*pks, *_TYPES])]
    return rows


MAX_SHORTEST_PATHS = 256  # đủ để tìm đường yếu nhất mà không liệt kê số mũ đường (Graphify #4881)
HUB_FLOOR = 50
_RANK = {"AMBIGUOUS": 1, "INFERRED": 2, "EXTRACTED": 3}  # như `_CONFIDENCE_RANK` của Graphify


def _layers(store: GraphStore, src: int, dst: int, max_hops: int,
            directed: bool) -> dict[int, list[tuple[int, int]]] | None:
    """Mọi cha cùng tầng BFS {nút: [(nút trước, mã cạnh)]} tới khi chạm `dst`; None khi không tới được."""
    parents: dict[int, list[tuple[int, int]]] = {}
    seen, frontier = {src}, [src]
    for _ in range(max_hops):
        layer: dict[int, list[tuple[int, int]]] = {}
        for i in range(0, len(frontier), 400):
            for at, other, eid in _step(store, frontier[i:i + 400], directed):
                if other not in seen:
                    layer.setdefault(other, []).append((at, eid))
        if not layer:
            return None
        parents.update(layer)
        if dst in layer:
            return parents
        seen.update(layer)
        frontier = list(layer)
    return None


def _routes(parents: dict[int, list[tuple[int, int]]], src: int, dst: int) -> list[list[tuple[int, int]]]:
    """Tối đa MAX_SHORTEST_PATHS đường [(nút, mã cạnh dẫn tới nút)], liệt kê ngược từ `dst`."""
    out: list[list[tuple[int, int]]] = []
    stack: list[tuple[int, list[tuple[int, int]]]] = [(dst, [])]
    while stack and len(out) < MAX_SHORTEST_PATHS:
        node, tail = stack.pop()
        if node == src:
            out.append(tail)
            continue
        for prev, eid in reversed(parents[node]):
            stack.append((prev, [(node, eid), *tail]))
    return out


def _hub_threshold(store: GraphStore) -> int:
    degrees = [r[0] for r in store.conn.execute(
        "SELECT count(*) FROM (SELECT ma_nut_nguon AS n FROM canh UNION ALL SELECT ma_nut_dich FROM canh)"
        " GROUP BY n ORDER BY 1")]
    return max(HUB_FLOOR, degrees[int(len(degrees) * 0.99)]) if degrees else HUB_FLOOR


def _degree(store: GraphStore, pk: int) -> int:
    return store.conn.execute("SELECT (SELECT count(*) FROM canh WHERE ma_nut_nguon = ?)"
                              " + (SELECT count(*) FROM canh WHERE ma_nut_dich = ?)", (pk, pk)).fetchone()[0]


def _confidence(store: GraphStore, edge_ids: list[int]) -> dict | None:
    """Hop yếu nhất: hạng AMBIGUOUS < INFERRED < EXTRACTED, rồi điểm thấp hơn (EXTRACTED không mang điểm)."""
    weakest = None
    for hop, eid in enumerate(edge_ids, 1):
        level, score = store.conn.execute("SELECT muc_tin_cay, diem_tin_cay FROM canh WHERE ma_canh = ?",
                                          (eid,)).fetchone()
        score = None if level == "EXTRACTED" or score is None else float(score)
        key = (_RANK.get(level, 0), score is None, score or 0.0, hop)
        if weakest is None or key < weakest[0]:
            weakest = (key, {"level": level, "score": score, "hop": hop})
    return weakest[1] if weakest else None


def _shortest(store: GraphStore, src: int, dst: int, max_hops: int, directed: bool,
              hub_at: int) -> list[tuple[int, int]] | None:
    """Trong các đường ngắn nhất: ít hub nhất, rồi đường có hop yếu nhất (cách bảo thủ của Graphify)."""
    if src == dst:
        return []
    parents = _layers(store, src, dst, max_hops, directed)
    if parents is None:
        return None
    routes = _routes(parents, src, dst)
    if len(routes) == 1:
        return routes[0]
    degree: dict[int, int] = {}

    def hubs(route: list[tuple[int, int]]) -> int:
        return sum(degree.setdefault(pk, _degree(store, pk)) >= hub_at for pk, _ in route[:-1])

    def weakest(route: list[tuple[int, int]]) -> tuple:
        c = _confidence(store, [eid for _, eid in route])
        return (_RANK.get(c["level"], 0), c["score"] is None, c["score"] or 0.0, c["hop"]) if c else (-1, True, 0.0, 0)

    return min(routes, key=lambda r: (hubs(r), weakest(r)))


def find_paths(store: GraphStore, node_ids: list[str], max_hops: int = 4, directed: bool = True) -> dict:
    pks = [store.pk_of(n) for n in node_ids]  # KeyError khi nút lạ
    hub_at = _hub_threshold(store)
    node_order: list[int] = [pks[0]]
    edge_ids: list[int] = []
    unconnected: list[str] = []
    for (a, b), b_id in zip(zip(pks, pks[1:]), node_ids[1:]):
        path = _shortest(store, a, b, max_hops, directed, hub_at)
        if path is None:
            unconnected.append(b_id)
            node_order.append(b)
            continue
        for pk, eid in path:
            node_order.append(pk)
            edge_ids.append(eid)
    node_order = list(dict.fromkeys(node_order))
    edge_ids = list(dict.fromkeys(edge_ids))
    return {"nodes": [node_json(n) for n in nodes_by_pk(store, node_order)],
            "edges": [edge_json(e) for e in edges_by_id(store, edge_ids)],
            "unconnected": unconnected, "confidence": _confidence(store, edge_ids)}


def impact_of(store: GraphStore, node_id: str) -> dict:
    node = store.get_node(node_id)
    if node is None:
        raise KeyError(node_id)
    impacted, truncated = propagate(store.conn, [node_id])
    return {"node": node_json(node),
            "impacted": [{"node": node_json(i.node), "score": i.score, "hops": i.hops} for i in impacted
                         if not i.node.is_test],
            "tests": [node_json(t) for t in tests_for(store.conn, node_id)], "truncated": truncated}
