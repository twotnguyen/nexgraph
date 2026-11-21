"""Review cục bộ của một PR trên đồ thị nhánh gốc: vùng ảnh hưởng, symbol đổi thiếu test, tài liệu cũ, code không
còn ai gọi (heuristic) và test nên chạy. Chỉ đọc; nhận xét chỉ để người dùng tự sao chép, không đăng lên GitHub."""
from __future__ import annotations

import shlex
from collections.abc import Callable
from pathlib import Path, PurePosixPath

from nexgraph_engine.impact.analyze import ImpactReport, analyze
from nexgraph_engine.index.discovery import CONFIG_LANGUAGES, is_test_path, language_of
from nexgraph_engine.prs import gh
from nexgraph_engine.prs.diff import DiffFile, parse_unified_diff, to_changeset
from nexgraph_engine.prs.listing import FIELDS, _json, parse_pr, pr_json, repo_info
from nexgraph_engine.query.contracts import node_json
from nexgraph_engine.query.model_view import ModelGraph
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.models import Node

MAX_LISTED = 50
_SYMBOL_KINDS = ("function", "method", "class")
_BUILD_FILES = frozenset({
    "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "pyproject.toml", "setup.py", "setup.cfg",
    "requirements.txt", "uv.lock", "poetry.lock", "conftest.py", "pytest.ini", "tox.ini", "pubspec.yaml",
    "pubspec.lock", "go.mod", "go.sum", "cargo.toml", "cargo.lock", "pom.xml", "build.gradle", "build.gradle.kts",
})


def cross_repo_impact(store: GraphStore, changed: list[Node]) -> dict | None:
    """Điểm móc cho graph chung (W8): tác động sang repo khác. Chưa nối nên trả None."""
    return None


def _marks(items: list) -> str:
    return ",".join("?" * len(items))


def stale_docs(store: GraphStore, changed: list[Node], diff_paths: set[str],
               allows_node: Callable[[str], bool] = lambda _: True) -> list[dict]:
    """Mục tài liệu có cạnh DOCUMENTS tới symbol đổi, trong khi tệp tài liệu không nằm trong diff."""
    ids = [n.id for n in changed][:900]
    if not ids:
        return []
    rows = store.conn.execute(
        "SELECT c.ma_nut_nguon AS doc, s.id_nut AS sym, s.nhan AS label FROM canh c"
        " JOIN nut s ON s.ma_nut = c.ma_nut_dich"
        f" WHERE c.loai_canh = 'DOCUMENTS' AND s.id_nut IN ({_marks(ids)}) ORDER BY c.ma_canh", ids).fetchall()
    by_doc: dict[int, list[str]] = {}
    for r in rows:
        if allows_node(r["sym"]):  # tên symbol của tệp bị loại khỏi AI không được lọt qua danh sách chữ
            by_doc.setdefault(r["doc"], []).append(r["label"])
    docs = store.nodes_by_pk(list(by_doc))
    pk_of = dict(zip(list(by_doc), docs))
    out = [{"node": node_json(d), "symbols": sorted(set(by_doc[pk]))}
           for pk, d in pk_of.items() if d.file not in diff_paths]
    return sorted(out, key=lambda x: (x["node"]["file"] or "", x["node"]["line_start"] or 0))[:MAX_LISTED]


