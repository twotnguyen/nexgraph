"""Truy vấn các luồng thực thi (F11)."""
from __future__ import annotations

import sqlite3
from typing import Any

from nexgraph_engine.errors import ApiError
from nexgraph_engine.flows.build import MAX_DEPTH, load_adjacency, trace
from nexgraph_engine.store.json_v1 import node_json
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.models import Node

VALID_KINDS = {"main", "route", "cli", "event", "root"}


def _flow_summary(store: GraphStore, row: sqlite3.Row) -> dict[str, Any]:
    entry_node = store.nodes_by_pk([row["ma_nut_vao"]])[0]
    return {
        "id": row["ma_luong"],
        "name": row["ten"],
        "kind": row["loai_vao"],
        "detail": row["mo_ta_vao"],
        "entry": node_json(entry_node),
        "steps": row["so_buoc"],
        "files": row["so_tep"],
        "depth": row["do_sau"],
        "criticality": row["diem"],
        "truncated": bool(row["bi_cat"]),
    }


def list_flows_json(
    store: GraphStore,
    q: str | None = None,
    kind: str | None = None,
    node: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """Danh sách các luồng theo bộ lọc và phân trang."""
    if kind is not None and kind not in VALID_KINDS:
        raise ApiError(400, "bad_param", f"Loại điểm vào không hợp lệ: {kind}")

    where_clauses: list[str] = []
    params: list[Any] = []

    if node is not None:
        try:
            node_pk = store.pk_of(node)
        except KeyError as exc:
            raise ApiError(404, "unknown_node", f"Không có nút {node}") from exc
        where_clauses.append(
            "EXISTS (SELECT 1 FROM buoc_luong b WHERE b.ma_luong = l.ma_luong AND b.ma_nut = ?)"
        )
        params.append(node_pk)

    if kind is not None:
        where_clauses.append("l.loai_vao = ?")
        params.append(kind)

    order_by = "l.diem DESC, l.ten ASC, l.ma_luong ASC"

    if q:
        like_pat = f"%{q.strip().lower()}%"
        where_clauses.append(
            """(
                lower(l.ten) LIKE ?
                OR lower(ifnull(l.mo_ta_vao, '')) LIKE ?
                OR EXISTS (
                    SELECT 1 FROM buoc_luong b
                    JOIN nut n ON n.ma_nut = b.ma_nut
                    WHERE b.ma_luong = l.ma_luong AND lower(n.nhan) LIKE ?
                )
            )"""
        )
        params.extend([like_pat, like_pat, like_pat])
        order_by = f"""
            CASE WHEN lower(l.ten) LIKE ? OR lower(ifnull(l.mo_ta_vao, '')) LIKE ? THEN 0 ELSE 1 END,
            {order_by}
        """

    where_str = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

    # Tổng số luồng khớp
    count_sql = f"SELECT count(*) FROM luong l {where_str}"
    total = store.conn.execute(count_sql, params).fetchone()[0]

    # Danh sách luồng trang hiện tại
    # WHERE dùng `params` (đã gồm 3 like_pat khi có q), rồi ORDER BY CASE WHEN LIKE ? LIKE ?, rồi LIMIT/OFFSET.
    select_params = params + ([like_pat, like_pat] if q else []) + [limit, offset]
    sql = f"""
    SELECT l.* FROM luong l
    {where_str}
    ORDER BY {order_by}
    LIMIT ? OFFSET ?
    """
    rows = store.conn.execute(sql, select_params).fetchall()
    flows = [_flow_summary(store, r) for r in rows]
    truncated = (offset + len(flows)) < total

    return {
        "flows": flows,
        "total": total,
        "truncated": truncated,
    }


def flow_json(store: GraphStore, flow_id: int) -> dict[str, Any]:
    """Chi tiết một luồng cùng danh sách các bước."""
    row = store.conn.execute("SELECT * FROM luong WHERE ma_luong = ?", (flow_id,)).fetchone()
    if not row:
        raise ApiError(404, "unknown_flow", f"Không có luồng {flow_id}")

    summary = _flow_summary(store, row)

    step_rows = store.conn.execute(
        """
        SELECT b.thu_tu, b.do_sau, b.ma_nut, b.dong_bang_chung, ng.id_nut AS caller_id
        FROM buoc_luong b
        LEFT JOIN nut ng ON ng.ma_nut = b.ma_nut_goi
        WHERE b.ma_luong = ?
        ORDER BY b.thu_tu ASC
        """,
        (flow_id,),
    ).fetchall()

    node_pks = [r["ma_nut"] for r in step_rows]
    nodes_by_pk = dict(zip(node_pks, store.nodes_by_pk(node_pks))) if node_pks else {}

    steps = [
        {
            "order": r["thu_tu"],
            "depth": r["do_sau"],
            "node": node_json(nodes_by_pk[r["ma_nut"]]),
            "caller": r["caller_id"],
            "line": r["dong_bang_chung"],
        }
        for r in step_rows
    ]

    return {
        "flow": summary,
        "steps": steps,
    }


def trace_from_json(store: GraphStore, node_id: str) -> dict[str, Any]:
    """Lấy chi tiết luồng từ một điểm vào hoặc dựng luồng trực tiếp từ nút bất kỳ."""
    try:
        node_pk = store.pk_of(node_id)
    except KeyError as exc:
        raise ApiError(404, "unknown_node", f"Không có nút {node_id}") from exc

    # 1. Đã có trong bảng luong
    existing = store.conn.execute("SELECT ma_luong FROM luong WHERE ma_nut_vao = ?", (node_pk,)).fetchone()
    if existing:
        return flow_json(store, existing[0])

    # 2. Dựng trực tiếp tại chỗ
    adj = load_adjacency(store.conn)
    raw_steps, cut = trace(adj, node_pk)
    target_node = store.nodes_by_pk([node_pk])[0]

    step_pks = [s.pk for s in raw_steps]
    caller_pks = [s.caller_pk for s in raw_steps if s.caller_pk is not None]
    all_needed_pks = list(set(step_pks + caller_pks))
    nodes_map = dict(zip(all_needed_pks, store.nodes_by_pk(all_needed_pks))) if all_needed_pks else {}
    files = {nodes_map[s.pk].file for s in raw_steps if s.pk in nodes_map and nodes_map[s.pk].file}
    summary = {
        "id": 0,
        "name": target_node.label,
        "kind": "root",
        "detail": None,
        "entry": node_json(target_node),
        "steps": len(raw_steps),
        "files": max(len(files), 1),
        "depth": max((s.depth for s in raw_steps), default=0),
        "criticality": 0.0,
        "truncated": cut,
    }

    steps = [
        {
            "order": idx,
            "depth": s.depth,
            "node": node_json(nodes_map[s.pk]),
            "caller": nodes_map[s.caller_pk].id if s.caller_pk is not None and s.caller_pk in nodes_map else None,
            "line": s.line,
        }
        for idx, s in enumerate(raw_steps)
    ]

    return {
        "flow": summary,
        "steps": steps,
    }


def flows_for_nodes(store: GraphStore, node_pks: list[int], limit: int = 3) -> list[dict[str, Any]]:
    """FlowSummary của các luồng chứa một trong các nút; luồng có nút là điểm vào xếp trước, rồi theo điểm."""
    if not node_pks:
        return []
    placeholders = ",".join("?" for _ in node_pks)
    sql = f"""
    SELECT DISTINCT l.*,
           (l.ma_nut_vao IN ({placeholders})) AS is_entry
    FROM luong l
    JOIN buoc_luong b ON b.ma_luong = l.ma_luong
    WHERE b.ma_nut IN ({placeholders})
    ORDER BY is_entry DESC, l.diem DESC, l.ma_luong ASC
    LIMIT ?
    """
    params = list(node_pks) + list(node_pks) + [limit]
    rows = store.conn.execute(sql, params).fetchall()
    return [_flow_summary(store, r) for r in rows]
