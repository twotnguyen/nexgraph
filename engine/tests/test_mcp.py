import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

import anyio
import pytest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.shared.memory import create_connected_server_and_client_session

from nexgraph_engine.mcp.server import ProjectNotIndexed, build_server

TOOLS = {"search", "get_node", "get_neighbors", "get_architecture", "get_evidence", "get_impact", "read_code",
         "query_graph", "shortest_path", "god_nodes", "graph_stats", "get_community", "list_flows", "trace_flow", "get_context",
         "get_section", "get_callers", "tests_for", "find", "remember", "recall",
         "list_prs", "get_pr_impact", "triage_prs", "review_status"}


@pytest.fixture
def indexed(api, copy_fixture, tmp_path):
    root = copy_fixture("bookstore_app")
    p = api.open(root)
    assert api.index(p["project_id"])["state"] == "done"
    return root, tmp_path / "appdata"


def call(server, name: str, args: dict):
    async def run():
        async with create_connected_server_and_client_session(server._mcp_server) as client:
            return await client.call_tool(name, args)
    return anyio.run(run)


def payload(result):
    assert result.isError is False, result.content[0].text
    sc = result.structuredContent  # list -> {"result": [...]}; dict không schema -> chỉ có content JSON
    if sc is None:
        return json.loads(result.content[0].text)
    return sc["result"] if set(sc) == {"result"} else sc


def test_lists_only_read_only_tools(indexed):
    server = build_server(*indexed)

    async def run():
        async with create_connected_server_and_client_session(server._mcp_server) as client:
            return (await client.list_tools()).tools
    tools = anyio.run(run)
    assert {t.name for t in tools} == TOOLS
    # remember là ngoại lệ ghi duy nhất (ADR 0019), và chỉ ghi bộ nhớ của NexGraph.
    assert {t.name for t in tools if not (t.annotations and t.annotations.readOnlyHint)} == {"remember"}


def test_search_and_node(indexed):
    server = build_server(*indexed)
    hits = payload(call(server, "search", {"query": "AuthService"}))
    assert hits and hits[0]["node"]["label"] == "AuthService"
    node = payload(call(server, "get_node", {"node_id": hits[0]["node"]["id"]}))
    assert node["id"] == hits[0]["node"]["id"]


def test_neighbors_match_http_contract(indexed):
    server = build_server(*indexed)
    body = payload(call(server, "get_neighbors", {"node_id": "lib/screens/login_screen.dart#file",
                                                 "types": ["IMPORTS"], "direction": "out"}))
    assert {e["target"] for e in body["edges"]} == {"lib/services/auth_service.dart#file",
                                                     "lib/widgets/primary_button.dart#file"}


def test_architecture_and_evidence(indexed):
    server = build_server(*indexed)
    view = payload(call(server, "get_architecture", {}))
    assert 0 < len(view["blocks"]) <= 12
    link = view["links"][0]
    ev = payload(call(server, "get_evidence", {"from_block": link["from"], "to_block": link["to"]}))
    assert len(ev) == min(link["count"], 50) and all(e["line"] >= 1 for e in ev)


def test_read_code_and_path_guard(indexed):
    server = build_server(*indexed)
    code = payload(call(server, "read_code", {"file": "lib/services/auth_service.dart", "start": 1, "end": 3}))
    assert code["start"] == 1 and code["end"] <= 3 and code["stale"] is False
    bad = call(server, "read_code", {"file": "../secret.txt"})
    assert bad.isError and "tương đối" in bad.content[0].text


def test_impact_without_changes(indexed):
    server = build_server(*indexed)
    body = payload(call(server, "get_impact", {}))
    assert body["changed_files"] == [] and body["impacted"] == []


def test_unknown_node_is_tool_error(indexed):
    bad = call(build_server(*indexed), "get_node", {"node_id": "nope#file"})
    assert bad.isError and "nope#file" in bad.content[0].text


def test_not_indexed_project(tmp_path):
    with pytest.raises(ProjectNotIndexed):
        build_server(tmp_path, None)


