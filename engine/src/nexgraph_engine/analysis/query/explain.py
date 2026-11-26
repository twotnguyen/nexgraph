"""Thẻ "Giải thích" của một nút như `graphify explain`: bậc, cộng đồng, cạnh vào/ra nhóm theo loại."""
from __future__ import annotations

from collections import Counter

from nexgraph_engine.core.errors import ApiError
from nexgraph_engine.analysis.query.common import nodes_by_pk
from nexgraph_engine.analysis.query.contracts import node_json
from nexgraph_engine.storage.store.graph_store import GraphStore

# Mỗi (hướng, loại cạnh): láng giềng khác nhau, sắp theo tệp rồi dòng để phần bị gom là các tệp cuối.
_SIDES = {
    "out": "SELECT DISTINCT c.loai_canh, n.ma_nut, t.duong_dan_tuong_doi FROM canh c JOIN nut n ON n.ma_nut = c.ma_nut_dich"
           " LEFT JOIN tep t ON t.ma_tep = n.ma_tep WHERE c.ma_nut_nguon = ? AND c.loai_canh <> 'CONTAINS'"
           " ORDER BY c.loai_canh, t.duong_dan_tuong_doi, n.dong_bat_dau, n.ma_nut",
    "in": "SELECT DISTINCT c.loai_canh, n.ma_nut, t.duong_dan_tuong_doi FROM canh c JOIN nut n ON n.ma_nut = c.ma_nut_nguon"
          " LEFT JOIN tep t ON t.ma_tep = n.ma_tep WHERE c.ma_nut_dich = ? AND c.loai_canh <> 'CONTAINS'"
          " ORDER BY c.loai_canh, t.duong_dan_tuong_doi, n.dong_bat_dau, n.ma_nut",
}


def explain_json(store: GraphStore, node_id: str, limit: int = 20) -> dict:
    node = store.get_node(node_id)
    if node is None:
        raise ApiError(404, "unknown_node", f"Không có nút {node_id}")
    pk = store.pk_of(node_id)
    groups = []
    for direction, sql in _SIDES.items():
        by_type: dict[str, list[tuple[int, str | None]]] = {}
        for type_, other, file in store.conn.execute(sql, (pk,)):
            by_type.setdefault(type_, []).append((other, file))
        for type_, items in by_type.items():
            rest = Counter(file for _, file in items[limit:])
            groups.append({"direction": direction, "type": type_, "total": len(items),
                           "nodes": [node_json(n) for n in nodes_by_pk(store, [o for o, _ in items[:limit]])],
                           "more_by_file": [{"file": f, "count": c} for f, c in rest.most_common()]})
    groups.sort(key=lambda g: (-g["total"], g["direction"], g["type"]))
    row = store.conn.execute("SELECT k.ma_khoi, k.ten FROM nut n JOIN khoi_kien_truc k ON k.ma_khoi = n.ma_khoi"
                             " WHERE n.ma_nut = ?", (pk,)).fetchone()
    return {"node": node_json(node), "degree": sum(g["total"] for g in groups),
            "community": {"id": f"com:{row[0]}", "label": row[1]} if row else None, "groups": groups}
