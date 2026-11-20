"""Cạnh liên repo của graph chung (W8), tính lại từ đầu mỗi lần.

Hai lượt của graphify vendor chạy trên một `nx.Graph` dựng gọn từ CSDL các thành viên. Graph này mang
đúng thuộc tính mà hai lượt đó đọc: `repo`, `_callable_class`, cạnh `method`, `metadata.unresolved_calls`.
Lời gọi phương thức (`calc.add()`) do `cross_repo_calls` nối, kiểu trùng do `cross_repo_types` nối.
Lời gọi tên trần (`formatSum()`, `new Calculator()`) thì vendor không xử lý, nên NexGraph thêm một lượt:
chỉ nối khi tệp gọi có import chưa phân giải trỏ tới package của dự án đích, và tên là duy nhất ở đó.
"""
from __future__ import annotations

import json
import re
import sqlite3
import threading
from collections import defaultdict
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

import networkx as nx

from nexgraph_engine.global_graph.store import GlobalStore
from nexgraph_engine.schema.db import SchemaOutdatedError, SchemaVersionError, open_graph_db
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.projects import ProjectInfo, ProjectRegistry

CLASS_KINDS = ("class", "mixin", "enum", "widget", "screen")
SYMBOL_KINDS = (*CLASS_KINDS, "function", "method")
# Ngôn ngữ của NexGraph -> khoá `_LANG_SUFFIXES` của cross_repo_calls. C# bỏ qua: lượt C# của vendor cần
# namespace/using mà CSDL không lưu, nên mọi lời gọi C# đều bị loại.
_VENDOR_LANG = {"typescript": "typescript", "javascript": "typescript", "java": "java", "kotlin": "kotlin",
                "go": "go", "swift": "swift", "php": "php", "cpp": "cpp", "c": "cpp", "objc": "objc"}
_IDENT = re.compile(r"[A-Za-z_$][\w$]*")
_LOCK = threading.Lock()  # một lần relink tại một thời điểm trong tiến trình


@dataclass
class Member:
    project_id: str
    info: ProjectInfo
    conn: sqlite3.Connection


def gid(pid: str, node_id: str) -> str:
    return f"{pid}::{node_id}"


def split_gid(value: str) -> tuple[str, str]:
    pid, _, node_id = value.partition("::")
    return pid, node_id


@contextmanager
def open_members(data_dir: Path, registry: ProjectRegistry, project_ids: list[str] | None = None
                 ) -> Iterator[tuple[list[Member], list[str]]]:
    """Mở chỉ đọc CSDL của các thành viên còn dùng được; trả kèm danh sách id bị bỏ qua.

    Bỏ qua: dự án đã gỡ khỏi app, mất thư mục, chưa index xong, CSDL hỏng hoặc khác phiên bản.
    """
    ids = [pid for pid, _ in GlobalStore(data_dir).members(read_only=True)]
    if project_ids is not None:
        wanted = set(project_ids)
        ids = [pid for pid in ids if pid in wanted]
    members, skipped = [], []
    try:
        for pid in ids:
            info = registry.get(pid)
            if info is None or not info.path.is_dir() or not info.graph_db.is_file():
                skipped.append(pid)
                continue
            try:
                conn = open_graph_db(info.graph_db, read_only=True)
            except (sqlite3.Error, OSError, SchemaOutdatedError, SchemaVersionError):
                skipped.append(pid)
                continue
            if not GraphStore(conn).has_published_graph():
                conn.close()
                skipped.append(pid)
                continue
            members.append(Member(pid, info, conn))
        yield members, skipped
    finally:
        for m in members:
            m.conn.close()


def package_keys(root: Path) -> set[str]:
    """Tên mà dự án khác dùng để import dự án này, theo dạng id của graphify (`@demo/mathlib` -> `demo_mathlib`).

    shortcut: chỉ đọc `package.json` và tên thư mục; thêm pyproject/go.mod/pubspec khi cần nối Python/Go/Dart.
    """
    from graphify.extract import _make_id
    names = {root.name}
    try:
        names.add(str(json.loads((root / "package.json").read_text(encoding="utf-8")).get("name") or ""))
    except (OSError, ValueError, AttributeError):
        pass
    return {_make_id(n) for n in names if n and _make_id(n)}


