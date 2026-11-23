import threading

import pytest

import gh_fake
from nexgraph_engine.index.indexer import Indexer
from nexgraph_engine.prs.review import pr_detail_json, review_status_json
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.store.graph_store import GraphStore

LIB = "def helper(x):\n    return x + 1\n\n\ndef orphan():\n    return 0\n\n\ndef kept():\n    return 1\n"
APP = ("from lib import helper, orphan, kept\n\n\ndef run():\n    a = orphan()\n    b = kept()\n"
       "    return helper(a + b)\n")
TEST = "from lib import helper\n\n\ndef test_helper():\n    assert helper(1) == 2\n"
README = "# Demo\n\nRun `helper()` to add one.\n"

HELPER_DIFF = """diff --git a/lib.py b/lib.py
--- a/lib.py
+++ b/lib.py
@@ -1 +1 @@
-def helper(x):
+def helper(x, y=1):
"""
APP_DIFF = """diff --git a/app.py b/app.py
--- a/app.py
+++ b/app.py
@@ -5,2 +5,1 @@ def run():
-    a = orphan()
-    b = kept()
+    b = kept() + 1
"""
README_DIFF = """diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -3 +3 @@
-Run `helper()` to add one.
+Run `helper()` to add two.
"""
VIEW = ('{"number": 9, "title": "Đổi helper", "state": "OPEN", "headRefName": "f9", "baseRefName": "main",'
        ' "author": {"login": "an"}, "isDraft": false, "reviewDecision": "", "statusCheckRollup": [],'
        ' "updatedAt": "2026-11-20T00:00:00Z", "url": "https://github.com/acme/demo/pull/9"}')


@pytest.fixture
def store(tmp_path):
    root = tmp_path / "Đồ án" / "py review"
    root.mkdir(parents=True)
    for name, text in {"lib.py": LIB, "app.py": APP, "test_lib.py": TEST, "README.md": README}.items():
        (root / name).write_text(text)
    s = GraphStore(open_graph_db(tmp_path / "g.db"))
    s.init_project(root.name, has_git=False)
    assert Indexer(s, root, on_progress=lambda e: None, cancel=threading.Event(), include_docs=True).run().state == "hoan_tat"
    yield s, root
    s.conn.close()


def detail(store, monkeypatch, diff):
    calls = gh_fake.install(monkeypatch, {("pr", "view", "9"): VIEW, ("pr", "diff", "9"): diff})
    return pr_detail_json(*store, 9), calls


def test_helper_change_selects_test_and_flags_stale_doc(store, monkeypatch):
    d, calls = detail(store, monkeypatch, HELPER_DIFF)
    assert ["pr", "diff", "9"] in calls and not any("checkout" in c for c in calls)
    assert [n["label"] for n in d["changed_nodes"]] == ["helper"]
    assert any(i["node"]["label"] == "run" for i in d["impacted"])
    sel = d["test_selection"]
    assert sel["files"] == ["test_lib.py"] and sel["run_all"] is False
    assert sel["commands"] == ["python -m pytest test_lib.py"]
    assert [s["node"]["file"] for s in d["stale_docs"]] == ["README.md"] and d["stale_docs"][0]["symbols"] == ["helper"]
    assert d["cross_repo"] is None and d["pr"]["number"] == 9
    assert "Tài liệu có thể đã cũ" in d["comment"] and "python -m pytest test_lib.py" in d["comment"]


def test_doc_changed_in_same_pr_is_not_stale(store, monkeypatch):
    d, _ = detail(store, monkeypatch, HELPER_DIFF + README_DIFF)
    assert d["stale_docs"] == []


def test_removed_only_call_is_unreferenced_but_kept_call_is_not(store, monkeypatch):
    d, _ = detail(store, monkeypatch, APP_DIFF)
    assert [u["node"]["label"] for u in d["unreferenced"]] == ["orphan"]
    assert d["unreferenced"][0]["heuristic"] is True
    assert "không còn ai gọi (heuristic)" in d["comment"]


