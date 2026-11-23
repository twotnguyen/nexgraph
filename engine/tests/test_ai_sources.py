import json
import os
import re

import pytest

from nexgraph_engine.errors import ApiError
from nexgraph_engine.mcp.server import build_server
from nexgraph_engine.query.source_policy import SourcePolicy
from test_mcp import call, payload

MODEL = {"X-NexGraph-Audience": "model"}
FAKE_SECRET = "FAKE_GROUP6_PRIVATE_SENTINEL"


def test_secret_shaped_document_names_are_blocked_without_exemption(tmp_path):
    """Quyết định lead (re-review #52 vòng 3): che bằng regex không bao giờ kín nên KHÔNG miễn theo tên tệp.

    Mọi tên trông như kho bí mật — kể cả tài liệu chữ — bị loại khỏi nguồn cho model như trên `main`.
    """
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "secret.md").write_text("x", encoding="utf-8")
    (tmp_path / "docs" / "secrets.md").write_text("x", encoding="utf-8")
    (tmp_path / "SECRETS.txt").write_text("x", encoding="utf-8")
    (tmp_path / "secrets").mkdir()
    (tmp_path / "secrets" / "notes.md").write_text("x", encoding="utf-8")
    policy = SourcePolicy(tmp_path)
    for name in ("docs/secret.md", "docs/secrets.md", "SECRETS.txt", "secrets/notes.md"):
        assert not policy.allows(name), name


def test_document_and_config_names_that_look_like_secret_stores_are_blocked(tmp_path):
    """Mọi đuôi tài liệu/cấu hình mang tên nhạy cảm đều bị loại, không có danh sách miễn theo đuôi."""
    names = ["docs/secret.md", "docs/secrets.md", "docs/secrets.txt", "SECRETS.txt",
             "service-account.json", "config/secrets.yaml", "config/secrets.yml", "credentials.json",
             "docs/passwords.txt", "docs/token.md", "docs/secret.md.bak"]
    for name in names:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("x", encoding="utf-8")
    policy = SourcePolicy(tmp_path)
    for name in names:
        assert not policy.allows(name), name


CLOUD_CRED_NAMES = ["kubeconfig", "kubeconfig.yaml", "kubeconfig-prod.yaml", "sub/kubeconfig.yaml",
                    ".kube/config", "service-account-prod.json", "service_account.yaml",
                    "service.account.toml", "prod-sa-key.json", "gcp-nexgraph.json"]


def test_cloud_credential_names_are_blocked(tmp_path):
    """Review #52 Important 3: kubeconfig, service-account*, *-sa-key*.json, gcp-*.json là khoá thật."""
    for name in CLOUD_CRED_NAMES:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("x", encoding="utf-8")
    policy = SourcePolicy(tmp_path)
    for name in CLOUD_CRED_NAMES:
        assert not policy.allows(name), name


def test_code_route_refuses_cloud_credentials_for_model(api, tmp_path):
    """Review #52 Important 3: model không đọc được kubeconfig/service-account qua /code (403 ổn định)."""
    token = "Kube7Tok9" + "Qw3Secret"
    root = tmp_path / "cloud creds"
    (root / ".kube").mkdir(parents=True)
    files = {"kubeconfig.yaml": f"users:\n- token: {token}\n",
             ".kube/config": f"users:\n- token: {token}\n",
             "service-account-prod.json": '{"private_key": "' + token + '"}'}
    for name, body in files.items():
        (root / name).write_text(body, encoding="utf-8")
    pid = api.open(root)["project_id"]
    assert api.index(pid)["state"] == "done"
    server = build_server(root, tmp_path / "appdata")
    for name in files:
        got = api.get(f"/v1/projects/{pid}/code", params={"file": name}, headers=MODEL)
        assert got.status_code == 403, (name, got.text)
        assert got.json()["error"]["code"] == "protected_source", name
        assert token not in got.text, name
        blocked = call(server, "read_code", {"file": name})
        assert blocked.isError is True, name
        assert token not in blocked.content[0].text, name


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


def test_http_paths_ask_locate_hide_blocked_sources_for_model(api, copy_fixture):
    root = copy_fixture("flow_app")
    pid = api.open(root)["project_id"]
    assert api.index(pid)["state"] == "done"
    (root / ".gitignore").write_text("service.py\n", encoding="utf-8")
    prefix = f"/v1/projects/{pid}"
    hidden = "service.py::login_user#function"
    assert api.post(f"{prefix}/paths", json={"node_ids": ["app.py#file", hidden]}, headers=MODEL).status_code == 403
    assert api.get(f"{prefix}/locate", params={"file": "service.py", "line": 6}, headers=MODEL).status_code == 403
    assert api.get(f"{prefix}/locate", params={"file": "service.py", "line": 6}).status_code == 200  # người dùng vẫn thấy
    ask = api.post(f"{prefix}/ask", json={"question": "login"}, headers=MODEL)
    assert ask.status_code == 200 and '"service.py' not in ask.text  # test_service.py vẫn được phép


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


def _cycle_project(tmp_path):
    root = tmp_path / "cycle app"
    root.mkdir()
    (root / "app.py").write_text("from service import login_user\n\n\ndef main():\n    return login_user({})\n", encoding="utf-8")
    (root / "service.py").write_text("from repo import find_user\n\n\ndef login_user(body):\n    return find_user(body)\n", encoding="utf-8")
    (root / "repo.py").write_text("from service import login_user\n\n\ndef find_user(body):\n    return login_user(body)\n", encoding="utf-8")
    (root / "test_service.py").write_text("from service import login_user\n\n\ndef test_login():\n    assert login_user({}) == {}\n", encoding="utf-8")
    return root