def test_mcp_tools_require_a_published_graph(api, copy_fixture, tmp_path):
    root = copy_fixture("bookstore_app")
    pid = api.open(root)["project_id"]
    server = build_server(root, tmp_path / "appdata")

    before = call(server, "graph_stats", {})
    assert before.isError and "chưa được lập chỉ mục xong" in before.content[0].text

    assert api.index(pid)["state"] == "done"
    assert payload(call(server, "graph_stats", {}))["files"] == 9


def test_mcp_app_dir_fallback_reads_registry_read_only(api, copy_fixture, tmp_path, monkeypatch):
    from nexgraph_engine.store import projects

    root = copy_fixture("bookstore_app")

    def app_dir_storage(registry, _root, project_id, _in_project_db):
        return registry._app_dir_db(project_id), "app_dir"

    monkeypatch.setattr(projects.ProjectRegistry, "_create_storage", app_dir_storage)
    project = api.open(root)
    assert project["storage"] == "app_dir"
    assert api.index(project["project_id"])["state"] == "done"
    open_db = projects.open_app_db

    def read_only(path, *, read_only=False):
        assert read_only
        return open_db(path, read_only=read_only)

    with monkeypatch.context() as m:
        m.setattr(projects, "open_app_db", read_only)
        assert payload(call(build_server(root, tmp_path / "appdata"), "graph_stats", {}))["files"] == 9


def test_stdio_cli(indexed):
    root, data_dir = indexed
    params = StdioServerParameters(command=sys.executable,
                                   args=["-m", "nexgraph_engine.cli", "mcp", "--project", str(root),
                                         "--data-dir", str(data_dir)])

    async def run():
        async with stdio_client(params) as (r, w), ClientSession(r, w) as client:
            await client.initialize()
            return await client.call_tool("search", {"query": "login"})
    assert payload(anyio.run(run))


def _stdio_probe(root, data_dir, messages: list[dict]) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items() if k != "NEXGRAPH_MCP_KEY"}
    return subprocess.run(
        [sys.executable, "-m", "nexgraph_engine.cli", "mcp", "--project", str(root), "--data-dir", str(data_dir)],
        input="".join(json.dumps(message) + "\n" for message in messages),
        capture_output=True, text=True, encoding="utf-8", timeout=60, env=env)


def test_unknown_probe_before_initialize_is_quiet(indexed):
    """A4-F1: Claude Code gửi `server/discover` trước `initialize`; trả MethodNotFound gọn,
    không dump 31 lỗi validation ra stderr, và initialize sau đó vẫn thành công."""
    root, data_dir = indexed
    proc = _stdio_probe(root, data_dir, [
        {"jsonrpc": "2.0", "id": 1, "method": "server/discover", "params": {}},
        {"jsonrpc": "2.0", "id": 2, "method": "initialize", "params": {
            "protocolVersion": "2025-11-25", "capabilities": {},
            "clientInfo": {"name": "probe", "version": "0"}}},
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
    ])
    assert proc.returncode == 0
    responses = {r.get("id"): r for r in (json.loads(line) for line in proc.stdout.splitlines() if line.strip())}
    assert responses[1]["error"]["code"] == -32601
    assert responses[1]["error"]["message"] == "Method not found: server/discover"
    assert responses[2]["result"]["serverInfo"]["name"] == "nexgraph"
    assert "result" in responses[2]
    stderr_lines = [line for line in proc.stderr.splitlines() if line.strip()]
    assert len(stderr_lines) <= 1, proc.stderr
    assert "Failed to validate request" not in proc.stderr



