"""Đọc graph chung (W8): tìm kiếm gộp, graph gộp chỉ đọc cho "Xem chung", xuất graph.json gộp như `merge-graphs`."""
from __future__ import annotations

from pathlib import Path

from nexgraph_engine.bridge.to_nx import _top_by_degree, build_nx
from nexgraph_engine.global_graph.link import Member, gid
from nexgraph_engine.query.contracts import edge_json, node_json, search_json
from nexgraph_engine.store.graph_store import GraphStore

GLOBAL_EXPORT_NAME = "nexgraph-global-graph.json"
_RELATION = {"member_call": "calls", "import_symbol": "calls", "same_type_as": "same_type_as"}


def search_global(members: list[Member], q: str, limit: int) -> list[dict]:
    hits = []
    for m in members:  # FTS trên từng CSDL rồi gộp; câu tìm rỗng ném ApiError 400 ở thành viên đầu tiên
        hits += [{"project_id": m.project_id, "project_name": m.info.name, **h}
                 for h in search_json(GraphStore(m.conn), q, None, limit)]
    return sorted(hits, key=lambda h: -h["score"])[:limit]


def _cross_edge_json(i: int, e: dict) -> dict:
    return {"id": i, "source": gid(e["du_an_nguon"], e["id_nut_nguon"]), "target": gid(e["du_an_dich"], e["id_nut_dich"]),
            "type": e["loai_canh"], "subtype": e["loai_con"], "confidence": e["muc_tin_cay"],
            "confidence_score": e["diem_tin_cay"], "origin": "resolver", "cross_repo": True,
            "evidence": {"file": e["tep_bang_chung"], "line": e["dong_bang_chung"], "col": None}
            if e["dong_bang_chung"] else None}


def graph_global(members: list[Member], cross: list[dict], limit: int) -> dict:
    """Graph gộp, tối đa `limit` nút: trước hết hai đầu của cạnh liên repo, phần còn lại chia đều cho các dự án
    theo bậc cao nhất.

    Id nút có dạng `<project_id>::<id nút>` để hai dự án không đụng nhau.
    """
    nodes, edges, truncated = [], [], False
    budget = limit
    plan = []
    for m in members:  # nút ép (hai đầu cạnh liên repo) cũng tính vào `limit`
        store = GraphStore(m.conn)
        forced = [e["id_nut_nguon"] for e in cross if e["du_an_nguon"] == m.project_id]
        forced += [e["id_nut_dich"] for e in cross if e["du_an_dich"] == m.project_id]
        forced_pks = []
        for node_id in dict.fromkeys(forced):
            try:
                forced_pks.append(store.pk_of(node_id))
            except KeyError:  # cạnh cũ trỏ tới nút đã mất sau lần index mới: bỏ, lần relink sau sẽ dọn
                pass
        truncated |= len(forced_pks) > budget
        forced_pks = forced_pks[:max(0, budget)]
        budget -= len(forced_pks)
        plan.append((m, store, forced_pks))
    per = budget // max(1, len(members))
    for m, store, forced_pks in plan:
        candidates = [r[0] for r in m.conn.execute(
            "SELECT ma_nut FROM nut WHERE loai_nut NOT IN ('repository', 'directory')")]
        truncated |= len(candidates) > per + len(forced_pks)
        forced_set = set(forced_pks)
        top = [pk for pk in _top_by_degree(store, candidates, per + len(forced_pks)) if pk not in forced_set]
        pks = [*forced_pks, *top[:per]]
        keep = set(pks)
        nodes += [{**node_json(n), "id": gid(m.project_id, n.id), "project_id": m.project_id}
                  for n in store.nodes_by_pk(pks)]
        for r in store._edge_rows(pks, None, "out") if pks else []:
            if r["ma_nut_dich"] in keep and r["ma_nut_nguon"] != r["ma_nut_dich"]:
                e = edge_json(store.row_to_edge(r))
                edges.append({**e, "source": gid(m.project_id, e["source"]), "target": gid(m.project_id, e["target"])})
    present = {n["id"] for n in nodes}
    edges += [_cross_edge_json(0, e) for e in cross]
    edges = [{**e, "id": i} for i, e in enumerate(edges, 1) if e["source"] in present and e["target"] in present]
    return {"projects": [{"project_id": m.project_id, "name": m.info.name} for m in members],
            "nodes": nodes, "edges": edges, "truncated": truncated}


def _tags(members: list[Member]) -> dict[str, str]:
    """Tiền tố id theo tên dự án, thêm `-2`, `-3` khi trùng (như `distinct_repo_tags` của merge-graphs)."""
    seen: dict[str, int] = {}
    out = {}
    for m in members:
        seen[m.info.name] = seen.get(m.info.name, 0) + 1
        out[m.project_id] = m.info.name if seen[m.info.name] == 1 else f"{m.info.name}-{seen[m.info.name]}"
    return out


def export_global(members: list[Member], cross: list[dict], out_dir: Path) -> dict:
    """Ghi `graph.json` gộp theo cách của `graphify merge-graphs`: tiền tố `tag::`, lệch id cộng đồng, cạnh liên repo."""
    import networkx as nx
    from nexgraph_engine.adapters.graphify.serve import prefix_graph_for_global
    from nexgraph_engine.adapters.graphify.serve import write_json_atomic
    from networkx.readwrite import json_graph

    from nexgraph_engine.export.run import write_new_file

    tags = _tags(members)
    merged, offset, truncated = nx.Graph(), 0, False
    for m in members:
        bg = build_nx(GraphStore(m.conn))
        truncated |= bg.truncated
        for _, _, d in bg.G.edges(data=True):
            d["_src"], d["_tgt"] = d.pop("source"), d.pop("target")  # giữ chiều cạnh qua graph vô hướng
        prefixed = prefix_graph_for_global(bg.G, tags[m.project_id], community_offset=offset)
        cids = [d["community"] for _, d in prefixed.nodes(data=True) if isinstance(d.get("community"), int)]
        offset = max([offset, *(c + 1 for c in cids)])
        merged.update(prefixed)
    for e in cross:
        a = f"{tags[e['du_an_nguon']]}::{e['id_nut_nguon']}"
        b = f"{tags[e['du_an_dich']]}::{e['id_nut_dich']}"
        if a in merged and b in merged and not merged.has_edge(a, b):
            merged.add_edge(a, b, relation=_RELATION[e["loai_con"]], confidence="INFERRED",
                            confidence_score=e["diem_tin_cay"], context="cross_repo",
                            source_file=e["tep_bang_chung"] or "", weight=1.0, _src=a, _tgt=b,
                            source_location=f"L{e['dong_bang_chung']}" if e["dong_bang_chung"] else "")
    data = json_graph.node_link_data(merged, edges="links")
    for link in data["links"]:
        link["source"], link["target"] = link.pop("_src", link["source"]), link.pop("_tgt", link["target"])
    data["hyperedges"] = []
    # Tệp cũ của người dùng không bị ghi đè: ghi tạm rồi link sang tên mới (GFY-09).
    target = write_new_file(Path(out_dir) / GLOBAL_EXPORT_NAME,
                            lambda path: write_json_atomic(path, data, compact=True))
    return {"files": [str(target)], "nodes": merged.number_of_nodes(), "edges": merged.number_of_edges(),
            "truncated": truncated}
