"""Từ vùng đổi tới nút bị đổi, nút bị ảnh hưởng (lan truyền có trọng số), test liên quan và test gap."""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field

from nexgraph_engine.changes.model import ChangeSet
from nexgraph_engine.impact import params
from nexgraph_engine.schema.enums import NodeKind
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.models import Node

_SYMBOL_EXCLUDED = ("file", "directory", "repository")
# Lan ngược chiều phụ thuộc: người gọi, người import, lớp con... bị ảnh hưởng khi nút đích đổi.
_REVERSE_TYPES = ("CALLS", "INHERITS", "IMPLEMENTS", "IMPORTS", "REFERENCES", "USES_TYPE")
_CHUNK = 400


@dataclass(frozen=True)
class Impacted:
    node: Node
    score: float
    hops: int


@dataclass(frozen=True)
class ImpactReport:
    changed_nodes: list[Node] = field(default_factory=list)
    impacted: list[Impacted] = field(default_factory=list)
    tests: list[Node] = field(default_factory=list)
    test_gaps: list[Node] = field(default_factory=list)
    truncated: bool = False


def _chunks(items: list, size: int = _CHUNK):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _nodes(conn: sqlite3.Connection, pks: list[int]) -> list[Node]:
    return GraphStore(conn)._nodes_by_pk(pks)


def map_to_nodes(conn: sqlite3.Connection, changes: ChangeSet) -> list[Node]:
    """Nút ký hiệu của tệp đổi có khoảng dòng giao với một đoạn đổi (cả tệp khi không có đoạn)."""
    pks: list[int] = []
    excluded = ",".join(f"'{k}'" for k in _SYMBOL_EXCLUDED)
    for f in changes.files:
        if f.status == "D":
            continue
        rows = conn.execute(
            "SELECT n.ma_nut, n.dong_bat_dau, n.dong_ket_thuc FROM nut n JOIN tep t ON t.ma_tep = n.ma_tep"
            f" WHERE t.duong_dan_tuong_doi = ? AND n.loai_nut NOT IN ({excluded})"
            " ORDER BY n.dong_bat_dau, n.ma_nut", (f.path,)).fetchall()
        for r in rows:
            if f.ranges is None or any(
                    r["dong_bat_dau"] is not None and r["dong_bat_dau"] <= b and r["dong_ket_thuc"] >= a
                    for a, b in f.ranges):
                pks.append(r["ma_nut"])
    return _nodes(conn, pks[:params.MAX_CHANGED_NODES])


def _neighbors(conn: sqlite3.Connection, pks: list[int]) -> tuple[list[tuple[int, int, str]], bool]:
    """(nút xuất phát, nút bị ảnh hưởng, loại cạnh); mỗi nút xuất phát tối đa MAX_FAN_IN cạnh."""
    rows: list[tuple[int, int, str]] = []
    capped = False
    marks_types = ",".join(f"'{t}'" for t in _REVERSE_TYPES)
    count: dict[int, int] = {}
    for chunk in _chunks(pks):
        marks = ",".join("?" * len(chunk))
        for r in conn.execute(
                f"SELECT ma_nut_dich, ma_nut_nguon, loai_canh FROM canh WHERE ma_nut_dich IN ({marks})"
                f" AND loai_canh IN ({marks_types}) ORDER BY ma_canh", chunk):
            if count.get(r[0], 0) >= params.MAX_FAN_IN:
                capped = True
                continue
            count[r[0]] = count.get(r[0], 0) + 1
            rows.append((r[0], r[1], r[2]))
        for r in conn.execute(
                f"SELECT ma_nut_nguon, ma_nut_dich, 'TESTED_BY' FROM canh WHERE ma_nut_nguon IN ({marks})"
                " AND loai_canh = 'TESTED_BY' ORDER BY ma_canh", chunk):
            if count.get(r[0], 0) >= params.MAX_FAN_IN:
                capped = True
                continue
            count[r[0]] = count.get(r[0], 0) + 1
            rows.append((r[0], r[1], r[2]))
    return rows, capped