def _stdio_probe_raw(root, data_dir, chunks: list[bytes]) -> subprocess.CompletedProcess:
    """Ghi byte thô vào stdin theo từng chunk (cắt giữa ký tự UTF-8) rồi đọc kết quả."""
    import time

    env = {k: v for k, v in os.environ.items() if k != "NEXGRAPH_MCP_KEY"}
    proc = subprocess.Popen(
        [sys.executable, "-m", "nexgraph_engine.cli", "mcp", "--project", str(root), "--data-dir", str(data_dir)],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    assert proc.stdin is not None
    for chunk in chunks:
        proc.stdin.write(chunk)
        proc.stdin.flush()
        time.sleep(0.05)
    proc.stdin.close()
    out = proc.stdout.read() if proc.stdout is not None else b""
    err = proc.stderr.read() if proc.stderr is not None else b""
    code = proc.wait(timeout=60)
    return subprocess.CompletedProcess(proc.args, code, out.decode("utf-8", "replace"), err.decode("utf-8", "replace"))


INIT = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
    "protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "probe", "version": "0"}}}
INITIALIZED = {"jsonrpc": "2.0", "method": "notifications/initialized"}


def _responses(proc):
    return {r.get("id"): r for r in (json.loads(line) for line in proc.stdout.splitlines() if line.strip())}


def test_unknown_method_after_initialize_is_quiet(indexed):
    """M6 (review 23/11): method lạ SAU initialize cũng phải trả -32601 gọn, không dump 31 lỗi validation."""
    root, data_dir = indexed
    proc = _stdio_probe(root, data_dir, [
        INIT, INITIALIZED,
        {"jsonrpc": "2.0", "id": 2, "method": "server/discover", "params": {}},
        {"jsonrpc": "2.0", "id": 3, "method": "tools/list"},
    ])
    assert proc.returncode == 0
    responses = _responses(proc)
    assert responses[2]["error"] == {"code": -32601, "message": "Method not found: server/discover"}
    assert responses[3]["result"]["tools"], "tools/list sau method lạ vẫn phải trả lời"
    assert "Failed to validate request" not in proc.stderr and "validation error" not in proc.stderr
    assert "Traceback" not in proc.stderr


def test_batch_message_after_initialize_keeps_server_alive(indexed):
    root, data_dir = indexed
    proc = _stdio_probe(root, data_dir, [
        INIT, INITIALIZED,
        [{"jsonrpc": "2.0", "id": 10, "method": "ping"},
         {"jsonrpc": "2.0", "id": 11, "method": "tools/list"}],
        {"jsonrpc": "2.0", "id": 3, "method": "tools/list"},
    ])
    assert proc.returncode == 0
    responses = _responses(proc)
    assert responses[10]["error"]["code"] == -32600 and responses[11]["error"]["code"] == -32600
    assert responses[3]["result"]["tools"], "batch bị từ chối nhưng server phải sống và trả lời tiếp"


def test_large_initialize_and_utf8_split_across_chunks(indexed):
    """>64 KB và UTF-8 bị cắt giữa ký tự khi client ghi stdin: vẫn initialize + tools/list bình thường."""
    root, data_dir = indexed
    init = {**INIT, "params": {**INIT["params"],
                               "clientInfo": {"name": "đ" * 30_000 + "p" * 40_000, "version": "0"}}}
    line = (json.dumps(init, ensure_ascii=False) + "\n" + json.dumps(INITIALIZED) + "\n"
            + json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}) + "\n").encode("utf-8")
    assert len(line) > 64 * 1024
    cut = line.index("đ".encode("utf-8")) + 1  # giữa ký tự nhiều byte
    proc = _stdio_probe_raw(root, data_dir, [line[:cut], line[cut:cut + 10], line[cut + 10:]])
    assert proc.returncode == 0
    responses = _responses(proc)
    assert responses[1]["result"]["serverInfo"]["name"] == "nexgraph"
    assert responses[2]["result"]["tools"]
    assert "Traceback" not in proc.stderr


def test_query_graph_tool(indexed):
    body = payload(call(build_server(*indexed), "query_graph", {"question": "login auth"}))
    assert body["nodes"] and "edges" in body
    bad = call(build_server(*indexed), "query_graph", {"question": "!!!"})
    assert bad.isError


def test_shortest_path_tool(indexed):
    server = build_server(*indexed)
    body = payload(call(server, "shortest_path", {"source": "lib/screens/login_screen.dart#file",
                                                 "target": "lib/services/auth_service.dart#file"}))
    assert body["unconnected"] == [] and len(body["nodes"]) >= 2
    bad = call(server, "shortest_path", {"source": "nope#file", "target": "lib/main.dart#file"})
    assert bad.isError and "nope#file" in bad.content[0].text


