import anyio
import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from nexgraph_engine.cli import _build_parser
from nexgraph_engine.mcp.server import build_server
from test_api_global import _join, _pair
from test_mcp import call, payload


@pytest.fixture
def grouped(api, copy_fixture):
    lib, app = _pair(api, copy_fixture)
    _join(api, lib, app)
    services = api.app.state.services
    return services.registry.get(app).path, services.data_dir, lib, app


def _tools(server):
    async def run():
        async with create_connected_server_and_client_session(server._mcp_server) as client:
            return (await client.list_tools()).tools
    return {t.name: t for t in anyio.run(run)}


def test_global_lists_repositories(grouped):
    root, data_dir, lib, app = grouped
    server = build_server(root, data_dir, global_graph=True)
    tools = _tools(server)
    assert tools["list_repositories"].annotations.readOnlyHint
    assert tools["query_graph"].annotations.readOnlyHint
    assert "repository" in tools["query_graph"].inputSchema["properties"]
    repos = payload(call(server, "list_repositories", {}))
    assert [(r["project_id"], r["current"], r["available"]) for r in repos] == [(lib, False, True), (app, True, True)]
    assert all(r["cross_edges"] >= 1 for r in repos)


def test_query_graph_on_other_repository(grouped):
    root, data_dir, lib, app = grouped
    server = build_server(root, data_dir, global_graph=True)
    out = payload(call(server, "query_graph", {"question": "Calculator add", "repository": "global_ts_lib app"}))
    assert out["repository"] == lib
    assert any(n["id"] == "src/calculator.ts::Calculator.add#method" for n in out["nodes"])
    assert {"project_id": app, "node_id": "src/cart.ts::checkout#function", "via": "src/calculator.ts::Calculator.add#method",
            "direction": "in", "type": "CALLS", "subtype": "member_call"}.items() <= next(
        e for e in out["cross_repo"] if e["via"] == "src/calculator.ts::Calculator.add#method").items()
    here = payload(call(server, "query_graph", {"question": "checkout"}))
    assert here["repository"] == app
    bad = call(server, "query_graph", {"question": "x", "repository": "khong-co"})
    assert bad.isError


def test_default_server_has_no_list_repositories(grouped):
    root, data_dir, *_ = grouped
    tools = _tools(build_server(root, data_dir))
    assert "list_repositories" not in tools
    assert "repository" not in tools["query_graph"].inputSchema["properties"]


def test_cli_accepts_global_flag():
    args = _build_parser().parse_args(["mcp", "--project", "/x", "--global", "--data-dir", "/d"])
    assert args.global_graph is True


def test_cross_repo_hides_nodes_excluded_from_ai(grouped):
    root, data_dir, lib, app = grouped
    server = build_server(root, data_dir, global_graph=True)
    before = payload(call(server, "query_graph", {"question": "checkout"}))["cross_repo"]
    assert any(e["node_id"] == "src/calculator.ts::Calculator.add#method" for e in before)
    from nexgraph_engine.store.projects import ProjectRegistry
    lib_root = ProjectRegistry(data_dir, read_only=True).get(lib).path
    (lib_root / ".gitignore").write_text("src/calculator.ts\n", encoding="utf-8")
    after = payload(call(server, "query_graph", {"question": "checkout"}))
    assert not any("calculator.ts" in str(e) for e in after["cross_repo"])
