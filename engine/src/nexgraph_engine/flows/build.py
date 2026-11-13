"""Dựng, chấm điểm và lưu luồng thực thi (F11).

Ported from code-review-graph (commit 29d8bd94312a02dc85b2f4e3e6c97ebe7e768fb8, MIT License)
Modified by NexGraph contributors, 2026.
"""
from __future__ import annotations

import sqlite3
from collections import deque
from dataclasses import dataclass
from pathlib import Path

from nexgraph_engine.flows.entry import detect_entry_points
from nexgraph_engine.store.graph_store import GraphStore

MAX_DEPTH = 8
MAX_STEPS = 60
MAX_FLOWS = 2000

SECURITY_KEYWORDS: frozenset[str] = frozenset({
    "auth", "login", "password", "token", "session", "crypt", "secret",
    "credential", "permission", "sql", "query", "execute", "connect",
    "socket", "request", "http", "sanitize", "validate", "encrypt",
    "decrypt", "hash", "sign", "verify", "admin", "privilege",
})


@dataclass(frozen=True)
class Step:
    pk: int
    depth: int
    caller_pk: int | None
    line: int | None


def load_adjacency(conn: sqlite3.Connection) -> dict[int, list[tuple[int, int]]]:
    """Tải danh sách kề các cạnh CALLS giữa các nút function/method không test."""
    sql = """
    SELECT c.ma_nut_nguon, c.ma_nut_dich, c.dong_bang_chung, nd.id_nut
    FROM canh c
    JOIN nut ns ON ns.ma_nut = c.ma_nut_nguon
    JOIN nut nd ON nd.ma_nut = c.ma_nut_dich
    WHERE c.loai_canh = 'CALLS'
      AND ns.loai_nut IN ('function', 'method') AND ns.la_kiem_thu = 0
      AND nd.loai_nut IN ('function', 'method') AND nd.la_kiem_thu = 0
    ORDER BY c.ma_nut_nguon, c.dong_bang_chung ASC, nd.id_nut ASC
    """
    adj: dict[int, list[tuple[int, int]]] = {}
    for r in conn.execute(sql):
        adj.setdefault(r[0], []).append((r[1], r[2]))
    return adj


def trace(adj: dict[int, list[tuple[int, int]]], entry_pk: int) -> tuple[list[Step], bool]:
    """Duyệt BFS từ điểm vào theo các cạnh CALLS."""
    steps: list[Step] = [Step(pk=entry_pk, depth=0, caller_pk=None, line=None)]
    visited: set[int] = {entry_pk}
    queue: deque[tuple[int, int]] = deque([(entry_pk, 0)])
    cut = False

    while queue:
        current_pk, current_depth = queue.popleft()
        if current_depth >= MAX_DEPTH:
            continue
        children = adj.get(current_pk, [])
        for child_pk, line in children:
            if child_pk in visited:
                continue
            if len(steps) >= MAX_STEPS:
                cut = True
                break
            visited.add(child_pk)
            steps.append(Step(pk=child_pk, depth=current_depth + 1, caller_pk=current_pk, line=line))
            queue.append((child_pk, current_depth + 1))
        if cut:
            break

    return steps, cut


def rebuild_flows(store: GraphStore, root: Path) -> int:
    """Dò điểm vào, dựng BFS, chấm điểm và lưu vào CSDL."""
    entry_points = detect_entry_points(store.conn, root)
    if not entry_points:
        store.conn.execute("DELETE FROM luong")
        store.commit()
        return 0

    adj = load_adjacency(store.conn)
    nodes_meta = {
        row["ma_nut"]: row
        for row in store.conn.execute(
            """
            SELECT n.ma_nut, n.nhan, n.ten_day_du, t.duong_dan_tuong_doi AS file,
                   EXISTS (
                       SELECT 1 FROM canh c
                       WHERE c.loai_canh = 'TESTED_BY' AND c.ma_nut_nguon = n.ma_nut
                   ) AS has_test
            FROM nut n
            LEFT JOIN tep t ON t.ma_tep = n.ma_tep
            WHERE n.loai_nut IN ('function', 'method') AND n.la_kiem_thu = 0
            """
        )
    }

    # Tính một lần cho mỗi nút: cùng một nút nằm trong hàng nghìn luồng (6 triệu phép so chuỗi, 1,4 s ở hermes-agent).
    sensitive = {pk: any(kw in m["ten_day_du"].lower() for kw in SECURITY_KEYWORDS) for pk, m in nodes_meta.items()}

    candidates = []
    for entry in entry_points:
        steps, cut = trace(adj, entry.pk)
        if len(steps) < 2:
            continue

        so_buoc = len(steps)
        files = {nodes_meta[s.pk]["file"] for s in steps if s.pk in nodes_meta and nodes_meta[s.pk]["file"]}
        so_tep = max(len(files), 1)
        do_sau = max(s.depth for s in steps)

        file_spread = min((so_tep - 1) / 4.0, 1.0)
        depth_score = min(do_sau / 8.0, 1.0)

        sec_hits = sum(1 for s in steps if sensitive.get(s.pk))
        security = sec_hits / so_buoc

        test_hits = sum(1 for s in steps if s.pk in nodes_meta and nodes_meta[s.pk]["has_test"])
        test_gap = 1.0 - (test_hits / so_buoc)

        diem = round(0.35 * file_spread + 0.30 * security + 0.20 * test_gap + 0.15 * depth_score, 4)
        candidates.append((diem, entry, steps, so_buoc, so_tep, do_sau, cut))

    # Sắp theo điểm giảm dần, tên tăng dần
    candidates.sort(key=lambda c: (-c[0], c[1].label))
    candidates = candidates[:MAX_FLOWS]

    cur = store.conn.cursor()
    cur.execute("DELETE FROM luong")

    for diem, entry, steps, so_buoc, so_tep, do_sau, cut in candidates:
        cur.execute(
            """
            INSERT INTO luong (ma_nut_vao, ten, loai_vao, mo_ta_vao, so_buoc, so_tep, do_sau, diem, bi_cat)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                entry.pk,
                entry.label,
                entry.kind,
                entry.detail,
                so_buoc,
                so_tep,
                do_sau,
                diem,
                1 if cut else 0,
            ),
        )
        ma_luong = cur.lastrowid
        step_rows = [
            (ma_luong, idx, s.pk, s.depth, s.caller_pk, s.line)
            for idx, s in enumerate(steps)
        ]
        cur.executemany(
            """
            INSERT INTO buoc_luong (ma_luong, thu_tu, ma_nut, do_sau, ma_nut_goi, dong_bang_chung)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            step_rows,
        )

    store.commit()
    return len(candidates)
