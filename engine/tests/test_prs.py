import os
import stat
import sys

import pytest

import gh_fake
from nexgraph_engine.prs import gh
from nexgraph_engine.prs.diff import parse_unified_diff, to_changeset
from nexgraph_engine.prs.listing import gh_status, list_prs_json, triage_json, triage_prompt


@pytest.fixture
def py_store(copy_fixture, index_project):
    root = copy_fixture("py_mini")
    store, result, _ = index_project(root)
    return store, root


def test_classifies_all_statuses(py_store, monkeypatch):
    gh_fake.install(monkeypatch, {})
    out = list_prs_json(*py_store)
    assert out["repo"] == "acme/demo" and out["base"] == "main"
    assert {p["number"]: p["status"] for p in out["prs"]} == {
        1: "WRONG-BASE", 2: "CI-FAIL", 3: "CHANGES-REQ", 4: "DRAFT", 5: "STALE", 6: "APPROVED", 7: "PENDING",
        8: "READY"}
    pr8 = next(p for p in out["prs"] if p["number"] == 8)
    assert pr8["files"] == ["test_util.py", "util.py"] and pr8["nodes_affected"] > 0
    assert pr8["url"].endswith("/pull/8") and pr8["ci"] == "SUCCESS"


def test_conflicts_only_same_file_or_changed_node(py_store, monkeypatch):
    gh_fake.install(monkeypatch, {})
    conflicts = {(c["a"], c["b"]): c for c in list_prs_json(*py_store)["conflicts"]}
    assert conflicts[(6, 8)]["files"] == ["util.py"] and conflicts[(6, 8)]["nodes"] > 0
    assert conflicts[(6, 8)]["related"] >= conflicts[(6, 8)]["nodes"]
    assert (7, 8) not in conflicts  # main.py chỉ gọi helper của util.py: liên quan, không phải xung đột
    assert not any(1 in k for k in conflicts)  # PR sai nhánh gốc không tính
    assert not any(2 in k for k in conflicts)  # chỉ đổi README, không có nút chung


def test_triage_is_rule_based_and_skips_stale(py_store, monkeypatch):
    gh_fake.install(monkeypatch, {})
    t = triage_json(list_prs_json(*py_store))
    assert t["method"] == "rules" and t["skipped"] == 2
    assert [p["number"] for p in t["ranked"]] == [2, 3, 4, 7, 6, 8]  # đúng `_STATUS_ORDER` của graphify
    assert "#<number>" in triage_prompt(t) and "PR #8 [READY]" in triage_prompt(t)


@pytest.mark.parametrize("bad", [0, -1, 10**9 + 1, "7; rm -rf /", "+7", " 7", "²", True, 1.5, None, "1" * 11])
def test_pr_number_rejects(bad):
    with pytest.raises(ValueError):
        gh.pr_number(bad)


def test_pr_number_accepts():
    assert gh.pr_number("42") == 42 and gh.pr_number(7) == 7


def test_gh_missing(tmp_path, monkeypatch):
    monkeypatch.setenv("PATH", str(tmp_path))
    monkeypatch.setattr(gh, "EXTRA_DIRS", ())
    with pytest.raises(gh.GhError) as e:
        gh.run_gh(tmp_path, ["repo", "view"])
    assert e.value.code == "gh_missing" and e.value.api_error().status == 409
    assert gh_status(tmp_path) == {"available": False, "reason": "gh_missing", "repo": None, "default_branch": None}


@pytest.mark.skipif(sys.platform == "win32", reason="gh giả dạng script sh")
@pytest.mark.parametrize("stderr, code", [
    ("To get started with GitHub CLI, please run:  gh auth login", "gh_auth"),
    ("none of the git remotes configured for this repository point to a known GitHub host", "not_github"),
    ("GraphQL: Could not resolve to a PullRequest with the number of 99.", "pr_not_found"),
    ("boom", "gh_failed"),
])
def test_gh_failure_codes(tmp_path, monkeypatch, stderr, code):
    fake = tmp_path / "gh"
    fake.write_text(f"#!/bin/sh\necho '{stderr}' >&2\nexit 1\n")
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("PATH", f"{tmp_path}{os.pathsep}{os.environ['PATH']}")
    with pytest.raises(gh.GhError) as e:
        gh.run_gh(tmp_path, ["pr", "list"])
    assert e.value.code == code


@pytest.mark.skipif(sys.platform == "win32", reason="gh giả dạng script sh")
def test_gh_timeout(tmp_path, monkeypatch):
    fake = tmp_path / "gh"
    fake.write_text("#!/bin/sh\nsleep 5\n")
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("PATH", f"{tmp_path}{os.pathsep}{os.environ['PATH']}")
    with pytest.raises(gh.GhError) as e:
        gh.run_gh(tmp_path, ["pr", "list"], timeout=0.3)
    assert e.value.code == "gh_timeout" and e.value.api_error().status == 504


DIFF = """diff --git a/util.py b/util.py
index 1..2 100644
--- a/util.py
+++ b/util.py
@@ -1,2 +1,2 @@
 def helper(x):
-    return x + 1
+    return x + 2
@@ -10,0 +11,2 @@ def x():
+-- not a header
+more
diff --git a/new.py b/new.py
new file mode 100644
--- /dev/null
+++ b/new.py
@@ -0,0 +1 @@
+print(1)
diff --git a/gone.py b/gone.py
deleted file mode 100644
--- a/gone.py
+++ /dev/null
@@ -1,2 +0,0 @@
-def gone():
---- pass
diff --git a/old name.py b/new name.py
similarity index 90%
rename from old name.py
rename to new name.py
diff --git a/logo.png b/logo.png
index 1..2 100644
Binary files a/logo.png and b/logo.png differ
"""