def test_untested_change_asks_to_run_all(store, monkeypatch):
    d, _ = detail(store, monkeypatch, APP_DIFF)
    assert [n["label"] for n in d["test_gaps"]] == ["run"]
    sel = d["test_selection"]
    assert sel["run_all"] is True and any("chưa tìm được test" in r for r in sel["reasons"])
    assert "Nên chạy toàn bộ test" in d["comment"]


def test_build_file_change_asks_to_run_all(store, monkeypatch):
    diff = HELPER_DIFF + "diff --git a/pyproject.toml b/pyproject.toml\n--- a/pyproject.toml\n+++ b/pyproject.toml\n@@ -1 +1 @@\n-a\n+b\n"
    d, _ = detail(store, monkeypatch, diff)
    assert d["test_selection"]["run_all"] is True and "pyproject.toml" in d["test_selection"]["reasons"][0]


def test_review_status_shape(store, monkeypatch):
    d, _ = detail(store, monkeypatch, APP_DIFF)
    st = review_status_json(d)
    assert st["gate"] == "advisory" and st["blocking_count"] == 0
    assert {f["kind"] for f in st["top_findings"]} == {"test_gap", "unreferenced"}
    assert st["advisory_count"] == len(st["top_findings"])


def test_bad_number_never_calls_gh(store, monkeypatch):
    calls = gh_fake.install(monkeypatch, {})
    with pytest.raises(ValueError):
        pr_detail_json(*store, "9 --repo evil/x")
    assert calls == []


def test_cross_repo_impact_uses_shared_graph_when_present(store, monkeypatch, tmp_path):
    from nexgraph_engine.global_graph import link
    seen = {}

    def fake(data_dir, project_id, node_ids):
        seen.update(data_dir=data_dir, project_id=project_id, node_ids=node_ids)
        return [{"project_id": "other", "node_id": "app.ts::main#function", "via": node_ids[0],
                 "type": "CALLS", "subtype": None, "file": "app.ts", "line": 3},
                {"project_id": "other", "node_id": "secret.ts::hidden#function", "via": node_ids[0],
                 "type": "CALLS", "subtype": None, "file": "secret.ts", "line": 1}]

    def visible(data_dir, project_id, entries, *, for_model=True):  # giả lập SourcePolicy của dự án kia
        return [e for e in entries if "hidden" not in e["node_id"]]

    monkeypatch.setattr(link, "cross_repo_impact", fake)
    monkeypatch.setattr(link, "visible_cross_repo", visible)
    gh_fake.install(monkeypatch, {("pr", "view", "9"): VIEW, ("pr", "diff", "9"): HELPER_DIFF})
    data_dir = tmp_path / "appdata"
    data_dir.mkdir()
    assert pr_detail_json(*store, 9, data_dir=data_dir)["cross_repo"] is None  # chưa có graph chung
    (data_dir / "global.db").touch()
    d = pr_detail_json(*store, 9, data_dir=data_dir)
    assert seen["project_id"] == store[0].project_id() and seen["node_ids"] == [n["id"] for n in d["changed_nodes"]]
    assert d["cross_repo"][0]["project_id"] == "other"
    assert "repo khác" in d["comment"]
    assert [c["node_id"] for c in d["cross_repo"]] == ["app.ts::main#function"] and "hidden" not in d["comment"]


def test_call_moved_to_another_file_is_not_unreferenced(store, monkeypatch):
    moved = ("diff --git a/lib2.py b/lib2.py\nnew file mode 100644\n--- /dev/null\n+++ b/lib2.py\n@@ -0,0 +1,2 @@\n"
             "+from lib import orphan\n+X = orphan()\n")
    d, _ = detail(store, monkeypatch, APP_DIFF + moved)
    assert d["unreferenced"] == []


def test_deleted_definition_is_not_unreferenced(store, monkeypatch):
    gone = ("diff --git a/lib.py b/lib.py\n--- a/lib.py\n+++ b/lib.py\n@@ -5,2 +4,0 @@\n"
            "-def orphan():\n-    return 0\n")
    d, _ = detail(store, monkeypatch, APP_DIFF + gone)
    assert d["unreferenced"] == []


