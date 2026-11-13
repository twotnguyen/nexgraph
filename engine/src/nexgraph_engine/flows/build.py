"""Dựng, chấm điểm và lưu luồng thực thi (F11).

Ported from code-review-graph (commit 29d8bd94312a02dc85b2f4e3e6c97ebe7e768fb8, MIT License)
Modified by NexGraph contributors, 2026.
"""
from __future__ import annotations

import sqlite3
from collections import deque
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from nexgraph_engine.flows.entry import EntryPoint, detect_entry_points
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


_META_SQL = """
    SELECT n.ma_nut, n.nhan, n.ten_day_du, t.duong_dan_tuong_doi AS file,
           EXISTS (
               SELECT 1 FROM canh c
               WHERE c.loai_canh = 'TESTED_BY' AND c.ma_nut_nguon = n.ma_nut
           ) AS has_test
    FROM nut n
    LEFT JOIN tep t ON t.ma_tep = n.ma_tep
    WHERE n.loai_nut IN ('function', 'method') AND n.la_kiem_thu = 0
"""
_INSERT_FLOW = """
    INSERT INTO luong (ma_nut_vao, ten, loai_vao, mo_ta_vao, so_buoc, so_tep, do_sau, diem, bi_cat)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
"""
_INSERT_STEP = """
    INSERT INTO buoc_luong (ma_luong, thu_tu, ma_nut, do_sau, ma_nut_goi, dong_bang_chung)
    VALUES (?, ?, ?, ?, ?, ?)
"""


def _is_sensitive(qualified_name: str) -> bool:
    low = qualified_name.lower()
    return any(kw in low for kw in SECURITY_KEYWORDS)


def _score(steps: list[Step], meta, sensitive) -> tuple[int, int, int, float]:
    """(số bước, số tệp, độ sâu, điểm). `meta`/`sensitive` tra theo khoá chính của nút (dict hoặc bảng tra lười)."""
    so_buoc = len(steps)
    rows = [m for m in (meta.get(s.pk) for s in steps) if m is not None]
    so_tep = max(len({m["file"] for m in rows if m["file"]}), 1)
    do_sau = max(s.depth for s in steps)
    file_spread = min((so_tep - 1) / 4.0, 1.0)
    depth_score = min(do_sau / 8.0, 1.0)
    security = sum(1 for s in steps if sensitive.get(s.pk)) / so_buoc
    test_gap = 1.0 - (sum(1 for m in rows if m["has_test"]) / so_buoc)
    diem = round(0.35 * file_spread + 0.30 * security + 0.20 * test_gap + 0.15 * depth_score, 4)
    return so_buoc, so_tep, do_sau, diem


def _insert_flow(cur: sqlite3.Cursor, entry: EntryPoint, steps: list[Step], stats: tuple[int, int, int, float], cut: bool) -> None:
    so_buoc, so_tep, do_sau, diem = stats
    cur.execute(_INSERT_FLOW, (entry.pk, entry.label, entry.kind, entry.detail, so_buoc, so_tep, do_sau, diem, 1 if cut else 0))
    ma_luong = cur.lastrowid
    cur.executemany(_INSERT_STEP, [(ma_luong, idx, s.pk, s.depth, s.caller_pk, s.line) for idx, s in enumerate(steps)])


def rebuild_flows(store: GraphStore, root: Path) -> int:
    """Dò điểm vào, dựng BFS, chấm điểm và lưu vào CSDL."""
    entry_points = detect_entry_points(store.conn, root)
    if not entry_points:
        store.conn.execute("DELETE FROM luong")
        store.commit()
        return 0

    adj = load_adjacency(store.conn)
    nodes_meta = {row["ma_nut"]: row for row in store.conn.execute(_META_SQL)}
    # Tính một lần cho mỗi nút: cùng một nút nằm trong hàng nghìn luồng (6 triệu phép so chuỗi, 1,4 s ở hermes-agent).
    sensitive = {pk: _is_sensitive(m["ten_day_du"]) for pk, m in nodes_meta.items()}

    candidates = []
    for entry in entry_points:
        steps, cut = trace(adj, entry.pk)
        if len(steps) < 2:
            continue
        candidates.append((_score(steps, nodes_meta, sensitive), entry, steps, cut))

    # Điểm giảm dần, tên tăng dần; cùng điểm cùng tên thì theo id nút (thứ tự của entry_points).
    candidates.sort(key=lambda c: (-c[0][3], c[1].label))
    candidates = candidates[:MAX_FLOWS]

    cur = store.conn.cursor()
    cur.execute("DELETE FROM luong")
    for stats, entry, steps, cut in candidates:
        _insert_flow(cur, entry, steps, stats, cut)
    store.commit()
    return len(candidates)