def unreferenced(store: GraphStore, files: list[DiffFile]) -> list[dict]:
    """Symbol mà mọi cạnh CALLS/REFERENCES đi vào đều nằm trên dòng bị PR bỏ (hoặc trong tệp bị xoá).
    Heuristic: tên đích còn xuất hiện ở một dòng thêm bất kỳ của PR thì coi như lời gọi còn (có thể đã chuyển tệp);
    symbol có dòng định nghĩa bị PR xoá thì chính nó bị xoá, không báo."""
    conn = store.conn
    deleted = {f.path for f in files if f.status == "D"}
    by_path = {(f.old_path or f.path): f for f in files if f.status != "A"}
    added = "\n".join(line for f in files for line in f.added)
    removed_edges: set[int] = set()
    candidates: set[int] = set()
    for path, f in by_path.items():
        if f.status != "D" and not f.removed:
            continue
        for r in conn.execute(
                "SELECT c.ma_canh, c.ma_nut_dich, c.dong_bang_chung, d.nhan AS label FROM canh c"
                " JOIN nut s ON s.ma_nut = c.ma_nut_nguon JOIN tep t ON t.ma_tep = s.ma_tep"
                " JOIN nut d ON d.ma_nut = c.ma_nut_dich"
                " WHERE t.duong_dan_tuong_doi = ? AND c.loai_canh IN ('CALLS', 'REFERENCES')", (path,)):
            if f.status == "D" or (r["dong_bang_chung"] in f.removed and r["label"].rsplit(".", 1)[-1] not in added):
                removed_edges.add(r["ma_canh"])
                candidates.add(r["ma_nut_dich"])
    if not candidates:
        return []
    pks = sorted(candidates)[:900]
    still: set[int] = set()
    for r in conn.execute(
            f"SELECT ma_canh, ma_nut_dich FROM canh WHERE ma_nut_dich IN ({_marks(pks)})"
            " AND loai_canh IN ('CALLS', 'REFERENCES')", pks):
        if r["ma_canh"] not in removed_edges:
            still.add(r["ma_nut_dich"])
    nodes = [n for n in store.nodes_by_pk([pk for pk in pks if pk not in still])
             if n.kind.value in _SYMBOL_KINDS and not n.is_test and n.file not in deleted
             and not (n.file in by_path and n.line_start in by_path[n.file].removed)]
    nodes.sort(key=lambda n: (n.file or "", n.line_start or 0, n.id))
    return [{"node": node_json(n), "heuristic": True} for n in nodes[:MAX_LISTED]]