def propagate(conn: sqlite3.Connection, seeds: list[str]) -> tuple[list[Impacted], bool]:
    """Điểm của đường dài d = (tích trọng số các cạnh) × DECAY^(d-1); nút giữ điểm lớn nhất. Trả (kết quả, bị cắt)."""
    seed_pks: dict[int, str] = {}
    for chunk in _chunks(list(seeds)):
        for r in conn.execute(f"SELECT ma_nut, id_nut FROM nut WHERE id_nut IN ({','.join('?' * len(chunk))})", chunk):
            seed_pks[r[0]] = r[1]
    best: dict[int, tuple[float, int]] = {}
    frontier: dict[int, float] = {pk: 1.0 for pk in seed_pks}
    truncated = False
    for depth in range(1, params.MAX_DEPTH + 1):
        if not frontier:
            break
        rows, capped = _neighbors(conn, list(frontier))
        truncated |= capped
        nxt: dict[int, float] = {}
        for at, other, type_ in rows:
            if other in seed_pks:
                continue
            score = frontier[at] * params.WEIGHTS[type_] * (params.DECAY if depth > 1 else 1.0)
            if score < params.MIN_SCORE:
                continue
            cur = best.get(other)
            if cur is None or score > cur[0] + 1e-12 or (abs(score - cur[0]) <= 1e-12 and depth < cur[1]):
                best[other] = (score, depth)
            if score > nxt.get(other, 0.0):
                nxt[other] = score
        # chỉ mở rộng tiếp từ đường tốt nhất của nút (đường kém hơn không thể cho điểm cao hơn)
        frontier = {pk: sc for pk, sc in nxt.items() if best[pk] == (sc, depth)}
    ordered = sorted(best.items(), key=lambda kv: (-kv[1][0], kv[1][1], kv[0]))
    pks = [pk for pk, _ in ordered]
    by_pk = dict(zip(pks, _nodes(conn, pks))) if pks else {}
    items = [Impacted(by_pk[pk], round(sc, 6), d) for pk, (sc, d) in ordered]
    items.sort(key=lambda i: (-i.score, i.hops, i.node.id))
    return items, truncated


def tests_for(conn: sqlite3.Connection, node_id: str) -> list[Node]:
    """Test là đích TESTED_BY của nút hoặc của một người gọi nó cách tối đa 2 hop."""
    row = conn.execute("SELECT ma_nut FROM nut WHERE id_nut = ?", (node_id,)).fetchone()
    if row is None:
        return []
    covered = {row[0]}
    frontier = [row[0]]
    for _ in range(2):
        callers: list[int] = []
        for chunk in _chunks(frontier):
            for r in conn.execute(
                    f"SELECT DISTINCT ma_nut_nguon FROM canh WHERE loai_canh = 'CALLS' AND ma_nut_dich IN"
                    f" ({','.join('?' * len(chunk))}) LIMIT {params.MAX_FAN_IN}", chunk):
                if r[0] not in covered:
                    covered.add(r[0])
                    callers.append(r[0])
        frontier = callers
    test_pks: set[int] = set()
    for chunk in _chunks(list(covered)):
        for r in conn.execute(
                f"SELECT ma_nut_dich FROM canh WHERE loai_canh = 'TESTED_BY' AND ma_nut_nguon IN"
                f" ({','.join('?' * len(chunk))})", chunk):
            test_pks.add(r[0])
    nodes = _nodes(conn, sorted(test_pks))
    return sorted(nodes, key=lambda n: (n.file or "", n.line_start or 0, n.id))


def analyze(conn: sqlite3.Connection, changes: ChangeSet) -> ImpactReport:
    changed = map_to_nodes(conn, changes)
    truncated = len(changed) >= params.MAX_CHANGED_NODES
    # Nút tệp chỉ làm hạt giống khi có ký hiệu bị đổi: sửa chú thích/khoảng trắng ngoài mọi ký hiệu không ảnh hưởng ai.
    touched_files = {n.file for n in changed}
    file_seeds = [f"{p}#file" for p in sorted(f for f in touched_files if f)]
    seeds = [n.id for n in changed] + file_seeds
    propagated, cut = propagate(conn, seeds) if seeds else ([], False)
    truncated |= cut
    impacted = [i for i in propagated if not i.node.is_test]
    if len(impacted) > params.MAX_IMPACTED:
        impacted, truncated = impacted[:params.MAX_IMPACTED], True
    tests: dict[str, Node] = {}
    for n in [*changed, *(i.node for i in impacted if i.hops <= 2)]:
        for t in tests_for(conn, n.id):
            tests[t.id] = t
    gaps = [n for n in changed if n.kind in (NodeKind.METHOD, NodeKind.FUNCTION) and not n.is_test
            and not tests_for(conn, n.id)]
    return ImpactReport(changed, impacted, sorted(tests.values(), key=lambda n: (n.file or "", n.line_start or 0, n.id)),
                        gaps, truncated)