def test_god_nodes_and_stats_tools(indexed):
    server = build_server(*indexed)
    gods = payload(call(server, "god_nodes", {"top": 3}))
    assert 0 < len(gods) <= 3
    stats = payload(call(server, "graph_stats", {}))
    assert stats["files"] > 0 and stats["edges_by_type"]


def test_get_community_tool(indexed):
    server = build_server(*indexed)
    view = payload(call(server, "get_architecture", {}))
    com = payload(call(server, "get_community", {"community_id": f"com:{_first_community(indexed)}", "limit": 2}))
    assert com["community"]["size"] >= len(com["nodes"]) and len(com["nodes"]) <= 2
    assert com["truncated"] == (com["community"]["size"] > 2)
    assert view  # kiến trúc vẫn chạy cùng server
    bad = call(server, "get_community", {"community_id": "com:999999"})
    assert bad.isError


def test_get_community_rejects_huge_numeric_id():
    """id hàng nghìn chữ số từng làm int() ném ValueError (tool crash) thay vì lỗi đọc được."""
    from mcp.server.fastmcp.exceptions import ToolError

    from nexgraph_engine.mcp.server import community_json

    with pytest.raises(ToolError):
        community_json(object(), "com:" + "9" * 5000, 10)


def _first_community(indexed):
    from nexgraph_engine.mcp.server import resolve_graph_db
    from nexgraph_engine.schema.db import open_graph_db
    conn = open_graph_db(resolve_graph_db(*indexed), read_only=True)
    try:
        return conn.execute("SELECT ma_khoi FROM khoi_kien_truc ORDER BY ma_khoi LIMIT 1").fetchone()[0]
    finally:
        conn.close()


KEY = "m" * 32


def _start_http(indexed, key):
    root, data_dir = indexed
    env = {k: v for k, v in os.environ.items() if k != "NEXGRAPH_MCP_KEY"}
    if key is not None:
        env["NEXGRAPH_MCP_KEY"] = key
    return subprocess.Popen([sys.executable, "-m", "nexgraph_engine.cli", "mcp", "--project", str(root),
                             "--data-dir", str(data_dir), "--http", "--port", "0"],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", env=env)


def _post(port, headers):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}}).encode()
    req = urllib.request.Request(f"http://127.0.0.1:{port}/mcp", data=body, method="POST", headers={
        "Content-Type": "application/json", "Accept": "application/json, text/event-stream", **headers})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def test_http_requires_key(indexed):
    from test_cli_serve import read_ready
    p = _start_http(indexed, KEY)
    try:
        port = read_ready(p)["port"]
        assert _post(port, {}) == 401
        assert _post(port, {"X-API-Key": "x" * 32}) == 401
        assert _post(port, {"X-API-Key": KEY}) == 200
    finally:
        p.kill()


def test_http_without_key_exits_2(indexed):
    p = _start_http(indexed, None)
    assert p.wait(timeout=20) == 2
    assert "NEXGRAPH_MCP_KEY" in p.stderr.read()


def test_flow_tools(indexed_flow):
    server = build_server(*indexed_flow)
    listed = payload(call(server, "list_flows", {"query": "login"}))
    fid = listed["flows"][0]["id"]
    assert payload(call(server, "trace_flow", {"flow_id": fid}))["steps"][1]["node"]["label"] == "login_user"
    live = payload(call(server, "trace_flow", {"entry": "service.py::login_user#function"}))
    assert live["flow"]["id"] == 0 and [s["node"]["label"] for s in live["steps"]][:2] == ["login_user", "find_user"]
    assert call(server, "trace_flow", {}).isError is True


def test_get_context_tool(indexed_flow):
    server = build_server(*indexed_flow)
    assert payload(call(server, "get_context", {"question": "login"}))["items"]


def test_graph_stats_reports_freshness(indexed):
    stats = payload(call(build_server(*indexed), "graph_stats", {}))
    assert {"indexed_at", "index_commit", "head_commit", "changed_files", "stale"} <= set(stats)


