import json
import sys

import anyio
import pytest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.shared.memory import create_connected_server_and_client_session

from nexgraph_engine.mcp.server import ProjectNotIndexed, build_server

TOOLS = {"search", "get_node", "get_neighbors", "get_architecture", "get_evidence", "get_impact", "read_code"}


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
