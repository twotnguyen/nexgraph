import os
import sys
import urllib.parse

import pytest


@pytest.fixture
def indexed(api, copy_fixture):
    root = copy_fixture("bookstore_app")
    p = api.open(root)
    assert api.index(p["project_id"])["state"] == "done"
    return api, p["project_id"], root


def q(s: str) -> str:
    return urllib.parse.quote(s, safe="")


def test_neighbors_of_file_node(indexed):
    api, pid, _ = indexed
    r = api.get(f"/v1/projects/{pid}/neighbors?node={q('lib/screens/login_screen.dart#file')}&types=IMPORTS&direction=out")
    assert r.status_code == 200
    body = r.json()
    assert body["truncated"] is False
    targets = {e["target"] for e in body["edges"]}
    assert targets == {"lib/services/auth_service.dart#file", "lib/widgets/primary_button.dart#file"}
    e = body["edges"][0]
    assert set(e) == {"id", "source", "target", "type", "subtype", "confidence", "confidence_score", "origin", "evidence"}
    assert e["evidence"]["file"] == "lib/screens/login_screen.dart" and e["evidence"]["line"] >= 1
    assert {n["id"] for n in body["nodes"]} >= targets
    n = next(n for n in body["nodes"] if n["id"] == "lib/services/auth_service.dart#file")
    assert set(n) == {"id", "kind", "label", "qualified_name", "language", "file", "line_start", "line_end",
                      "is_test", "origin", "signature", "community"}


def test_neighbors_param_validation(indexed):
    api, pid, _ = indexed
    base = f"/v1/projects/{pid}/neighbors?node={q('.#repository')}"
    for bad in ("&depth=0", "&depth=4", "&limit=0", "&limit=2001", "&direction=sideways", "&types=NOPE", "&depth=abc"):
        r = api.get(base + bad)
        assert r.status_code == 400 and r.json()["error"]["code"] == "bad_param", bad
    assert api.get(f"/v1/projects/{pid}/neighbors").status_code == 400  # thiếu node
    r = api.get(f"/v1/projects/{pid}/neighbors?node=nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "unknown_node"


def test_neighbors_truncated(indexed):
    api, pid, _ = indexed
    r = api.get(f"/v1/projects/{pid}/neighbors?node={q('.#repository')}&depth=3&limit=5").json()
    assert r["truncated"] is True and len(r["nodes"]) <= 5


def test_node_by_path_id(indexed):
    api, pid, _ = indexed
    node_id = "lib/services/auth_service.dart::AuthService.login#method"
    r = api.get(f"/v1/projects/{pid}/nodes/{q(node_id)}")
    assert r.status_code == 200 and r.json()["id"] == node_id and r.json()["kind"] == "method"
    assert api.get(f"/v1/projects/{pid}/nodes/{q('nope#x')}").status_code == 404


def test_code_returns_lines_and_language(indexed):
    api, pid, _ = indexed
    r = api.get(f"/v1/projects/{pid}/code?file=lib/services/auth_service.dart&start=10&end=11")
    body = r.json()
    assert r.status_code == 200 and body["language"] == "dart" and body["start"] == 10 and body["end"] == 11
    assert body["text"].count("\n") == 1 and "_api.post" in body["text"] and body["stale"] is False
    whole = api.get(f"/v1/projects/{pid}/code?file=lib/main.dart").json()
    assert whole["start"] == 1 and whole["end"] >= 10 and "runApp" in whole["text"]


def test_code_rejects_path_escape(indexed):
    api, pid, root = indexed
    outside = root.parent / "secret.dart"
    outside.write_text("class Secret {}\n")
    for bad in ("../secret.dart", "lib/../../secret.dart", "/etc/passwd", str(outside), "..%2Fsecret.dart",
                "C:\\Windows\\win.ini", "lib\\main.dart"):
        r = api.get(f"/v1/projects/{pid}/code?file={bad}")
        assert r.status_code in (400, 403, 404), bad
        assert "Secret" not in r.text and "root:" not in r.text
    if sys.platform != "win32":
        os.symlink(outside, root / "lib" / "leak.dart")
        r = api.get(f"/v1/projects/{pid}/code?file=lib/leak.dart")
        assert r.status_code in (403, 404) and "Secret" not in r.text


def test_code_only_serves_indexed_files(indexed):
    api, pid, root = indexed
    assert api.get(f"/v1/projects/{pid}/code?file=pubspec.yaml").status_code == 404
    assert api.get(f"/v1/projects/{pid}/code?file=.nexgraph/graph.db").status_code == 404


def test_code_reports_stale(indexed):
    api, pid, root = indexed
    (root / "lib" / "main.dart").write_text("// đã sửa\nvoid main() {}\n", encoding="utf-8")
    body = api.get(f"/v1/projects/{pid}/code?file=lib/main.dart").json()
    assert body["stale"] is True and "đã sửa" in body["text"]


def test_code_missing_and_range_errors(indexed):
    api, pid, root = indexed
    (root / "lib" / "router.dart").unlink()
    r = api.get(f"/v1/projects/{pid}/code?file=lib/router.dart")
    assert r.status_code == 404 and r.json()["error"]["code"] == "file_not_found"
    for bad in ("start=0", "start=5&end=2", "start=1&end=5000"):
        r = api.get(f"/v1/projects/{pid}/code?file=lib/main.dart&{bad}")
        assert r.status_code == 400 and r.json()["error"]["code"] == "bad_param", bad