def test_deleted_file_symbols_are_not_test_gaps(store, monkeypatch):
    deleted = ("diff --git a/app.py b/app.py\ndeleted file mode 100644\n--- a/app.py\n+++ /dev/null\n"
               "@@ -1,7 +0,0 @@\n" + "".join("-" + line + "\n" for line in APP.splitlines()))
    d, _ = detail(store, monkeypatch, deleted)
    assert "run" not in [n["label"] for n in d["test_gaps"]]


@pytest.mark.parametrize("state", ["MERGED", "CLOSED"])
def test_closed_or_merged_pr_status(store, monkeypatch, state):
    calls = gh_fake.install(monkeypatch, {("pr", "view", "9"): VIEW.replace('"OPEN"', f'"{state}"'),
                                          ("pr", "diff", "9"): HELPER_DIFF})
    assert pr_detail_json(*store, 9)["pr"]["status"] == state and calls


def test_monorepo_test_command_uses_the_nearest_package_manifest(tmp_path):
    from types import SimpleNamespace

    import json as _json

    from nexgraph_engine.prs.diff import DiffFile
    from nexgraph_engine.prs.review import select_tests

    web = tmp_path / "packages" / "web"
    (web / "src").mkdir(parents=True)
    (web / "package.json").write_text(_json.dumps({"devDependencies": {"vitest": "^2.1.0"}}), encoding="utf-8")
    api_pkg = tmp_path / "packages" / "api"
    (api_pkg / "tests").mkdir(parents=True)
    (api_pkg / "pyproject.toml").write_text("[tool.pytest.ini_options]\n", encoding="utf-8")
    (tmp_path / "package.json").write_text(_json.dumps({"devDependencies": {"jest": "^29.0.0"}}), encoding="utf-8")
    report = SimpleNamespace(tests=[], test_gaps=[], truncated=False)
    files = [DiffFile("packages/web/src/cart.test.ts"), DiffFile("packages/api/tests/test_cart.py")]
    sel = select_tests(tmp_path, report, files, False)
    assert sel["commands"] == [
        f"cd packages/api && python -m pytest tests/test_cart.py",
        f"cd packages/web && npx vitest run src/cart.test.ts",
    ]
    assert sel["run_all"] is False


def test_monorepo_hoisted_workspace_uses_the_root_runner(tmp_path):
    import json as _json
    from types import SimpleNamespace

    from nexgraph_engine.prs.diff import DiffFile
    from nexgraph_engine.prs.review import select_tests

    web = tmp_path / "packages" / "web"
    (web / "src").mkdir(parents=True)
    (web / "package.json").write_text(_json.dumps({"name": "web", "private": True}), encoding="utf-8")
    (tmp_path / "package.json").write_text(_json.dumps({"devDependencies": {"vitest": "^2.1.0"}}), encoding="utf-8")
    sel = select_tests(tmp_path, SimpleNamespace(tests=[], test_gaps=[], truncated=False),
                       [DiffFile("packages/web/src/cart.test.ts")], False)
    assert sel["commands"] == ["npx vitest run packages/web/src/cart.test.ts"]


def test_go_monorepo_command_is_relative_to_the_module(tmp_path):
    from types import SimpleNamespace

    from nexgraph_engine.prs.diff import DiffFile
    from nexgraph_engine.prs.review import select_tests

    api_pkg = tmp_path / "services" / "api"
    (api_pkg / "pkg").mkdir(parents=True)
    (api_pkg / "go.mod").write_text("module example.com/api\n", encoding="utf-8")
    (api_pkg / "pkg" / "x_test.go").write_text("package pkg\n", encoding="utf-8")
    sel = select_tests(tmp_path, SimpleNamespace(tests=[], test_gaps=[], truncated=False),
                       [DiffFile("services/api/pkg/x_test.go")], False)
    assert sel["commands"] == ["cd services/api && go test ./pkg"]