def _names_excluded(text: str) -> bool:
    """Tên `service.py` đứng riêng, không tính `test_service.py`."""
    return re.search(r"(?<![A-Za-z0-9._-])service\.py(?![A-Za-z0-9])", text) is not None


def _wait(api, job_id: str) -> dict:
    import time
    end = time.time() + 20
    while time.time() < end:
        job = api.get(f"/v1/jobs/{job_id}").json()
        if job["state"] in ("done", "error", "cancelled"):
            return job
        time.sleep(0.02)
    raise AssertionError("job không kết thúc")


def test_model_audience_hides_excluded_sources_on_every_graph_route(api, tmp_path):
    root = _cycle_project(tmp_path)
    pid = api.open(root)["project_id"]
    assert api.index(pid)["state"] == "done"
    prefix = f"/v1/projects/{pid}"
    assert api.get(f"{prefix}/cycles").json()["total"] == 1  # người dùng vẫn thấy chu trình
    link = next(link for link in api.get(f"{prefix}/architecture").json()["links"]
                if "service.py" in (link["from"] + link["to"]))
    evidence_params = {"from": link["from"], "to": link["to"]}
    evidence = api.get(f"{prefix}/architecture/evidence", params=evidence_params)
    assert evidence.status_code == 200 and "service.py" in evidence.text
    user_tour = api.get(f"{prefix}/tour").json()
    (root / ".gitignore").write_text("service.py\n", encoding="utf-8")
    (root / "service.py").write_text((root / "service.py").read_text(encoding="utf-8") + "\n# đổi\n", encoding="utf-8")
    (root / "repo.py").write_text((root / "repo.py").read_text(encoding="utf-8") + "\n# đổi\n", encoding="utf-8")

    responses = {
        "evidence": api.get(f"{prefix}/architecture/evidence", params=evidence_params, headers=MODEL),
        "changes": api.get(f"{prefix}/changes", headers=MODEL),
        "report": api.get(f"{prefix}/report", headers=MODEL),
        "map": api.get(f"{prefix}/map", headers=MODEL),
        "cycles": api.get(f"{prefix}/cycles", headers=MODEL),
        "tour": api.get(f"{prefix}/tour", headers=MODEL),
    }
    for name, response in responses.items():
        assert response.status_code == 200, (name, response.status_code, response.text[:300])
        assert not _names_excluded(response.text), name
    assert "repo.py" in responses["changes"].text  # chỉ ẩn tệp bị loại, không ẩn cả route
    assert responses["cycles"].json() == {"cycles": [], "total": 0}
    assert len(responses["tour"].json()["steps"]) < len(user_tour["steps"])


def test_model_audience_hides_excluded_sources_in_the_global_graph(api, tmp_path):
    root = _cycle_project(tmp_path)
    pid = api.open(root)["project_id"]
    assert api.index(pid)["state"] == "done"
    assert _wait(api, api.post("/v1/global/projects", json={"project_id": pid}).json()["job_id"])["state"] == "done"

    def hidden(payload: str) -> bool:
        return any(marker in payload for marker in ('"file":"service.py"', '"id":"service.py'))

    assert hidden(api.get("/v1/global/graph", headers=MODEL).text)  # trước khi loại: graph chung có nó
    assert any(hit["node"]["file"] == "service.py" for hit in api.get("/v1/global/search", params={"q": "login"}, headers=MODEL).json())
    assert hidden(api.get("/v1/global/graph", headers=api.headers).text)  # người dùng vẫn thấy graph chung đầy đủ
    (root / ".gitignore").write_text("service.py\n", encoding="utf-8")
    graph = api.get("/v1/global/graph", headers=MODEL)
    assert graph.status_code == 200 and not hidden(graph.text)
    assert graph.json()["nodes"], "graph chung vẫn còn nút của tệp được phép"
    assert all(edge["source"] in {n["id"] for n in graph.json()["nodes"]} for edge in graph.json()["edges"])
    assert all(edge["target"] in {n["id"] for n in graph.json()["nodes"]} for edge in graph.json()["edges"])
    hits = api.get("/v1/global/search", params={"q": "login"}, headers=MODEL).json()
    assert hits and all(hit["node"]["file"] != "service.py" for hit in hits)


def test_model_tour_drops_steps_whose_flow_uses_excluded_sources(api, copy_fixture):
    root = copy_fixture("flow_app")
    pid = api.open(root)["project_id"]
    assert api.index(pid)["state"] == "done"
    steps = api.get(f"/v1/projects/{pid}/tour").json()["steps"]
    assert any("hash_password" in step["body"] for step in steps), steps  # người dùng vẫn thấy
    (root / ".gitignore").write_text("service.py\n", encoding="utf-8")
    model = api.get(f"/v1/projects/{pid}/tour", headers=MODEL).json()["steps"]
    assert model and all("hash_password" not in step["body"] and "login_user" not in step["body"]
                         for step in model)
    # TourPanel hiển thị chính `order`, nên sau khi lọc phải đánh số lại 1..n (Minor re-review 23/11).
    assert [step["order"] for step in model] == list(range(1, len(model) + 1))
    assert [step["order"] for step in steps] == list(range(1, len(steps) + 1))