def _imports_key(ref: str, keys: set[str]) -> bool:
    bare = ref.removeprefix("ref_")
    return any(bare == k or bare.startswith(k + "_") for k in keys)


def member_graph(m: Member) -> tuple[nx.Graph, dict]:
    """Graph gọn của một thành viên cho lượt vendor, kèm dữ kiện cho lượt import (`imports`, `bare`, `top`)."""
    c, pid = m.conn, m.project_id
    G = nx.Graph()
    marks = ",".join("?" * len(SYMBOL_KINDS))
    rows = c.execute(
        "SELECT n.ma_nut, n.id_nut, n.loai_nut, n.nhan, n.ten_day_du, t.duong_dan_tuong_doi AS tep, t.ngon_ngu"
        f" FROM nut n JOIN tep t ON t.ma_tep = n.ma_tep WHERE n.loai_nut IN ({marks})", SYMBOL_KINDS).fetchall()
    by_pk = {r["ma_nut"]: r for r in rows}
    top: dict[str, list[str]] = defaultdict(list)  # tên trần -> nút cấp cao nhất (hàm/lớp không lồng)
    for r in rows:
        is_class = r["loai_nut"] in CLASS_KINDS
        # Không có namespace trong CSDL: dùng thư mục của tệp, nên chỉ kiểu cùng tên ở cùng đường dẫn mới nối.
        G.add_node(gid(pid, r["id_nut"]), label=r["nhan"], source_file=r["tep"], repo=pid, local_id=r["id_nut"],
                   _callable_class=is_class,
                   metadata={"namespace": str(PurePosixPath(r["tep"]).parent)} if is_class else {})
        if r["loai_nut"] in ("function", *CLASS_KINDS) and r["ten_day_du"] == r["nhan"]:
            top[r["nhan"]].append(r["id_nut"])

    parent: dict[int, int] = {}
    for a, b in c.execute("SELECT ma_nut_nguon, ma_nut_dich FROM canh WHERE loai_canh = 'DEFINES'"):
        parent[b] = a
        if a in by_pk and b in by_pk and by_pk[a]["loai_nut"] in CLASS_KINDS and by_pk[b]["loai_nut"] == "method":
            G.add_edge(gid(pid, by_pk[a]["id_nut"]), gid(pid, by_pk[b]["id_nut"]), relation="method")

    types: dict[tuple[int, str], str] = {(r[0], r[1]): r[2] for r in c.execute("SELECT ma_nut, ten, kieu FROM kieu_bien")}

    def receiver_type(pk: int, recv: str) -> str | None:
        seen = set()
        while pk is not None and pk not in seen:  # khai báo ở hàm, rồi lớp chứa, rồi tệp
            seen.add(pk)
            if (pk, recv) in types:
                found = _IDENT.match(types[(pk, recv)])
                return found.group(0) if found else None
            pk = parent.get(pk)
        return recv if recv[:1].isupper() else None  # gọi tĩnh `Calculator.create()`

    imports: dict[str, set[str]] = defaultdict(set)
    bare: list[tuple[str, str, str, int]] = []  # (id nút gọi, tên, tệp, dòng)
    for r in c.execute(
            "SELECT t.ma_nut_nguon, t.ten_tham_chieu, t.loai_tham_chieu, t.dong, n.id_nut, f.duong_dan_tuong_doi AS tep,"
            " f.ngon_ngu FROM tham_chieu_chua_phan_giai t JOIN nut n ON n.ma_nut = t.ma_nut_nguon"
            " JOIN tep f ON f.ma_tep = n.ma_tep WHERE t.trang_thai = 'that_bai' AND t.loai_tham_chieu IN ('CALLS', 'IMPORTS')"):
        if r["loai_tham_chieu"] == "IMPORTS":
            imports[r["tep"]].add(r["ten_tham_chieu"])
            continue
        name = r["ten_tham_chieu"]
        if "." not in name:
            bare.append((r["id_nut"], name, r["tep"], r["dong"]))
            continue
        lang = _VENDOR_LANG.get(r["ngon_ngu"])
        recv, _, callee = name.rpartition(".")
        rtype = receiver_type(r["ma_nut_nguon"], recv.rpartition(".")[2]) if lang else None
        node = gid(pid, r["id_nut"])
        if rtype and callee and node in G:
            G.nodes[node]["metadata"].setdefault("unresolved_calls", []).append(
                {"lang": lang, "receiver_type": rtype, "callee": callee, "file": r["tep"], "line": r["dong"]})
    return G, {"imports": imports, "bare": bare, "top": top}


