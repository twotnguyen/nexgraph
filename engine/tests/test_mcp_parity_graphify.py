"""NG-PAR-2: 8 tool đồ thị MCP NexGraph phải ra **đúng văn bản** của bản gốc.

ADR 0025 mục 2 — nghiệm thu: chạy `python -m graphify.serve <graph.json>` qua MCP stdio
(như `research/cmp11-cmp.py`) và tool NexGraph trên CÙNG một `graph.json`, so từng tool với
≥ 2 bộ tham số; đầu ra NexGraph phải bằng ``rebrand_text(đầu ra gốc)``.

Fixture (module, dựng một lần):
- bản sao `tests/fixtures/bookstore_app` + `README.md` có heading;
- đồ thị **dựng bằng vendor** `python -m graphify extract . --code-only` (không cần khoá LLM);
- thêm nút tài liệu bằng chính `graphify.extractors.markdown.extract_markdown`, vì
  `--code-only` bỏ qua tệp tài liệu còn `extract` đầy đủ đòi khoá LLM (CI không có);
- `.nexgraph/graph.json` là **bản sao** của `graphify-out/graph.json` → hai bên đọc cùng đồ thị;
- `.nexgraph/graph.db` do NexGraph lập chỉ mục, chỉ để MCP server khởi động (không dùng khi có graph.json).

Test đánh dấu ``slow`` nhưng KHÔNG skip — CI chạy đủ.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

import anyio
import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from nexgraph_engine.index.indexer import Indexer
from nexgraph_engine.mcp import graphify_view
from nexgraph_engine.mcp.server import build_server
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.store.graph_store import GraphStore

pytestmark = pytest.mark.slow

FIXTURES = Path(__file__).parent / "fixtures"
README = """# Docs app

Giới thiệu ngắn.

## Cài đặt

Chạy `helper()` trước.

## Cách dùng