def _runner_for(root: Path, ext: str) -> str | None:
    def mentions(name: str, word: str) -> bool:
        try:
            return word in (root / name).read_text("utf-8", "replace")
        except OSError:
            return False
    if ext == ".py":
        return "python -m pytest"
    if ext in (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"):
        return "npx vitest run" if mentions("package.json", "vitest") else (
            "npx jest" if mentions("package.json", "jest") else "npm test --")
    if ext == ".dart":
        return "flutter test" if mentions("pubspec.yaml", "flutter") else "dart test"
    return None


def select_tests(root: Path, report: ImpactReport, files: list[DiffFile], truncated: bool,
                 allows: Callable[[str], bool] = lambda _: True) -> dict:
    """Tệp test nên chạy và lệnh gợi ý; `run_all` khi không chắc, kèm lý do. `allows` bỏ tệp bị loại khỏi AI."""
    tests = {t.file for t in report.tests if t.file and allows(t.file)}
    files = [f for f in files if allows(f.path) and (f.old_path is None or allows(f.old_path))]
    tests |= {f.path for f in files if f.status != "D" and is_test_path(f.path)}
    reasons: list[str] = []
    if truncated:
        reasons.append("Diff hoặc vùng ảnh hưởng bị cắt bớt")
    build = sorted(f.path for f in files if PurePosixPath(f.path).name.lower() in _BUILD_FILES
                   or language_of(f.path) in CONFIG_LANGUAGES)
    if build:
        reasons.append("Tệp cấu hình hoặc build thay đổi: " + ", ".join(build[:5]))
    code = [f for f in files if language_of(f.path) is not None and language_of(f.path) not in CONFIG_LANGUAGES
            and not is_test_path(f.path)]
    if any(f.status == "A" for f in code):
        reasons.append("Có tệp mã mới chưa nằm trong đồ thị")
    if report.test_gaps:
        reasons.append(f"{len(report.test_gaps)} symbol đổi chưa tìm được test")
    if code and not tests:
        reasons.append("Không tìm được test nào liên quan tới thay đổi")
    commands: list[str] = []
    groups: dict[str, list[str]] = {}
    go_dirs: set[str] = set()
    for t in sorted(tests):
        ext = PurePosixPath(t).suffix.lower()
        if ext == ".go":
            go_dirs.add("./" + str(PurePosixPath(t).parent))
            continue
        runner = _runner_for(root, ext)
        if runner is None:
            reasons.append(f"Chưa biết lệnh chạy test cho {t}")
            continue
        groups.setdefault(runner, []).append(t)
    for runner, items in groups.items():
        commands.append(f"{runner} {' '.join(shlex.quote(i) for i in items)}")
    if go_dirs:
        commands.append("go test " + " ".join(shlex.quote(d) for d in sorted(go_dirs)))
    return {"files": sorted(tests), "commands": commands, "run_all": bool(reasons), "reasons": reasons}


def _loc(n: dict) -> str:
    return f"{n['file']}:{n['line_start']}" if n.get("file") and n.get("line_start") else (n.get("file") or "")


def comment_markdown(d: dict) -> str:
    pr = d["pr"]
    out = [f"## Review cục bộ: PR #{pr['number']} {pr['title']}", "",
           f"Trạng thái: {pr['status']} · CI: {pr['ci']} · Review: {pr['review'] or 'chưa có'}", "",
           f"### Vùng ảnh hưởng ({len(d['impacted'])} nút)"]
    out += [f"- `{i['node']['label']}` ({_loc(i['node'])}), điểm {i['score']:.2f}, {i['hops']} bước"
            for i in d["impacted"][:10]] or ["- Không có"]
    if d["test_gaps"]:
        out += ["", "### Symbol đổi chưa có test"] + [f"- `{n['label']}` ({_loc(n)})" for n in d["test_gaps"][:20]]
    if d["stale_docs"]:
        out += ["", "### Tài liệu có thể đã cũ"] + [
            f"- {_loc(s['node'])} mục \"{s['node']['label']}\" nhắc {', '.join(f'`{x}`' for x in s['symbols'])}"
            for s in d["stale_docs"][:20]]
    if d["unreferenced"]:
        out += ["", "### Code có thể không còn ai gọi (heuristic)"] + [
            f"- `{u['node']['label']}` ({_loc(u['node'])})" for u in d["unreferenced"][:20]]
    sel = d["test_selection"]
    out += ["", "### Test nên chạy"]
    if sel["run_all"]:
        out.append("- Nên chạy toàn bộ test: " + "; ".join(sel["reasons"]))
    out += [f"- `{c}`" for c in sel["commands"]] or ([] if sel["run_all"] else ["- Không có test liên quan"])
    out += ["", "_Tạo từ đồ thị cục bộ của NexGraph, chưa đăng lên GitHub._"]
    return "\n".join(out)


def pr_detail_json(store: GraphStore, root: Path, number: object, *, model: ModelGraph | None = None) -> dict:
    """`model` (đường MCP / header model): lọc mọi thứ theo SourcePolicy trước khi dựng nhận xét từ bản đã lọc."""
    n = gh.pr_number(number)
    base = repo_info(root)["default_branch"]
    view = _json(root, ["pr", "view", str(n), "--json", FIELDS])
    pr = parse_pr(view, base)
    files = parse_unified_diff(gh.run_gh(root, ["pr", "diff", str(n)]))
    cs = to_changeset(files)
    report = analyze(store.conn, cs)
    truncated = cs.truncated or report.truncated
    diff_paths = {f.path for f in files} | {f.old_path for f in files if f.old_path}
    deleted = {f.path for f in files if f.status == "D"}
    allows_node = model.allows_node if model is not None else (lambda _: True)
    allows = model.source.allows if model is not None else (lambda _: True)
    detail = {
        "pr": pr_json(pr, view.get("url"), view.get("state")),
        "changed_files": [{"path": f.path, "status": f.status, "old_path": f.old_path} for f in files],
        "changed_nodes": [node_json(x) for x in report.changed_nodes],
        "impacted": [{"node": node_json(i.node), "score": i.score, "hops": i.hops} for i in report.impacted],
        "tests": [node_json(x) for x in report.tests],
        "test_gaps": [node_json(x) for x in report.test_gaps if x.file not in deleted],  # symbol bị xoá không cần test
        "stale_docs": stale_docs(store, report.changed_nodes, diff_paths, allows_node),
        "unreferenced": unreferenced(store, files),
        "test_selection": select_tests(root, report, files, truncated, allows),
        "cross_repo": cross_repo_impact(store, report.changed_nodes),
        "truncated": truncated,
    }
    if model is not None:
        detail = model.filter(detail)
    detail["comment"] = comment_markdown(detail)  # dựng từ bản đã lọc
    return detail


def review_status_json(detail: dict) -> dict:
    """Dạng `review_status` của bản cloud. Mọi phát hiện cục bộ chỉ là khuyến nghị, không chặn merge."""
    findings = ([{"kind": "test_gap", "message": f"{n['label']} đổi nhưng chưa có test", "file": n["file"]}
                 for n in detail["test_gaps"]]
                + [{"kind": "stale_doc", "message": f"Mục \"{s['node']['label']}\" có thể đã cũ", "file": s["node"]["file"]}
                   for s in detail["stale_docs"]]
                + [{"kind": "unreferenced", "message": f"{u['node']['label']} có thể không còn ai gọi",
                    "file": u["node"]["file"]} for u in detail["unreferenced"]])
    return {"pr": detail["pr"]["number"], "status": detail["pr"]["status"],
            "gate": "advisory" if findings else "pass", "blocking_count": 0, "advisory_count": len(findings),
            "top_findings": findings[:10], "test_selection": detail["test_selection"]}