def test_get_section_tool(api, tmp_path):
    root = tmp_path / "docs proj"
    root.mkdir()
    (root / "README.md").write_text("# Top\n\nx\n\n## Setup\n\ntoken = \"sk-abcdefghijklmnopqrstuvwx1234\"\n", encoding="utf-8")
    p = api.open(root)
    r = api.post(f"/v1/projects/{p['project_id']}/index", json={"include_docs": True})
    import time
    for _ in range(1500):
        if api.get(f"/v1/jobs/{r.json()['job_id']}").json()["state"] in ("done", "error"):
            break
        time.sleep(0.02)
    server = build_server(root, tmp_path / "appdata")
    hits = payload(call(server, "search", {"query": "Setup", "kinds": ["document"]}))
    out = payload(call(server, "get_section", {"node_id": hits[0]["node"]["id"]}))
    assert out["text"].startswith("## Setup") and "sk-abcdefghijklmnopqrstuvwx1234" not in out["text"]
    assert call(server, "get_section", {"node_id": "README.md#file"}).isError is True


def test_get_section_refuses_secret_named_document(api, tmp_path):
    """Quyết định lead (re-review #52 vòng 3): MCP là đường tới model nên tài liệu tên nhạy cảm bị từ chối."""
    token = "sk-" + "live-" + "A3TEST" + "1234567890"
    root = tmp_path / "docs secret"
    (root / "docs").mkdir(parents=True)
    (root / "docs" / "secret.md").write_text(
        f"# Bí mật\n\n## Cấu hình\n\nĐặt `api_key={token}` trong tệp.\n", encoding="utf-8")
    (root / "secrets").mkdir()
    (root / "secrets" / "keys.md").write_text("# Khoá\n\n## Ghi chú\n\nkhông chia sẻ.\n", encoding="utf-8")
    p = api.open(root)
    r = api.post(f"/v1/projects/{p['project_id']}/index", json={"include_docs": True})
    import time
    job = None
    for _ in range(1500):
        job = api.get(f"/v1/jobs/{r.json()['job_id']}").json()
        if job["state"] in ("done", "error"):
            break
        time.sleep(0.02)
    assert job["state"] == "done", job
    server = build_server(root, tmp_path / "appdata")
    for node in ("docs/secret.md::Cấu hình#document", "secrets/keys.md::Ghi chú#document"):
        blocked = call(server, "get_section", {"node_id": node})
        assert blocked.isError is True, node
        assert "loại khỏi ngữ cảnh AI" in blocked.content[0].text, node
        assert token not in blocked.content[0].text, node


def test_get_section_masks_secret_key_env_lines(api, tmp_path):
    """Review #52 Important 1: tài liệu tên TRUNG TÍNH chứa `SECRET_KEY=…` phải trả bản che qua MCP get_section."""
    secret_key = "django-insecure-" + "e6b" + "0123456789abcdef"
    key_base = "9f8e7d6c5b4a3210" + "0f1e2d3c4b5a6978"
    env_lines = ["SECRET_" + "KEY=" + secret_key, "SECRET_" + "KEY_BASE=" + key_base]
    root = tmp_path / "secret key proj"
    (root / "docs").mkdir(parents=True)
    (root / "docs" / "env-notes.md").write_text(
        "# Khoá\n\n## Production\n\n" + "\n".join(env_lines) + "\n", encoding="utf-8")
    p = api.open(root)
    r = api.post(f"/v1/projects/{p['project_id']}/index", json={"include_docs": True})
    job = None
    import time
    for _ in range(1500):
        job = api.get(f"/v1/jobs/{r.json()['job_id']}").json()
        if job["state"] in ("done", "error"):
            break
        time.sleep(0.02)
    assert job["state"] == "done", job
    server = build_server(root, tmp_path / "appdata")
    out = payload(call(server, "get_section", {"node_id": "docs/env-notes.md::Production#document"}))
    assert out["text"].startswith("## Production")
    assert secret_key not in out["text"] and key_base not in out["text"]
    assert "[redacted]" in out["text"]