Văn bản hướng dẫn.
"""


# ── Fixture: đồ thị vendor + bản sao .nexgraph ──────────────────────────────


def _add_markdown_nodes(root: Path, graph_json: Path) -> None:
    """Thêm nút/ cạnh của README.md bằng chính extractor Markdown của vendor."""
    from graphify.extractors.markdown import extract_markdown

    cwd = Path.cwd()
    os.chdir(root)
    try:
        extracted = extract_markdown(Path("README.md"))
    finally:
        os.chdir(cwd)
    data = json.loads(graph_json.read_text(encoding="utf-8"))
    known = {n["id"] for n in data["nodes"]}
    data["nodes"] += [n for n in extracted["nodes"] if n["id"] not in known]
    links = data.get("links") or []
    links += extracted["edges"]
    data["links"] = links
    graph_json.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


@pytest.fixture(scope="module")
def parity(tmp_path_factory) -> tuple[Path, Path]:
    root = tmp_path_factory.mktemp("parity") / "Đồ án app"
    shutil.copytree(FIXTURES / "bookstore_app", root)
    (root / "README.md").write_text(README, encoding="utf-8")

    # NexGraph lập chỉ mục trước (để graphify-out/ không lọt vào graph.db)
    conn = open_graph_db(root / ".nexgraph" / "graph.db")
    try:
        store = GraphStore(conn)
        store.init_project(root.name, has_git=False)
        Indexer(store, root, on_progress=lambda _e: None, cancel=threading.Event()).run()
    finally:
        conn.close()

    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
    subprocess.run([sys.executable, "-m", "graphify", "extract", ".", "--code-only"],
                   cwd=root, env=env, check=True, capture_output=True, text=True, timeout=300)
    graph_json = root / "graphify-out" / "graph.json"
    assert graph_json.is_file(), "vendor extract không ghi graph.json"
    _add_markdown_nodes(root, graph_json)
    shutil.copy(graph_json, root / ".nexgraph" / "graph.json")
    graphify_view.clear_views()
    return root, graph_json


class StdioClient:
    """Client MCP stdio tối thiểu (như `research/cmp11-cmp.py`)."""

    def __init__(self, argv: list[str], cwd: Path) -> None:
        env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
        # stderr ra tệp tạm: PIPE không đọc sẽ đầy và làm treo tiến trình.
        self._stderr = tempfile.TemporaryFile(mode="w+", encoding="utf-8", errors="replace")
        self.proc = subprocess.Popen(argv, cwd=cwd, env=env, stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=self._stderr,
                                     text=True, encoding="utf-8")
        self._id = 0
        self.request("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                    "clientInfo": {"name": "nexgraph-parity", "version": "1"}})
        self.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
        self.proc.stdin.flush()

    def _stderr_tail(self) -> str:
        try:
            self._stderr.flush()
            self._stderr.seek(0)
            return self._stderr.read()[-3000:]
        except (OSError, ValueError):
            return ""

    def request(self, method: str, params: dict) -> dict:
        self._id += 1
        self.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": self._id, "method": method,
                                          "params": params}) + "\n")
        self.proc.stdin.flush()
        while True:
            line = self.proc.stdout.readline()
            if not line:
                raise RuntimeError(f"MCP server thoát trước khi trả lời {method}: {self._stderr_tail()}")
            message = json.loads(line)
            if message.get("id") == self._id:
                return message

    def call(self, tool: str, arguments: dict) -> tuple[bool, str]:
        result = self.request("tools/call", {"name": tool, "arguments": arguments})["result"]
        text = "\n".join(item.get("text", "") for item in result.get("content", []))
        return bool(result.get("isError")), text

    def close(self) -> None:
        try:
            self.proc.kill()
            self.proc.wait(timeout=10)
        finally:
            for stream in (self.proc.stdin, self.proc.stdout):
                if stream is not None:
                    stream.close()
            self._stderr.close()


@pytest.fixture(scope="module")
def servers(parity):
    root, graph_json = parity
    original = StdioClient([sys.executable, "-m", "graphify.serve", str(graph_json)], cwd=root)
    ours = StdioClient([sys.executable, "-m", "nexgraph_engine.cli", "mcp", "--project", str(root)],
                       cwd=root)
    try:
        yield original, ours
    finally:
        original.close()
        ours.close()


# ── NG-PAR-2: 8 tool đồ thị ─────────────────────────────────────────────────

GRAPH_CASES: dict[str, list[dict]] = {
    "query_graph": [
        {"question": "login auth", "token_budget": 500},
        {"question": "AuthService login", "mode": "dfs", "depth": 2, "token_budget": 4000,
         "context_filter": ["call"], "demote_docs": False},
    ],
    "get_node": [
        {"label": "AuthService"},
        {"label": "ApiClient"},
        {"label": "khong_co_node_nay"},
    ],
    "get_section": [
        {"label": "Docs app"},
        {"label": "Cách dùng", "max_chars": 12},
        {"label": "AuthService"},  # nút mã, không phải mục Markdown: lỗi như bản gốc
    ],
    "get_neighbors": [
        {"label": "AuthService"},
        {"label": "LoginScreen", "relation_filter": "references", "token_budget": 60},
    ],
    "get_community": [
        {"community_id": 0},
        {"community_id": 3, "token_budget": 80},
        {"community_id": 999},
    ],
    "god_nodes": [
        {"top_n": 3},
        {"top_n": 5, "exclude_hubs_percentile": 80},
    ],
    "graph_stats": [
        {},
        {"project_path": "FIXTURE_ROOT"},
    ],
    "shortest_path": [
        {"source": "LoginScreen", "target": "AuthService"},
        {"source": "AuthService", "target": "PrimaryButton", "max_hops": 1},
        {"source": "AuthService", "target": "ApiClient", "undirected": True},
    ],
}


@pytest.mark.parametrize("tool", sorted(GRAPH_CASES))
def test_graph_tools_match_original(servers, parity, tool):
    original, ours = servers
    root, _ = parity
    for arguments in GRAPH_CASES[tool]:
        sent = {k: str(root) if v == "FIXTURE_ROOT" else v for k, v in arguments.items()}
        orig_error, orig_text = original.call(tool, sent)
        our_error, our_text = ours.call(tool, sent)
        assert orig_error is False, (tool, sent, orig_text)
        assert our_error is False, (tool, sent, our_text)
        assert our_text == graphify_view.rebrand_text(orig_text), (tool, sent)


def test_query_graph_header_rebranded(servers):
    original, ours = servers
    _, orig_text = original.call("query_graph", {"question": "login auth"})
    _, our_text = ours.call("query_graph", {"question": "login auth"})
    assert "graphify" not in our_text.lower()
    assert our_text.startswith("Graph: .nexgraph/graph.json")
    assert our_text == graphify_view.rebrand_text(orig_text)


def test_get_section_reads_markdown(servers):
    _, ours = servers
    error, text = ours.call("get_section", {"label": "Docs app"})
    assert error is False
    assert text.startswith("Section: Docs app  [README.md:L1-")
    assert "Giới thiệu ngắn." in text


def test_legacy_params_map_to_original(servers):
    """Tham số cũ của NexGraph vẫn nhận và cho cùng kết quả với tên mới (khi có graph.json)."""
    _, ours = servers
    pairs = [
        ("query_graph", {"question": "login", "budget": 500}, {"question": "login", "token_budget": 500}),
        ("god_nodes", {"top": 3}, {"top_n": 3}),
        ("get_community", {"community_id": "com:0"}, {"community_id": 0}),
        ("shortest_path", {"source": "LoginScreen", "target": "AuthService", "directed": False},
         {"source": "LoginScreen", "target": "AuthService", "undirected": True}),
    ]
    for tool, old, new in pairs:
        old_error, old_text = ours.call(tool, old)
        new_error, new_text = ours.call(tool, new)
        assert old_error is False and new_error is False
        assert old_text == new_text, (tool, old)


def test_no_graph_json_keeps_nexgraph_behaviour(tmp_path):
    """R-N3: chưa có `.nexgraph/graph.json` → tool vẫn trả JSON của NexGraph như trước."""
    shutil.copytree(FIXTURES / "bookstore_app", tmp_path / "app")
    root = tmp_path / "app"
    conn = open_graph_db(root / ".nexgraph" / "graph.db")
    try:
        store = GraphStore(conn)
        store.init_project(root.name, has_git=False)
        Indexer(store, root, on_progress=lambda _e: None, cancel=threading.Event()).run()
    finally:
        conn.close()
    assert not (root / ".nexgraph" / "graph.json").exists()

    graphify_view.clear_views()
    server = build_server(root, None)

    async def run():
        async with create_connected_server_and_client_session(server._mcp_server) as client:
            return await client.call_tool("graph_stats", {})

    result = anyio.run(run)
    assert result.isError is False
    body = json.loads(result.content[0].text)
    assert body["files"] == 9  # JSON của NexGraph, không phải văn bản vendor

