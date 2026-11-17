"""Đọc cạnh/nút theo khoá cho các truy vấn đồ thị chạy thẳng trên SQLite."""
from __future__ import annotations

from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.models import Node, StoredEdge

_EDGE_SQL = ("SELECT c.*, ns.id_nut AS src_id, nd.id_nut AS dst_id, ts.duong_dan_tuong_doi AS ev_file"
             " FROM canh c JOIN nut ns ON ns.ma_nut = c.ma_nut_nguon JOIN nut nd ON nd.ma_nut = c.ma_nut_dich"
             " LEFT JOIN tep ts ON ts.ma_tep = ns.ma_tep")
_CHUNK = 400


def edges_by_id(store: GraphStore, edge_ids: list[int]) -> list[StoredEdge]:
    out: dict[int, StoredEdge] = {}
    for i in range(0, len(edge_ids), _CHUNK):
        chunk = edge_ids[i:i + _CHUNK]
        for r in store.conn.execute(f"{_EDGE_SQL} WHERE c.ma_canh IN ({','.join('?' * len(chunk))})", chunk):
            out[r["ma_canh"]] = GraphStore.row_to_edge(r)
    return [out[i] for i in edge_ids if i in out]


def edges_between(store: GraphStore, pks: list[int], types: tuple[str, ...]) -> list[StoredEdge]:
    """Cạnh có cả hai đầu thuộc `pks`."""
    keep = set(pks)
    found: dict[int, StoredEdge] = {}
    marks_t = ",".join("?" * len(types))
    for i in range(0, len(pks), _CHUNK):
        chunk = pks[i:i + _CHUNK]
        for r in store.conn.execute(
                f"{_EDGE_SQL} WHERE c.ma_nut_nguon IN ({','.join('?' * len(chunk))}) AND c.loai_canh IN ({marks_t})",
                [*chunk, *types]):
            if r["ma_nut_dich"] in keep:
                found[r["ma_canh"]] = GraphStore.row_to_edge(r)
    return [found[k] for k in sorted(found)]


def nodes_by_pk(store: GraphStore, pks: list[int]) -> list[Node]:
    return store.nodes_by_pk(pks)