DOC_FORMS = {
    "json": '{"secret_key": "Json4Pq9Xy2Lk6Q"}',
    "quote": '"ENCRYPTION_KEY=Quote4Pq9Xy2"',
    "prose": "Đặt `MASTER_KEY=Prose8Kx2Rt5` trong tệp.",
    "bullet": "- `SECRET_KEY=Dash4Pq9Xy2Lk6Q`",
    "bracket": "[SIGNING_KEY=Bracket4Pq9Xy2]",
    "export": "export API_KEY=Export8Kx2Rt5ab",
    "yaml": "master_key: Yaml8Kx2Rt5abcd",
    "single": "token = 'Single8Kx2Rt5'",
}


def _index_docs(api, root):
    p = api.open(root)
    r = api.post(f"/v1/projects/{p['project_id']}/index", json={"include_docs": True})
    assert r.status_code == 202, r.text
    import time
    job = None
    for _ in range(1500):
        job = api.get(f"/v1/jobs/{r.json()['job_id']}").json()
        if job["state"] in ("done", "error"):
            break
        time.sleep(0.02)
    assert job["state"] == "done", job
    return p["project_id"]


def test_model_document_paths_redact_all_document_forms(api, tmp_path):
    """Review #52 Important 2: /code, /context, MCP read_code/get_context đều che tài liệu tên trung tính."""
    root = tmp_path / "forms proj"
    (root / "docs").mkdir(parents=True)
    body = "# forms\n\n" + "\n\n".join(f"## {key}\n\n{line}" for key, line in DOC_FORMS.items()) + "\n"
    (root / "docs" / "forms.md").write_text(body, encoding="utf-8")
    pid = _index_docs(api, root)
    server = build_server(root, tmp_path / "appdata")
    values = list(DOC_FORMS.values())

    # MCP read_code: cả tệp, đủ 8 dạng.
    raw = payload(call(server, "read_code", {"file": "docs/forms.md"}))
    for value in values:
        assert value not in raw["text"], value
    assert "[redacted]" in raw["text"]

    # MCP get_context: hỏi đúng từng mục.
    for key in DOC_FORMS:
        pack = json.dumps(payload(call(server, "get_context", {"question": key, "budget": 4000})),
                          ensure_ascii=False)
        assert DOC_FORMS[key] not in pack, key
        assert "[redacted]" in pack, key

    # HTTP /code và /context với audience=model.
    code = api.get(f"/v1/projects/{pid}/code", params={"file": "docs/forms.md"},
                   headers={"X-NexGraph-Audience": "model"})
    assert code.status_code == 200, code.text
    for value in values:
        assert value not in code.json()["text"], value
    assert "[redacted]" in code.json()["text"]
    for key, line in DOC_FORMS.items():
        got = api.post(f"/v1/projects/{pid}/context", json={"question": key, "budget": 4000},
                       headers={"X-NexGraph-Audience": "model"})
        assert got.status_code == 200, got.text
        assert line not in got.text and "[redacted]" in got.text, key

    # Đường UI (không header audience) vẫn đọc nguyên văn: đây là tệp của người dùng, không phải ngữ cảnh model.
    ui = api.get(f"/v1/projects/{pid}/code", params={"file": "docs/forms.md"})
    assert all(value in ui.json()["text"] for value in values)


LOGIN = "lib/services/auth_service.dart::AuthService.login#method"


def test_get_callers_matches_neighbors_in_calls(indexed):
    server = build_server(*indexed)
    got = payload(call(server, "get_callers", {"node_id": LOGIN}))
    want = payload(call(server, "get_neighbors", {"node_id": LOGIN, "types": ["CALLS"], "direction": "in"}))
    assert got == want and got["edges"]


def test_tests_for_tool_lists_test_nodes(indexed):
    from nexgraph_engine.impact.analyze import tests_for
    from nexgraph_engine.mcp.server import resolve_graph_db
    from nexgraph_engine.schema.db import open_graph_db
    server = build_server(*indexed)
    got = payload(call(server, "tests_for", {"node_id": LOGIN}))
    conn = open_graph_db(resolve_graph_db(*indexed), read_only=True)
    try:
        want = {n.id for n in tests_for(conn, LOGIN)}
    finally:
        conn.close()
    assert got and all(n["is_test"] for n in got)
    assert {n["id"] for n in got} == want


