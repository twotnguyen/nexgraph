import pytest

import gh_fake
from nexgraph_engine.prs import gh

DIFF = "diff --git a/util.py b/util.py\n--- a/util.py\n+++ b/util.py\n@@ -1 +1 @@\n-def helper(x):\n+def helper(x, y=1):\n"
VIEW = ('{"number": 8, "title": "Sẵn sàng", "state": "OPEN", "headRefName": "f8", "baseRefName": "main",'
        ' "author": {"login": "k"}, "isDraft": false, "reviewDecision": "", "statusCheckRollup": [],'
        ' "updatedAt": "2026-11-20T00:00:00Z", "url": "u"}')


@pytest.fixture
def pid(api, copy_fixture):
    p = api.open(copy_fixture("py_mini"))
    assert api.index(p["project_id"])["state"] == "done"
    return p["project_id"]


def test_status_available(api, pid, monkeypatch):
    gh_fake.install(monkeypatch, {})
    r = api.get(f"/v1/projects/{pid}/prs/status")
    assert r.status_code == 200 and r.json() == {"available": True, "reason": None, "repo": "acme/demo",
                                                 "default_branch": "main"}


@pytest.mark.parametrize("code, status", [("gh_missing", 409), ("gh_auth", 409), ("not_github", 409),
                                          ("gh_timeout", 504), ("gh_failed", 502)])
def test_gh_errors_are_coded_not_500(api, pid, monkeypatch, code, status):
    gh_fake.install(monkeypatch, {("repo", "view"): gh.GhError(code)})
    assert api.get(f"/v1/projects/{pid}/prs/status").json()["reason"] == code
    r = api.get(f"/v1/projects/{pid}/prs")
    assert r.status_code == status and r.json()["error"]["code"] == code


def test_list_and_detail(api, pid, monkeypatch):
    gh_fake.install(monkeypatch, {("pr", "view", "8"): VIEW, ("pr", "diff", "8"): DIFF})
    out = api.get(f"/v1/projects/{pid}/prs").json()
    assert len(out["prs"]) == 8 and out["conflicts"]
    d = api.get(f"/v1/projects/{pid}/prs/8").json()
    assert d["pr"]["number"] == 8 and d["test_selection"]["files"] == ["test_util.py"]
    assert d["cross_repo"] is None and d["comment"].startswith("## Review cục bộ: PR #8")


@pytest.mark.parametrize("bad", ["0", "-3", "abc", "1e3", "99999999999"])
def test_detail_rejects_bad_number(api, pid, monkeypatch, bad):
    calls = gh_fake.install(monkeypatch, {})
    r = api.get(f"/v1/projects/{pid}/prs/{bad}")
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_param"
    assert calls == []


def test_detail_unknown_pr_is_404(api, pid, monkeypatch):
    gh_fake.install(monkeypatch, {("pr", "view", "99"): gh.GhError("pr_not_found")})
    r = api.get(f"/v1/projects/{pid}/prs/99")
    assert r.status_code == 404 and r.json()["error"]["code"] == "pr_not_found"


def test_unknown_project(api):
    assert api.get("/v1/projects/nope/prs/status").status_code == 404
