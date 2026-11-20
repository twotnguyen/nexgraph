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
         "get_section", "get_callers", "tests_for", "find"}


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
    assert all(t.annotations and t.annotations.readOnlyHint for t in tools)


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
