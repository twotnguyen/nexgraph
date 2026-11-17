"""Tìm đường giữa các nút chỉ qua cạnh thật (spec gốc §5.8) và vùng ảnh hưởng của một nút."""
from __future__ import annotations


from nexgraph_engine.impact.analyze import propagate, tests_for
from nexgraph_engine.query.common import edges_by_id, nodes_by_pk
from nexgraph_engine.query.contracts import edge_json, node_json
from nexgraph_engine.schema.enums import EdgeType
from nexgraph_engine.store.graph_store import GraphStore

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


def _shortest(store: GraphStore, src: int, dst: int, max_hops: int, directed: bool) -> list[tuple[int, int]] | None:
    """Đường ngắn nhất dạng [(nút, mã cạnh dẫn tới nút)], hoặc None."""
    if src == dst:
        return []
    parent: dict[int, tuple[int, int]] = {}
    seen, frontier = {src}, [src]
    for _ in range(max_hops):
        nxt: list[int] = []
        for i in range(0, len(frontier), 400):
            for at, other, eid in _step(store, frontier[i:i + 400], directed):
                if other in seen:
                    continue
                seen.add(other)
                parent[other] = (at, eid)
                if other == dst:
                    path, cur = [], dst
                    while cur != src:
                        prev, e = parent[cur]
                        path.append((cur, e))
                        cur = prev
                    return path[::-1]
                nxt.append(other)
        if not nxt:
            return None
        frontier = nxt
    return None


def find_paths(store: GraphStore, node_ids: list[str], max_hops: int = 4, directed: bool = True) -> dict:
    pks = [store.pk_of(n) for n in node_ids]  # KeyError khi nút lạ
    node_order: list[int] = [pks[0]]
    edge_ids: list[int] = []
    unconnected: list[str] = []
    for (a, b), b_id in zip(zip(pks, pks[1:]), node_ids[1:]):
        path = _shortest(store, a, b, max_hops, directed)
        if path is None:
            unconnected.append(b_id)
            node_order.append(b)
            continue
        for pk, eid in path:
            node_order.append(pk)
            edge_ids.append(eid)
    node_order = list(dict.fromkeys(node_order))
    return {"nodes": [node_json(n) for n in nodes_by_pk(store, node_order)],
            "edges": [edge_json(e) for e in edges_by_id(store, list(dict.fromkeys(edge_ids)))],
            "unconnected": unconnected}


def impact_of(store: GraphStore, node_id: str) -> dict:
    node = store.get_node(node_id)
    if node is None:
        raise KeyError(node_id)
    impacted, truncated = propagate(store.conn, [node_id])
    return {"node": node_json(node),
            "impacted": [{"node": node_json(i.node), "score": i.score, "hops": i.hops} for i in impacted
                         if not i.node.is_test],
            "tests": [node_json(t) for t in tests_for(store.conn, node_id)], "truncated": truncated}