def test_parse_unified_diff():
    files = {f.path: f for f in parse_unified_diff(DIFF)}
    assert set(files) == {"util.py", "new.py", "gone.py", "new name.py", "logo.png"}
    u = files["util.py"]
    assert u.status == "M" and u.old_ranges == [(1, 2), (10, 11)] and u.removed == {2: "    return x + 1"}
    assert u.added == ["    return x + 2", "-- not a header", "more"]
    assert files["new.py"].status == "A"
    assert files["gone.py"].status == "D" and files["gone.py"].removed == {1: "def gone():", 2: "--- pass"}
    assert files["new name.py"].status == "R" and files["new name.py"].old_path == "old name.py"
    assert files["logo.png"].binary


def test_to_changeset_uses_base_paths():
    cs = to_changeset(parse_unified_diff(DIFF))
    by = {c.path: c for c in cs.files}
    assert set(by) == {"util.py", "gone.py", "old name.py"}  # tệp mới và nhị phân không có nút ở nhánh gốc
    assert by["util.py"].ranges == [(1, 2), (10, 11)]
    assert by["gone.py"].ranges is None and by["old name.py"].ranges is None
    assert to_changeset(parse_unified_diff(DIFF), max_files=1).truncated


def _fake_gh(tmp_path, body: str):
    d = tmp_path / "bin"
    d.mkdir(exist_ok=True)
    fake = d / "gh"
    fake.write_text("#!/bin/sh\n" + body)
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    return d


@pytest.mark.skipif(sys.platform == "win32", reason="gh giả dạng script sh")
def test_gh_found_outside_minimal_path(tmp_path, monkeypatch):
    """Bản đóng gói macOS chạy với PATH tối giản (/usr/bin:/bin): vẫn tìm gh ở thư mục Homebrew."""
    d = _fake_gh(tmp_path, "echo '{\"ok\": 1}'\n")
    monkeypatch.setenv("PATH", "/usr/bin:/bin")
    monkeypatch.setattr(gh, "EXTRA_DIRS", (str(d),))
    assert gh.run_gh(tmp_path, ["repo", "view"]).strip() == '{"ok": 1}'


@pytest.mark.skipif(sys.platform == "win32", reason="gh giả dạng script sh")
def test_gh_error_redacts_tokens(tmp_path, monkeypatch):
    d = _fake_gh(tmp_path, "echo 'fatal: https://bob:s3cr3tpass@github.com ghp_abcdefghijklmnopqrstuvwxyz0123 "
                           "github_pat_11ABCDEFG0123456789_abcdefghijklmnop gho_ZZZZZZZZZZZZZZZZZZZZZZ' >&2\nexit 1\n")
    monkeypatch.setenv("PATH", f"{d}{os.pathsep}{os.environ['PATH']}")
    with pytest.raises(gh.GhError) as e:
        gh.run_gh(tmp_path, ["pr", "list"])
    msg = str(e.value)
    for secret in ("s3cr3tpass", "ghp_abc", "github_pat_11", "gho_ZZZ", "bob:"):
        assert secret not in msg


def test_hub_project_conflicts_are_same_file_only_and_capped(tmp_path, index_project, monkeypatch):
    """60 PR trên 40 module cùng gọi một hàm hub: chỉ cặp cùng tệp là xung đột, danh sách bị giới hạn."""
    import json
    from nexgraph_engine.prs import listing
    root = tmp_path / "hub"
    root.mkdir()
    (root / "core.py").write_text("def log(x):\n    return x\n")
    for i in range(40):
        (root / f"m{i}.py").write_text(f"from core import log\n\n\ndef f{i}():\n    return log({i})\n")
    store, _, _ = index_project(root)
    items = [{"number": n, "title": f"p{n}", "state": "OPEN", "headRefName": "h", "baseRefName": "main",
              "author": None, "isDraft": False, "reviewDecision": "", "statusCheckRollup": [],
              "updatedAt": gh_fake.recent(), "files": [{"path": f"m{n % 40}.py"}]} for n in range(1, 61)]
    gh_fake.install(monkeypatch, {("pr", "list"): json.dumps(items)})
    out = list_prs_json(store, root, limit=100)
    assert len(out["conflicts"]) == 20 and not out["conflicts_truncated"]  # 20 module có hai PR
    assert all(c["files"] for c in out["conflicts"])
    monkeypatch.setattr(listing, "MAX_CONFLICTS", 5)
    out = list_prs_json(store, root, limit=100)
    assert len(out["conflicts"]) == 5 and out["conflicts_truncated"]


def test_bad_updated_at_and_closed_state(py_store, monkeypatch):
    import json
    raw = json.loads(gh_fake.fixture("pr_list.json"))
    raw[7]["updatedAt"] = "không phải ngày"
    gh_fake.install(monkeypatch, {("pr", "list"): json.dumps(raw)})
    out = list_prs_json(*py_store)
    assert next(p for p in out["prs"] if p["number"] == 8)["status"] == "READY"


def test_parse_quoted_path_and_unicode_line_breaks():
    text = ('diff --git "a/ti\\341\\272\\277ng.py" "b/ti\\341\\272\\277ng.py"\n'
            '--- "a/ti\\341\\272\\277ng.py"\n+++ "b/ti\\341\\272\\277ng.py"\n'
            "@@ -1,2 +1,2 @@\n-a\u2028b\x0cc\n+d\n x\n")
    [f] = parse_unified_diff(text)
    assert f.path == "tiếng.py"
    assert f.removed == {1: "a\u2028b\x0cc"} and f.added == ["d"] and f.old_ranges == [(1, 2)]
