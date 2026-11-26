"""Cạnh liên repo của graph chung (W8), tính lại từ đầu mỗi lần.

Hai lượt của graphify vendor chạy trên một `nx.Graph` dựng gọn từ CSDL các thành viên. Graph này mang
đúng thuộc tính mà hai lượt đó đọc: `repo`, `_callable_class`, cạnh `method`, `metadata.unresolved_calls`.
Lời gọi phương thức (`calc.add()`) do `cross_repo_calls` nối, kiểu trùng do `cross_repo_types` nối.
Lời gọi tên trần (`formatSum()`, `new Calculator()`) thì vendor không xử lý, nên NexGraph thêm một lượt:
chỉ nối khi câu import trong tệp gọi lấy đúng tên đó từ đúng package của dự án đích (khớp tên chính xác,
hoặc đường dẫn con `pkg/...`), và tên là duy nhất ở đó.
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

from nexgraph_engine.errors import ApiError
from nexgraph_engine.global_graph.store import GlobalStore
from nexgraph_engine.query.model_view import ModelGraph
from nexgraph_engine.query.source_policy import safe_project_path
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
# Ngôn ngữ mà thư mục của tệp gần như là namespace (package Java/Kotlin/Go, PSR-4 của PHP): chỉ những ngôn ngữ
# này được nối `same_type_as`. TS/JS/Dart/Python không có namespace nên dự án cùng template sẽ trùng giả.
_NAMESPACE_BY_DIR = frozenset({"java", "kotlin", "go", "php"})
_JS = frozenset({"typescript", "javascript"})
_JS_IMPORT = re.compile(r"""\bimport\s+(?:type\s+)?([^'";]*?)\s*\bfrom\s*['"]([^'"]+)['"]""", re.S)
_JS_REQUIRE = re.compile(r"""\b(?:const|let|var)\s+(\{[^}]*\})\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)""")
_PY_FROM = re.compile(r"^[ \t]*from\s+([\w.]+)\s+import\s+(\([^)]*\)|[^\n#]+)", re.M)
_MAX_SOURCE = 1024 * 1024
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


def package_names(root: Path) -> set[str]:
    """Tên mà dự án khác dùng để import dự án này: `name` của `package.json`; không có tệp đó thì tên thư mục.

    shortcut: chưa đọc pyproject/go.mod/pubspec; dự án Python dùng tên thư mục (thường trùng tên package).
    """
    try:
        name = json.loads((root / "package.json").read_text(encoding="utf-8")).get("name")
    except FileNotFoundError:
        return {root.name}
    except (OSError, ValueError, AttributeError):
        return set()
    return {name} if isinstance(name, str) and name else set()


def _module_matches(module: str, name: str, js: bool) -> bool:
    """Khớp chính xác, hoặc đường dẫn con của package (`utils/date`, `@scope/pkg/x`, `pyutils.core`)."""
    return module == name or module.startswith(name + ("/" if js else "."))


def _split_names(clause: str) -> dict[str, str]:
    """`a, b as c` -> {tên cục bộ: tên được export}."""
    out = {}
    for part in clause.strip().strip("{}()").replace("\n", " ").split(","):
        words = part.split()
        if words[:1] == ["type"]:
            words = words[1:]
        if len(words) == 1 and _IDENT.fullmatch(words[0]):
            out[words[0]] = words[0]
        elif len(words) == 3 and words[1] == "as":
            out[words[2]] = words[0]
    return out


def imported_names(text: str, language: str) -> dict[str, tuple[str, str]]:
    """Tên cục bộ -> (module, tên được export) theo các câu import có tên (bỏ import mặc định và `* as ns`)."""
    out: dict[str, tuple[str, str]] = {}
    if language in _JS:
        pairs = [(clause[clause.index("{"):], module) for clause, module in _JS_IMPORT.findall(text) if "{" in clause]
        pairs += [(clause, module) for clause, module in _JS_REQUIRE.findall(text)]
    elif language == "python":
        pairs = [(clause, module) for module, clause in _PY_FROM.findall(text)]
    else:
        return out
    for clause, module in pairs:
        if "}" in clause:
            clause = clause[:clause.index("}") + 1]
        for local, exported in _split_names(clause).items():
            out[local] = (module, exported)
    return out


def _read_source(root: Path, rel: str) -> str:
    try:
        path = safe_project_path(root, rel)
        if not path.is_file() or path.stat().st_size > _MAX_SOURCE:
            return ""
        return path.read_text(encoding="utf-8", errors="replace")
    except (ApiError, OSError):
        return ""  # tệp ngoài dự án (nguồn từ URL) hoặc đã mất


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
        namespaced = is_class and r["ngon_ngu"] in _NAMESPACE_BY_DIR
        G.add_node(gid(pid, r["id_nut"]), label=r["nhan"], source_file=r["tep"], repo=pid, local_id=r["id_nut"],
                   _callable_class=is_class,
                   metadata={"namespace": str(PurePosixPath(r["tep"]).parent)} if namespaced else {})
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

    bare: list[tuple[str, str, str, int, str]] = []  # (id nút gọi, tên, tệp, dòng, ngôn ngữ)
    for r in c.execute(
            "SELECT t.ma_nut_nguon, t.ten_tham_chieu, t.loai_tham_chieu, t.dong, n.id_nut, f.duong_dan_tuong_doi AS tep,"
            " f.ngon_ngu FROM tham_chieu_chua_phan_giai t JOIN nut n ON n.ma_nut = t.ma_nut_nguon"
            " JOIN tep f ON f.ma_tep = n.ma_tep WHERE t.trang_thai = 'that_bai' AND t.loai_tham_chieu IN ('CALLS', 'IMPORTS')"):
        if r["loai_tham_chieu"] == "IMPORTS":
            continue
        name = r["ten_tham_chieu"]
        if "." not in name:
            bare.append((r["id_nut"], name, r["tep"], r["dong"], r["ngon_ngu"]))
            continue
        lang = _VENDOR_LANG.get(r["ngon_ngu"])
        recv, _, callee = name.rpartition(".")
        rtype = receiver_type(r["ma_nut_nguon"], recv.rpartition(".")[2]) if lang else None
        node = gid(pid, r["id_nut"])
        if rtype and callee and node in G:
            G.nodes[node]["metadata"].setdefault("unresolved_calls", []).append(
                {"lang": lang, "receiver_type": rtype, "callee": callee, "file": r["tep"], "line": r["dong"]})
    imported = {file: imported_names(_read_source(m.info.path, file), lang)
                 for file, lang in {(b[2], b[4]) for b in bare} if lang in _JS or lang == "python"}
    return G, {"imported": imported, "bare": bare, "top": top}


def _row(src: str, dst: str, type_: str, sub: str, score: float, file: str | None, line) -> dict:
    (sp, sn), (dp, dn) = split_gid(src), split_gid(dst)
    return {"du_an_nguon": sp, "id_nut_nguon": sn, "du_an_dich": dp, "id_nut_dich": dn, "loai_canh": type_,
            "loai_con": sub, "diem_tin_cay": score, "tep_bang_chung": file or None,
            "dong_bang_chung": line if isinstance(line, int) and line >= 1 else None}


def compute_links(members: list[Member]) -> list[dict]:
    from nexgraph_engine.adapters.graphify.serve import CROSS_REPO_CALL_MARKER, link_cross_repo_member_calls
    from nexgraph_engine.adapters.graphify.serve import SHARED_TYPE_RELATION, link_shared_type_declarations

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

    names = {m.project_id: package_names(m.info.path) for m in members}
    for m in members:
        f = facts[m.project_id]
        for caller, name, file, line, lang in f["bare"]:
            found = f["imported"].get(file, {}).get(name)
            if found is None:
                continue
            module, exported = found
            targets = [(pid, nid) for pid, ns in names.items() if pid != m.project_id
                       and any(_module_matches(module, n, lang in _JS) for n in ns)
                       for nid in facts[pid]["top"].get(exported, ())]
            if len(targets) == 1:  # một định nghĩa duy nhất trong package được import, như vendor
                rows.append(_row(gid(m.project_id, caller), gid(*targets[0]), "CALLS", "import_symbol", 0.7, file, line))
    return rows


def relink(data_dir: Path, registry: ProjectRegistry) -> dict:
    """Tính lại toàn bộ cạnh liên repo và ghi đè vào global.db."""
    with _LOCK:
        with open_members(data_dir, registry) as (members, skipped):
            rows = compute_links(members)
        return {"edges": GlobalStore(data_dir).replace_edges(rows), "skipped": skipped}


def cross_repo_edges(data_dir: Path, project_id: str, node_ids: list[str]) -> list[dict]:
    """Cạnh liên repo chạm `node_ids` của `project_id`, cả hai chiều, chưa lọc. Chỉ đọc.

    Mỗi mục: `{project_id, node_id}` là đầu ở repo khác, `via` là nút của `project_id`, `direction` = `in`
    (repo khác trỏ tới `via`) hoặc `out`, kèm `type, subtype, file, line`.
    """
    wanted = set(node_ids)
    out = []
    for e in GlobalStore(data_dir).edges(read_only=True):
        for here, there, direction in (("dich", "nguon", "in"), ("nguon", "dich", "out")):
            if e[f"du_an_{here}"] == project_id and e[f"id_nut_{here}"] in wanted:
                out.append({"project_id": e[f"du_an_{there}"], "node_id": e[f"id_nut_{there}"],
                            "via": e[f"id_nut_{here}"], "direction": direction, "type": e["loai_canh"],
                            "subtype": e["loai_con"], "file": e["tep_bang_chung"], "line": e["dong_bang_chung"]})
    return out


def visible_cross_repo(data_dir: Path, project_id: str, entries: list[dict], *, for_model: bool = True) -> list[dict]:
    """Giữ mục liên repo (dạng của `cross_repo_edges`/`cross_repo_impact`) mà cả hai đầu còn tồn tại.

    `for_model=True` (MCP, review PR gửi cho AI): thêm điều kiện cả hai đầu đều được `SourcePolicy` của dự án
    tương ứng cho phép (mẫu loại trừ + .gitignore), để nút đã loại khỏi AI không lộ qua repo bên kia.
    Dự án đã gỡ hay không mở được thì mục bị bỏ.
    """
    registry = ProjectRegistry(data_dir, read_only=True)
    opened: dict[str, tuple[sqlite3.Connection, GraphStore, ModelGraph | None] | None] = {}

    def allows(pid: str, node_id: str) -> bool:
        if pid not in opened:
            opened[pid] = None
            try:
                info = registry.get(pid)
                if info is not None and info.path.is_dir():
                    conn = open_graph_db(info.graph_db, read_only=True)
                    store = GraphStore(conn)
                    opened[pid] = (conn, store, ModelGraph(store, info.path) if for_model else None)
            except (sqlite3.Error, OSError, SchemaOutdatedError, SchemaVersionError, ApiError):
                pass
        if opened[pid] is None:
            return False
        _, store, model = opened[pid]
        try:
            return store.get_node(node_id) is not None and (model is None or model.allows_node(node_id))
        except ApiError:  # .gitignore không đọc được: coi như bị loại
            return False

    try:
        return [e for e in entries if allows(project_id, e["via"]) and allows(e["project_id"], e["node_id"])]
    finally:
        for item in opened.values():
            if item is not None:
                item[0].close()


def cross_repo_impact(data_dir: Path, project_id: str, node_ids: list[str]) -> list[dict]:
    """Nút ở repo khác phụ thuộc vào `node_ids` của `project_id` (cho review PR, W7). Chỉ đọc.

    Trả `[{project_id, node_id, via, direction, type, subtype, file, line}]`: `node_id` ở repo `project_id`
    khác gọi (hoặc cùng kiểu với) `via`. Bỏ cạnh có đầu không còn tồn tại. Chưa lọc theo nguồn bị loại
    khỏi AI: trước khi gửi cho model, gọi thêm `visible_cross_repo(data_dir, project_id, hits)`.
    """
    hits = [e for e in cross_repo_edges(data_dir, project_id, node_ids)
            if e["direction"] == "in" or e["subtype"] == "same_type_as"]
    return visible_cross_repo(data_dir, project_id, hits, for_model=False)