def test_tests_for_unknown_node_is_tool_error(indexed):
    assert call(build_server(*indexed), "tests_for", {"node_id": "nope#file"}).isError is True


def test_find_with_kind_filters(indexed):
    hits = payload(call(build_server(*indexed), "find", {"query": "AuthService", "kind": "class"}))
    assert hits and all(h["node"]["kind"] == "class" for h in hits)


RESOURCES = {"nexgraph://report", "nexgraph://stats", "nexgraph://god-nodes", "nexgraph://surprises",
             "nexgraph://questions", "nexgraph://audit"}


def test_lists_six_resources(indexed):
    server = build_server(*indexed)

    async def run():
        async with create_connected_server_and_client_session(server._mcp_server) as client:
            return (await client.list_resources()).resources
    assert {str(r.uri) for r in anyio.run(run)} == RESOURCES


def test_read_resources(indexed):
    server = build_server(*indexed)

    async def run(uri):
        async with create_connected_server_and_client_session(server._mcp_server) as client:
            return (await client.read_resource(uri)).contents[0]
    audit = json.loads(anyio.run(run, "nexgraph://audit").text)
    assert "by_confidence" in audit and "parse_errors" in audit
    assert json.loads(anyio.run(run, "nexgraph://stats").text)["files"] > 0
    assert isinstance(json.loads(anyio.run(run, "nexgraph://god-nodes").text), list)
    report = anyio.run(run, "nexgraph://report")
    assert report.mimeType == "text/markdown" and report.text.startswith("#")


def test_resources_hide_sources_blocked_from_ai(api, tmp_path):
    root = tmp_path / "leak"
    root.mkdir()
    (root / "credentials.py").write_text("def load_secret_vault_token():\n    return 1\n", encoding="utf-8")
    for i in range(8):
        (root / f"m{i}.py").write_text(f"from credentials import load_secret_vault_token\n\n"
                                       f"def use{i}():\n    return load_secret_vault_token()\n", encoding="utf-8")
    p = api.open(root)
    assert api.index(p["project_id"])["state"] == "done"
    server = build_server(root, tmp_path / "appdata")

    async def run(uri):
        async with create_connected_server_and_client_session(server._mcp_server) as client:
            return (await client.read_resource(uri)).contents[0].text
    for uri in RESOURCES:
        text = anyio.run(run, uri)
        assert "load_secret_vault_token" not in text and "credentials" not in text, uri
    gods = payload(call(server, "god_nodes", {}))
    assert all("credentials" not in g["node"]["id"] for g in gods)


def test_pr_tools_use_fake_gh(indexed, monkeypatch):
    import gh_fake
    diff = ("diff --git a/lib/services/auth_service.dart b/lib/services/auth_service.dart\n"
            "--- a/lib/services/auth_service.dart\n+++ b/lib/services/auth_service.dart\n@@ -1 +1 @@\n-a\n+b\n")
    view = ('{"number": 8, "title": "t", "state": "OPEN", "headRefName": "f", "baseRefName": "main", "author": null,'
            ' "isDraft": false, "reviewDecision": "", "statusCheckRollup": [], "updatedAt": "2026-11-20T00:00:00Z"}')
    gh_fake.install(monkeypatch, {("pr", "view", "8"): view, ("pr", "diff", "8"): diff})
    server = build_server(*indexed)
    assert len(payload(call(server, "list_prs", {}))["prs"]) == 8
    assert [p["number"] for p in payload(call(server, "triage_prs", {}))["ranked"]][0] == 2
    assert payload(call(server, "get_pr_impact", {"pr_number": 8}))["pr"]["number"] == 8
    assert payload(call(server, "review_status", {"pr_number": 8}))["gate"] in ("pass", "advisory")
    bad = call(server, "get_pr_impact", {"pr_number": -1})
    assert bad.isError and "không hợp lệ" in bad.content[0].text


def test_pr_tools_report_missing_gh(indexed, monkeypatch):
    import gh_fake
    from nexgraph_engine.prs.gh import GhError
    gh_fake.install(monkeypatch, {("repo", "view"): GhError("gh_missing")})
    r = call(build_server(*indexed), "list_prs", {})
    assert r.isError and "gh" in r.content[0].text


