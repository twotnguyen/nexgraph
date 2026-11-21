import json
import os

import pytest

from nexgraph_engine.errors import ApiError
from nexgraph_engine.mcp.server import build_server
from nexgraph_engine.query.source_policy import SourcePolicy
from test_mcp import call, payload

MODEL = {"X-NexGraph-Audience": "model"}
FAKE_SECRET = "FAKE_GROUP6_PRIVATE_SENTINEL"


def test_ai_sources_obey_parent_nested_and_published_exclusions(tmp_path):
    package = tmp_path / "pkg"
    package.mkdir()
    for name in ("safe.py", "other.py", "local.ts", ".Env.debug.ts", "id_ed25519.backup"):
        (package / name).write_text("test fixture", encoding="utf-8")
    (package / ".gitignore").write_text("*.py\n!safe.py\n!local.ts\n!*.ts\n", encoding="utf-8")
    hidden = tmp_path / "hidden"
    hidden.mkdir()
    (hidden / "safe.py").write_text("ignored parent", encoding="utf-8")
    (tmp_path / ".gitignore").write_text("pkg/private*\nhidden/\n!hidden/safe.py\n", encoding="utf-8")
    policy = SourcePolicy(tmp_path, ["pkg/local.ts"])
    assert policy.allows("pkg/safe.py")
    for path in ("pkg/other.py", "pkg/local.ts", "pkg/.Env.debug.ts", "pkg/id_ed25519.backup", "hidden/safe.py"):
        assert not policy.allows(path), path


def test_model_and_mcp_filter_stale_source_and_keep_the_local_graph(api, copy_fixture, tmp_path):
    root = copy_fixture("flow_app")
    service = root / "service.py"
    service.write_text(service.read_text(encoding="utf-8") + f"\n# {FAKE_SECRET}\n", encoding="utf-8")
    pid = api.open(root)["project_id"]
    assert api.index(pid)["state"] == "done"
    prefix = f"/v1/projects/{pid}"
    (root / ".gitignore").write_text("service.py\n", encoding="utf-8")

    local = api.get(f"{prefix}/code", params={"file": "service.py"})
    assert local.status_code == 200 and FAKE_SECRET in local.json()["text"]
    blocked = api.get(f"{prefix}/code", params={"file": "service.py"}, headers=MODEL)
    assert blocked.status_code == 403 and blocked.json()["error"]["code"] == "protected_source"
    assert FAKE_SECRET not in blocked.text
    assert api.get(f"{prefix}/code", params={"file": "app.py"}, headers=MODEL).status_code == 200
    hits = api.get(f"{prefix}/search", params={"q": "login"}, headers=MODEL).json()
    assert hits and all(h["node"]["file"] != "service.py" for h in hits)
    assert api.get(f"{prefix}/nodes/service.py%23file", headers=MODEL).status_code == 403
    hood = api.get(f"{prefix}/neighbors", params={"node": ".#repository", "depth": 2}, headers=MODEL)
    assert hood.status_code == 200
    assert all(n["file"] != "service.py" for n in hood.json()["nodes"])
    assert all(not e[key].startswith(("service.py#", "service.py::"))
               for e in hood.json()["edges"] for key in ("source", "target"))
    view = api.get(f"{prefix}/architecture", headers=MODEL).json()
    assert all(block["id"] != "file:service.py" for block in view["blocks"])
    flow_id = api.get(f"{prefix}/flows", params={"q": "login"}).json()["flows"][0]["id"]
    assert api.get(f"{prefix}/flows/{flow_id}", headers=MODEL).status_code == 403
    pack = api.post(f"{prefix}/context", json={"question": "login"})
    assert pack.status_code == 200 and pack.json()["items"]
    assert all(item["code"]["file"] != "service.py" for item in pack.json()["items"])
    assert FAKE_SECRET not in pack.text

    mcp = build_server(root, tmp_path / "appdata")
    rejected = call(mcp, "read_code", {"file": "service.py"})
    assert rejected.isError and FAKE_SECRET not in rejected.content[0].text
    context = payload(call(mcp, "get_context", {"question": "login"}))
    assert context["items"] and all(item["code"]["file"] != "service.py" for item in context["items"])
    assert FAKE_SECRET not in json.dumps(context)
    assert payload(call(mcp, "read_code", {"file": "app.py"}))["text"]


