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