def _leaky_pr_project(api, tmp_path, monkeypatch):
    """Dự án có `credentials.py` (bị chặn khỏi AI) và một PR sửa tệp đó."""
    import gh_fake
    root = tmp_path / "leakpr"
    root.mkdir()
    (root / "credentials.py").write_text("def load_secret_vault_token():\n    return 1\n", encoding="utf-8")
    (root / "credentials_test.py").write_text(
        "from credentials import load_secret_vault_token\n\ndef test_token():\n    assert load_secret_vault_token() == 1\n",
        encoding="utf-8")
    (root / "m0.py").write_text("from credentials import load_secret_vault_token\n\n"
                                "def use0():\n    return load_secret_vault_token()\n", encoding="utf-8")
    p = api.open(root)
    assert api.index(p["project_id"])["state"] == "done"
    diff = ("diff --git a/credentials.py b/credentials.py\n--- a/credentials.py\n+++ b/credentials.py\n"
            "@@ -1 +1 @@\n-def load_secret_vault_token():\n+def load_secret_vault_token(x=1):\n"
            "diff --git a/m0.py b/m0.py\n--- a/m0.py\n+++ b/m0.py\n@@ -3 +3 @@\n-def use0():\n+def use0(y=0):\n")
    view = ('{"number": 8, "title": "t", "state": "OPEN", "headRefName": "f", "baseRefName": "main", "author": null,'
            ' "isDraft": false, "reviewDecision": "", "statusCheckRollup": [], "updatedAt": "2026-11-20T00:00:00Z"}')
    item = ('{"number": %d, "title": "t%d", "state": "OPEN", "headRefName": "f", "baseRefName": "main", "author": null,'
            ' "isDraft": false, "reviewDecision": "", "statusCheckRollup": [], "updatedAt": "2026-11-20T00:00:00Z",'
            ' "files": [{"path": "credentials.py"}, {"path": "credentials_test.py"}]}')
    gh_fake.install(monkeypatch, {("pr", "view", "8"): view, ("pr", "diff", "8"): diff,
                                  ("pr", "list"): "[" + item % (8, 8) + "," + item % (9, 9) + "]"})
    return root, p["project_id"]


def test_pr_tools_hide_sources_blocked_from_ai(api, tmp_path, monkeypatch):
    root, _ = _leaky_pr_project(api, tmp_path, monkeypatch)
    server = build_server(root, tmp_path / "appdata")
    for name, args in [("list_prs", {}), ("triage_prs", {}), ("get_pr_impact", {"pr_number": 8}),
                       ("review_status", {"pr_number": 8})]:
        text = json.dumps(payload(call(server, name, args)), ensure_ascii=False)
        assert "load_secret_vault_token" not in text and "credentials" not in text, (name, text)
    impact = payload(call(server, "get_pr_impact", {"pr_number": 8}))
    assert "use0" in impact["comment"]  # phần được phép vẫn còn


def test_pr_routes_hide_blocked_sources_for_model(api, tmp_path, monkeypatch):
    _, pid = _leaky_pr_project(api, tmp_path, monkeypatch)
    model = {"X-NexGraph-Audience": "model"}
    for path in (f"/v1/projects/{pid}/prs", f"/v1/projects/{pid}/prs/8"):
        text = api.get(path, headers=model).text
        assert "load_secret_vault_token" not in text and "credentials" not in text, (path, text)
    # Giao diện của chính người dùng vẫn thấy đủ.
    assert "credentials.py" in api.get(f"/v1/projects/{pid}/prs/8").text


def test_get_impact_accepts_a_node_id(indexed):
    server = build_server(*indexed)
    body = payload(call(server, "get_impact", {"node_id": "lib/services/auth_service.dart#file"}))
    assert body["node"]["id"] == "lib/services/auth_service.dart#file"
    assert "impacted" in body and "tests" in body
    bad = call(server, "get_impact", {"node_id": "nope#file"})
    assert bad.isError and "nope#file" in bad.content[0].text