def test_mcp_refuses_questions_about_a_hidden_node(api, copy_fixture, tmp_path):
    root = copy_fixture("flow_app")
    assert api.index(api.open(root)["project_id"])["state"] == "done"
    (root / ".gitignore").write_text("service.py\n", encoding="utf-8")
    mcp = build_server(root, tmp_path / "appdata")
    hidden = "service.py::login_user#function"
    for tool, args in [("get_node", {"node_id": hidden}), ("get_neighbors", {"node_id": hidden}),
                       ("get_callers", {"node_id": hidden}), ("tests_for", {"node_id": "service.py::hash_password#function"}),
                       ("shortest_path", {"source": "app.py#file", "target": hidden})]:
        result = call(mcp, tool, args)
        assert result.isError and "test_login" not in result.content[0].text, tool


@pytest.mark.parametrize("parent", ["secrets", ".aws"])
def test_sensitive_folder_above_the_project_does_not_block_everything(tmp_path, parent):
    root = tmp_path / parent / "proj"
    (root / "docs").mkdir(parents=True)
    (root / "docs" / "README.md").write_text("# x\n", encoding="utf-8")
    (root / "app.py").write_text("x = 1\n", encoding="utf-8")
    (root / ".aws").mkdir()
    (root / ".aws" / "config").write_text("k\n", encoding="utf-8")
    policy = SourcePolicy(root)
    assert policy.allows("docs/README.md") and policy.allows("app.py")
    assert not policy.allows(".aws/config")


def test_memory_filter_reads_file_paths_containing_hash(tmp_path):
    from nexgraph_engine.memory import source_filter
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "C#.md").write_text("# Intro\n", encoding="utf-8")
    allows = source_filter(SourcePolicy(tmp_path, ["*.md"]))
    assert not allows("docs/C#.md::Intro#document")
    assert not allows("docs/C#.md#file")


def test_model_code_checks_target_of_indexed_file_after_symlink_swap(api, tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    path = root / "old.py"
    path.write_text("def old():\n    return 1\n", encoding="utf-8")
    hidden = root / ".env.test"
    hidden.write_text(FAKE_SECRET, encoding="utf-8")
    pid = api.open(root)["project_id"]
    assert api.index(pid)["state"] == "done"
    path.unlink()
    try:
        path.symlink_to(hidden)
    except OSError as exc:
        if os.name == "nt" and exc.winerror == 1314:
            pytest.skip("Windows không cấp quyền tạo symlink tệp")
        raise
    response = api.get(f"/v1/projects/{pid}/code", params={"file": "old.py"}, headers=MODEL)
    assert response.status_code == 403 and FAKE_SECRET not in response.text
    hits = api.get(f"/v1/projects/{pid}/search", params={"q": "old"}, headers=MODEL).json()
    assert hits == []


def test_model_source_never_returns_bytes_from_a_different_open_handle(tmp_path, monkeypatch):
    shown = tmp_path / "allowed.py"
    hidden = tmp_path / ".env.test"
    shown.write_bytes(b"0" * len(FAKE_SECRET))
    hidden.write_text(FAKE_SECRET, encoding="utf-8")
    policy = SourcePolicy(tmp_path)
    selected = policy.resolve("allowed.py")
    original = os.open

    def substituted(path, flags):
        assert path == selected
        return original(hidden, flags)

    monkeypatch.setattr(os, "open", substituted)
    with pytest.raises(ApiError, match="Nguồn bị loại"):
        policy.read("allowed.py", selected)


@pytest.mark.parametrize("name", ["aws_credentials.txt", "secrets/x.md", ".aws/config", "prod.secret.json",
                                  "service-account.json", "keys/server.p12"])
def test_sensitive_names_of_the_reference_detector_are_blocked(tmp_path, name):
    """Cùng tiêu chí với `graphify.detect._is_sensitive` mà W9 dùng: không đưa vào AI dù không có trong .gitignore."""
    path = tmp_path / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("AKIA" + "X" * 16, encoding="utf-8")
    (tmp_path / "src.py").write_text("x = 1\n", encoding="utf-8")
    policy = SourcePolicy(tmp_path)
    assert policy.allows("src.py")
    assert not policy.allows(name)