# --- Cập nhật cục bộ sau refresh -------------------------------------------------------------------------
#
# Một luồng chỉ phụ thuộc vào: cách phân loại điểm vào của nó, danh sách CALLS đi ra của các nút nó đi qua, và
# tệp/tên/có-test của các nút đó. Sau một lần refresh:
# - `through`: nút của các tệp bị thay (trước và sau), nguồn của cạnh bộ phân giải vừa tạo, và nút vừa đổi trạng thái
#   có/không có test. Luồng nào đi qua một nút như vậy phải dò lại.
# - `callees`: đích CALLS (trước và sau) của các nút đó. Luồng đi qua chúng không đổi, nhưng chính chúng có thể vừa
#   thành hoặc thôi là điểm vào kiểu "gốc" (có/không còn ai gọi), nên chỉ xét lại chúng với tư cách điểm vào.
# Luồng nào không chạm `through` và có điểm vào ngoài cả hai tập thì giữ nguyên.
# Khi bảng đang đầy MAX_FLOWS, các ứng viên bị cắt không được lưu nên không biết điểm của chúng: phải tính lại cả
# những điểm vào đi tới được `through`, và nếu sau đó luồng xếp cuối tệ hơn luồng xếp cuối cũ thì dựng lại toàn bộ.

MAX_TOUCHED = 4000  # quá mức này thì dựng lại toàn bộ rẻ hơn


@dataclass(frozen=True)
class FlowsBefore:
    nodes: frozenset[int]                        # nút của các tệp sắp đổi (trước khi sửa CSDL)
    callees: dict[int, bool]                     # đích CALLS của chúng -> đang có test hay không
    capped: bool                                 # bảng luồng đang đầy MAX_FLOWS
    worst: tuple[float, str, str] | None         # (điểm, tên, id nút vào) của luồng xếp cuối


def _temp_pks(conn: sqlite3.Connection, pks: Iterable[int]) -> None:
    conn.execute("DROP TABLE IF EXISTS temp._pks")
    conn.execute("CREATE TEMP TABLE _pks (pk INTEGER PRIMARY KEY)")
    conn.executemany("INSERT OR IGNORE INTO temp._pks VALUES (?)", ((pk,) for pk in pks))


def _chunked(items: list[int], size: int = 500):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _nodes_of(conn: sqlite3.Connection, files: Iterable[str]) -> set[int]:
    out: set[int] = set()
    for rel in files:
        out.update(r[0] for r in conn.execute(
            "SELECT n.ma_nut FROM nut n JOIN tep t ON t.ma_tep = n.ma_tep WHERE t.duong_dan_tuong_doi = ?", (rel,)))
    return out


def _callees_of(conn: sqlite3.Connection, pks: Iterable[int]) -> set[int]:
    out: set[int] = set()
    for chunk in _chunked(list(pks)):
        out.update(r[0] for r in conn.execute(
            f"SELECT ma_nut_dich FROM canh WHERE loai_canh = 'CALLS' AND ma_nut_nguon IN ({','.join('?' * len(chunk))})",
            chunk))
    return out


def _has_test(conn: sqlite3.Connection, pks: Iterable[int]) -> dict[int, bool]:
    pks = list(pks)
    out = dict.fromkeys(pks, False)
    for chunk in _chunked(pks):
        for r in conn.execute(
                "SELECT DISTINCT ma_nut_nguon FROM canh WHERE loai_canh = 'TESTED_BY' AND ma_nut_nguon IN"
                f" ({','.join('?' * len(chunk))})", chunk):
            out[r[0]] = True
    return out


def _worst(conn: sqlite3.Connection) -> tuple[float, str, str] | None:
    row = conn.execute(
        "SELECT l.diem, l.ten, n.id_nut FROM luong l JOIN nut n ON n.ma_nut = l.ma_nut_vao"
        " ORDER BY l.diem ASC, l.ten DESC, n.id_nut DESC LIMIT 1").fetchone()
    return (row[0], row[1], row[2]) if row else None


def flows_before(store: GraphStore, files: Iterable[str]) -> FlowsBefore:
    """Gọi TRƯỚC khi refresh sửa CSDL, với các tệp sắp bị thay hoặc xoá."""
    conn = store.conn
    nodes = _nodes_of(conn, files)
    count = conn.execute("SELECT count(*) FROM luong").fetchone()[0]
    return FlowsBefore(frozenset(nodes), _has_test(conn, _callees_of(conn, nodes)), count >= MAX_FLOWS, _worst(conn))


class _Lazy(dict):
    """Bảng tra theo khoá chính của nút, hỏi CSDL ở lần đầu cần tới."""

    def __init__(self, fetch) -> None:
        super().__init__()
        self._fetch = fetch

    def get(self, key, default=None):
        if key not in self:
            self[key] = self._fetch(key)
        value = self[key]
        return default if value is None else value