def _row(src: str, dst: str, type_: str, sub: str, score: float, file: str | None, line) -> dict:
    (sp, sn), (dp, dn) = split_gid(src), split_gid(dst)
    return {"du_an_nguon": sp, "id_nut_nguon": sn, "du_an_dich": dp, "id_nut_dich": dn, "loai_canh": type_,
            "loai_con": sub, "diem_tin_cay": score, "tep_bang_chung": file or None,
            "dong_bang_chung": line if isinstance(line, int) and line >= 1 else None}


def compute_links(members: list[Member]) -> list[dict]:
    from graphify.cross_repo_calls import CROSS_REPO_CALL_MARKER, link_cross_repo_member_calls
    from graphify.cross_repo_types import SHARED_TYPE_RELATION, link_shared_type_declarations

    merged = nx.Graph()
    facts: dict[str, dict] = {}
    for m in members:
        G, facts[m.project_id] = member_graph(m)
        merged.update(G)  # id đã có tiền tố dự án nên không đụng nhau
    link_shared_type_declarations(merged)
    link_cross_repo_member_calls(merged)

    rows = []
    for u, v, d in merged.edges(data=True):
        if d.get(CROSS_REPO_CALL_MARKER):
            rows.append(_row(d["_src"], d["_tgt"], "CALLS", "member_call", d.get("confidence_score", 0.85),
                             d.get("source_file"), d.get("source_location")))
        elif d.get("relation") == SHARED_TYPE_RELATION:
            rows.append(_row(d["_src"], d["_tgt"], "REFERENCES", "same_type_as", d.get("confidence_score", 0.85),
                             d.get("source_file"), None))

    keys = {m.project_id: package_keys(m.info.path) for m in members}
    for m in members:
        f = facts[m.project_id]
        for caller, name, file, line in f["bare"]:
            refs = f["imports"].get(file, ())
            targets = [(pid, nid) for pid, k in keys.items() if pid != m.project_id
                       and any(_imports_key(r, k) for r in refs) for nid in facts[pid]["top"].get(name, ())]
            if len(targets) == 1:  # một định nghĩa duy nhất trong các package được import, như vendor
                rows.append(_row(gid(m.project_id, caller), gid(*targets[0]), "CALLS", "import_symbol", 0.8, file, line))
    return rows


def relink(data_dir: Path, registry: ProjectRegistry) -> dict:
    """Tính lại toàn bộ cạnh liên repo và ghi đè vào global.db."""
    with _LOCK:
        with open_members(data_dir, registry) as (members, skipped):
            rows = compute_links(members)
        return {"edges": GlobalStore(data_dir).replace_edges(rows), "skipped": skipped}


def cross_repo_impact(data_dir: Path, project_id: str, node_ids: list[str]) -> list[dict]:
    """Nút ở repo khác phụ thuộc vào `node_ids` của `project_id` (cho review PR, W7). Chỉ đọc.

    Trả `[{project_id, node_id, via, type, subtype, file, line}]`: `node_id` ở repo `project_id` khác gọi
    (hoặc cùng kiểu với) `via`. Dự án không trong graph chung thì trả rỗng.
    """
    wanted = set(node_ids)
    out = []
    for e in GlobalStore(data_dir).edges(read_only=True):
        if e["du_an_dich"] == project_id and e["id_nut_dich"] in wanted:
            other, node, via = e["du_an_nguon"], e["id_nut_nguon"], e["id_nut_dich"]
        elif e["loai_con"] == "same_type_as" and e["du_an_nguon"] == project_id and e["id_nut_nguon"] in wanted:
            other, node, via = e["du_an_dich"], e["id_nut_dich"], e["id_nut_nguon"]
        else:
            continue
        out.append({"project_id": other, "node_id": node, "via": via, "type": e["loai_canh"],
                    "subtype": e["loai_con"], "file": e["tep_bang_chung"], "line": e["dong_bang_chung"]})
    return out