def update_flows(store: GraphStore, root: Path, before: FlowsBefore, files: Iterable[str],
                 new_edges: Iterable[tuple[int, int]] = ()) -> int:
    """Cập nhật bảng luồng sau một lần refresh cho ra đúng kết quả của `rebuild_flows` (trừ mã luồng).

    `files`: tệp vừa thêm hoặc thay; `new_edges`: (nguồn, đích) của các cạnh bộ phân giải vừa tạo.
    """
    conn = store.conn
    new_edges = list(new_edges)
    through = set(before.nodes) | _nodes_of(conn, files) | {s for s, _ in new_edges}
    callees = set(before.callees) | _callees_of(conn, through) | {t for _, t in new_edges}
    if len(through) + len(callees) > MAX_TOUCHED:
        return rebuild_flows(store, root)
    # Nút đổi trạng thái có/không test làm đổi điểm của mọi luồng đi qua nó. Đích mới (chưa ghi nhận trước đó) chỉ có thể
    # chuyển từ không sang có; nó đã có test từ trước nếu còn test nằm ngoài các nút vừa đổi.
    now = _has_test(conn, callees)
    _temp_pks(conn, through)
    for pk, tested in now.items():
        if pk in before.callees:
            flipped = tested != before.callees[pk]
        else:
            flipped = tested and conn.execute(
                "SELECT 1 FROM canh WHERE loai_canh = 'TESTED_BY' AND ma_nut_nguon = ?"
                " AND ma_nut_dich NOT IN (SELECT pk FROM temp._pks) LIMIT 1", (pk,)).fetchone() is None
        if flipped:
            through.add(pk)
    _temp_pks(conn, through)
    # Luồng đi qua `through`, và luồng vừa mất bước vì nút của nó bị xoá (khoá ngoại xoá dây chuyền).
    evaluate = through | callees
    evaluate.update(r[0] for r in conn.execute(
        "SELECT l.ma_nut_vao FROM luong l WHERE EXISTS (SELECT 1 FROM buoc_luong b JOIN temp._pks p ON p.pk = b.ma_nut"
        " WHERE b.ma_luong = l.ma_luong)"
        " OR l.so_buoc <> (SELECT count(*) FROM buoc_luong b WHERE b.ma_luong = l.ma_luong)"))
    if before.capped:
        frontier, seen = list(through), set(through)
        for _ in range(MAX_DEPTH):
            nxt: list[int] = []
            for chunk in _chunked(frontier):
                for r in conn.execute(
                        "SELECT DISTINCT ma_nut_nguon FROM canh WHERE loai_canh = 'CALLS' AND ma_nut_dich IN"
                        f" ({','.join('?' * len(chunk))})", chunk):
                    if r[0] not in seen:
                        seen.add(r[0])
                        nxt.append(r[0])
            if len(seen) > MAX_TOUCHED:
                return rebuild_flows(store, root)
            frontier = nxt
        evaluate |= seen
    if len(evaluate) > MAX_TOUCHED:
        return rebuild_flows(store, root)

    _temp_pks(conn, evaluate)
    conn.execute("DELETE FROM luong WHERE ma_nut_vao IN (SELECT pk FROM temp._pks)")
    entries = detect_entry_points(conn, root, only_temp_pks=True)

    def callees_of(pk: int) -> list[tuple[int, int]]:
        return [(r[0], r[1]) for r in conn.execute(
            "SELECT c.ma_nut_dich, c.dong_bang_chung FROM canh c"
            " JOIN nut ns ON ns.ma_nut = c.ma_nut_nguon JOIN nut nd ON nd.ma_nut = c.ma_nut_dich"
            " WHERE c.ma_nut_nguon = ? AND c.loai_canh = 'CALLS'"
            " AND ns.loai_nut IN ('function', 'method') AND ns.la_kiem_thu = 0"
            " AND nd.loai_nut IN ('function', 'method') AND nd.la_kiem_thu = 0"
            " ORDER BY c.dong_bang_chung ASC, nd.id_nut ASC", (pk,))]

    adj = _Lazy(callees_of)
    meta = _Lazy(lambda pk: conn.execute(_META_SQL + " AND n.ma_nut = ?", (pk,)).fetchone())
    sensitive = _Lazy(lambda pk: (m := meta.get(pk)) is not None and _is_sensitive(m["ten_day_du"]))
    cur = conn.cursor()
    for entry in entries:
        steps, cut = trace(adj, entry.pk)
        if len(steps) >= 2:
            _insert_flow(cur, entry, steps, _score(steps, meta, sensitive), cut)
    conn.execute("DROP TABLE IF EXISTS temp._pks")
    # Cắt về MAX_FLOWS theo đúng thứ tự của rebuild_flows.
    conn.execute(
        "DELETE FROM luong WHERE ma_luong IN (SELECT l.ma_luong FROM luong l JOIN nut n ON n.ma_nut = l.ma_nut_vao"
        " ORDER BY l.diem DESC, l.ten ASC, n.id_nut ASC LIMIT -1 OFFSET ?)", (MAX_FLOWS,))
    count = conn.execute("SELECT count(*) FROM luong").fetchone()[0]
    if before.capped:
        worst = _worst(conn)
        old = before.worst
        # Ứng viên chưa lưu đều xếp sau `old`; chỉ khi luồng xếp cuối mới không tệ hơn `old` thì chắc chắn không sót ai.
        if count < MAX_FLOWS or worst is None or old is None or (-worst[0], worst[1], worst[2]) > (-old[0], old[1], old[2]):
            return rebuild_flows(store, root)
    store.commit()
    return count
