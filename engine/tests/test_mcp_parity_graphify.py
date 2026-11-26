"""NG-PAR-2/NG-PAR-3: 11 tool MCP NexGraph phải ra **đúng văn bản** của bản gốc.

ADR 0025 mục 2 — nghiệm thu: chạy `python -m graphify.serve <graph.json>` qua MCP stdio
(như `research/cmp11-cmp.py`) và tool NexGraph trên CÙNG một `graph.json`, so từng tool với
≥ 2 bộ tham số. Kỳ vọng tính **độc lập** với mã sản phẩm: phần dữ liệu (nhãn, id, đường dẫn,
`NODE …`/`Source: …`) phải trùng byte với vendor; chỉ các cụm mẫu đã chốt được đổi, ghi tay
trong ``_TEMPLATE_EXPECTED`` dưới đây.

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

from nexgraph_engine.pipeline.legacy_indexer import Indexer
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

# Kỳ vọng viết TAY cho các cụm mẫu do vendor sinh ra (không gọi hàm sản phẩm để tính).
# Chỉ câu hướng dẫn của vendor đổi tên lệnh; mọi dữ liệu khác phải giữ nguyên byte.
_TEMPLATE_EXPECTED = (
    ("Run `graphify update .` to refresh the graph.",
     "Run `nexgraph update .` to refresh the graph."),
    ("run `graphify update .` to refresh the graph.",
     "run `nexgraph update .` to refresh the graph."),
)


def expected_from_vendor(text: str) -> str:
    """Đầu ra NexGraph kỳ vọng: chỉ thay các cụm mẫu đã chốt, phần còn lại giữ nguyên byte."""
    for old, new in _TEMPLATE_EXPECTED:
        text = text.replace(old, new)
    # Dòng đầu `Graph: …` in đường dẫn tệp đồ thị mà **mỗi server** mở: vendor đọc bản trong
    # `graphify-out/`, Nex đọc bản sao ở `.nexgraph/` (thiết lập fixture). Chuẩn hoá đúng dòng
    # này, không đụng bất kỳ dữ liệu nào khác.
    if text.startswith("Graph: graphify-out/graph.json"):
        text = "Graph: .nexgraph/graph.json" + text[len("Graph: graphify-out/graph.json"):]
    return text


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
        assert our_text == expected_from_vendor(orig_text), (tool, sent)


def test_query_graph_header_rebranded(servers):
    original, ours = servers
    _, orig_text = original.call("query_graph", {"question": "login auth"})
    _, our_text = ours.call("query_graph", {"question": "login auth"})
    assert "graphify" not in our_text.lower()
    assert our_text.startswith("Graph: .nexgraph/graph.json")
    assert our_text == expected_from_vendor(orig_text)


def test_get_section_reads_markdown(servers):
    _, ours = servers
    error, text = ours.call("get_section", {"label": "Docs app"})
    assert error is False
    assert text.startswith("Section: Docs app  [README.md:L1-")
    assert "Giới thiệu ngắn." in text


# ── Finding 1 (QA #69): rebrand không được đổi dữ liệu người dùng ────────────

USER_DATA_README = """# Docs

Giới thiệu.

## Cài đặt

Chạy `helper()` trước.

## Cách dùng

Văn bản.
"""

USER_DATA_GRAPH = {
    "directed": False,
    "multigraph": False,
    "graph": {},
    "nodes": [
        {"id": "graphify_qa", "label": "graphify_qa", "file_type": "code",
         "source_file": "engine/src/graphify/serve.py", "source_location": "L2", "community": 0},
        {"id": "app_main_py", "label": "main", "file_type": "code",
         "source_file": "app/main.py", "source_location": "L1", "community": 0},
        {"id": "caller", "label": "caller", "file_type": "code",
         "source_file": "app/main.py", "source_location": "L3", "community": 0},
        {"id": "readme_heading", "label": "Cài đặt", "file_type": "document",
         "node_kind": "heading", "source_file": "README.md", "source_location": "L1", "community": 1},
    ],
    "links": [
        {"source": "caller", "target": "graphify_qa", "relation": "calls", "confidence": "EXTRACTED",
         "source_file": "app/main.py", "source_location": "L3", "weight": 1.0},
        {"source": "caller", "target": "app_main_py", "relation": "references", "confidence": "EXTRACTED",
         "source_file": "app/main.py", "source_location": "L3", "weight": 1.0},
    ],
}


@pytest.fixture
def user_data_project(tmp_path):
    """Dự án nhỏ có id/nhãn/đường dẫn mang chữ "graphify" (dữ liệu người dùng) + heading bị dời dòng."""
    root = tmp_path / "Đồ án user data"
    (root / "engine" / "src" / "graphify").mkdir(parents=True)
    (root / "app").mkdir()
    (root / "engine" / "src" / "graphify" / "serve.py").write_text(
        "def serve():\n    return 1\n", encoding="utf-8")
    (root / "app" / "main.py").write_text("def caller():\n    return serve()\n", encoding="utf-8")
    (root / "README.md").write_text(USER_DATA_README, encoding="utf-8")
    (root / ".nexgraph").mkdir()
    (root / ".nexgraph" / "graph.json").write_text(
        json.dumps(USER_DATA_GRAPH, ensure_ascii=False), encoding="utf-8")
    conn = open_graph_db(root / ".nexgraph" / "graph.db")
    try:
        store = GraphStore(conn)
        store.init_project(root.name, has_git=False)
        Indexer(store, root, on_progress=lambda _e: None, cancel=threading.Event()).run()
    finally:
        conn.close()
    graphify_view.clear_views()
    yield root
    graphify_view.clear_views()


def _server_call(root: Path, tool: str, arguments: dict) -> tuple[bool, str]:
    server = build_server(root, None)

    async def run():
        async with create_connected_server_and_client_session(server._mcp_server) as client:
            return await client.call_tool(tool, arguments)

    result = anyio.run(run)
    return bool(result.isError), "\n".join(item.text for item in result.content)


def test_rebrand_keeps_user_data(user_data_project):
    """Finding 1: id `graphify_qa` và đường dẫn `engine/src/graphify/serve.py` phải giữ nguyên."""
    root = user_data_project
    for tool, arguments in [
        ("get_node", {"label": "graphify_qa"}),
        ("get_neighbors", {"label": "caller"}),
        ("query_graph", {"question": "graphify_qa"}),
        ("get_community", {"community_id": 0}),
    ]:
        error, text = _server_call(root, tool, arguments)
        assert error is False, (tool, text)
        assert "graphify_qa" in text, (tool, text)
        if tool != "get_neighbors":  # get_neighbors chỉ in nhãn + tệp của cạnh
            assert "engine/src/graphify/serve.py" in text, (tool, text)
        for wrong in ("nexgraph_qa", "engine/src/nexgraph/serve.py"):
            assert wrong not in text, (tool, text)


def test_template_phrase_rebranded(user_data_project):
    """Finding 1c: câu hướng dẫn mẫu của vendor đổi tên lệnh; kỳ vọng viết tay, không dùng hàm sản phẩm."""
    error, text = _server_call(user_data_project, "get_section", {"label": "Cài đặt"})
    assert error is False
    expected = (
        "Section: Cài đặt  [README.md:L5-L7]\n"
        "Note: The heading moved since indexing; run `nexgraph update .` to refresh the graph.\n"
        "\n"
        "## Cài đặt\n"
        "\n"
        "Chạy `helper()` trước."
    )
    assert text == expected
    assert "graphify update" not in text


# ── Finding 3 (QA #69): nhánh vendor áp cùng chính sách nguồn như SQLite ────

POLICY_GRAPH = {
    "directed": False,
    "multigraph": False,
    "graph": {},
    "nodes": [
        {"id": "hasher", "label": "hasher", "file_type": "code",
         "source_file": "lib/main.py", "source_location": "L1", "community": 0},
        {"id": "safe_node", "label": "safe_node", "file_type": "code",
         "source_file": "lib/main.py", "source_location": "L4", "community": 0},
        {"id": "secret_pem", "label": "secret_pem", "file_type": "code",
         "source_file": "secrets/keys.pem", "source_location": "L1", "community": 0},
        {"id": "private_node", "label": "private_node", "file_type": "code",
         "source_file": "private/secret.py", "source_location": "L1", "community": 0},
        {"id": "outside_node", "label": "outside_node", "file_type": "code",
         "source_file": "../outside.py", "source_location": "L1", "community": 0},
    ],
    "links": [
        {"source": "hasher", "target": "safe_node", "relation": "calls", "confidence": "EXTRACTED",
         "source_file": "lib/main.py", "source_location": "L5", "weight": 1.0},
        {"source": "hasher", "target": "secret_pem", "relation": "calls", "confidence": "EXTRACTED",
         "source_file": "lib/main.py", "source_location": "L6", "weight": 1.0},
        {"source": "hasher", "target": "private_node", "relation": "calls", "confidence": "EXTRACTED",
         "source_file": "lib/main.py", "source_location": "L7", "weight": 1.0},
        {"source": "hasher", "target": "outside_node", "relation": "calls", "confidence": "EXTRACTED",
         "source_file": "lib/main.py", "source_location": "L8", "weight": 1.0},
    ],
}
POLICY_LEAKS = ("secret_pem", "private_node", "outside_node",
                "secrets/keys.pem", "private/secret.py", "../outside.py")


@pytest.fixture
def policy_project(tmp_path):
    """Dự án có tệp bị chính sách nguồn loại (đuôi .pem, mẫu exclude, ngoài dự án)."""
    root = tmp_path / "policy"
    (root / "lib").mkdir(parents=True)
    (root / "lib" / "main.py").write_text("def hasher():\n    return 1\n", encoding="utf-8")
    (root / "private").mkdir()
    (root / "private" / "secret.py").write_text("TOKEN = 'x'\n", encoding="utf-8")
    (root / "secrets").mkdir()
    (root / "secrets" / "keys.pem").write_text("-----BEGIN-----\n", encoding="utf-8")
    (root / ".nexgraph").mkdir()
    (root / ".nexgraph" / "graph.json").write_text(
        json.dumps(POLICY_GRAPH, ensure_ascii=False), encoding="utf-8")
    conn = open_graph_db(root / ".nexgraph" / "graph.db")
    try:
        store = GraphStore(conn)
        store.init_project(root.name, has_git=False)
        Indexer(store, root, on_progress=lambda _e: None, cancel=threading.Event(),
                exclude=["private/**"]).run()
    finally:
        conn.close()
    graphify_view.clear_views()
    yield root
    graphify_view.clear_views()


def test_vendor_branch_applies_source_policy(policy_project):
    """Finding 3: tệp bị loại/biên dự án không được xuất hiện trong tool nhánh vendor."""
    root = policy_project
    cases = [
        ("get_neighbors", {"label": "hasher", "token_budget": 4000}),
        ("get_community", {"community_id": 0, "token_budget": 4000}),
        ("god_nodes", {"top_n": 10}),
        ("query_graph", {"question": "secret_pem", "token_budget": 4000}),
    ]
    for tool, arguments in cases:
        error, text = _server_call(root, tool, arguments)
        assert error is False, (tool, text)
        for leaked in POLICY_LEAKS:
            assert leaked not in text, (tool, text)
        assert "safe_node" in text or tool == "query_graph", (tool, text)


def test_vendor_branch_filters_before_lookup(policy_project):
    """Nút bị loại không tra được như bản gốc, dù đồ thị có nút đó."""
    error, text = _server_call(policy_project, "get_node", {"label": "secret_pem"})
    assert error is False
    assert text.startswith("No node matching")
    error, text = _server_call(policy_project, "get_node", {"label": "safe_node"})
    assert error is False and text.startswith("Node: safe_node")


# ── Finding 4 (review vòng 2): `project_path` và graph.json không được ra ngoài dự án ──

OTHER_README = "# B\n\n## Riêng B\n\nNOI-DUNG-RIENG-B\n"
OTHER_GRAPH = {
    "directed": False, "multigraph": False, "graph": {},
    "nodes": [
        {"id": "b_private", "label": "b_private", "file_type": "code",
         "source_file": "b.py", "source_location": "L1", "community": 0},
        {"id": "b_readme_rieng_b", "label": "Riêng B", "file_type": "document",
         "source_file": "README.md", "source_location": "L3", "community": 0},
    ],
    "links": [],
}
#: Chỉ dữ liệu của dự án B mới sinh ra các chuỗi này (thông báo lỗi có thể nhắc lại nhãn truy vấn).
OTHER_LEAKS = ("NOI-DUNG-RIENG-B", "Source: b.py", "ID: b_private")


def _other_project(base: Path) -> Path:
    other = base / "B-du-an-khac"
    (other / ".nexgraph").mkdir(parents=True)
    (other / "b.py").write_text("def b_private():\n    return 1\n", encoding="utf-8")
    (other / "README.md").write_text(OTHER_README, encoding="utf-8")
    (other / ".nexgraph" / "graph.json").write_text(json.dumps(OTHER_GRAPH, ensure_ascii=False), encoding="utf-8")
    return other


def test_project_path_outside_project_is_refused(policy_project):
    """AI chỉ được đồng ý cho dự án đang mở: `project_path` trỏ sang dự án khác bị từ chối, không đọc dữ liệu."""
    other = _other_project(policy_project.parent)
    paths = [str(other), "../B-du-an-khac"]
    try:
        paths.append(os.path.relpath(other, Path.cwd()))
    except ValueError:  # Windows: thư mục tạm và cwd khác ổ đĩa
        pass
    for project_path in paths:
        for tool, arguments in [("get_node", {"label": "b_private"}),
                                ("get_section", {"label": "Riêng B"}),
                                ("graph_stats", {})]:
            error, text = _server_call(policy_project, tool, {**arguments, "project_path": project_path})
            assert error is True, (tool, project_path, text)
            for leaked in OTHER_LEAKS:
                assert leaked not in text, (tool, project_path, text)


def test_project_path_of_current_project_still_works(policy_project):
    error, text = _server_call(policy_project, "get_node", {"label": "safe_node", "project_path": str(policy_project)})
    assert error is False and text.startswith("Node: safe_node"), text


@pytest.mark.skipif(os.name == "nt", reason="tạo symlink trên Windows cần quyền Developer Mode")
def test_symlinked_graph_json_outside_project_is_ignored(policy_project):
    """`.nexgraph/graph.json` là symlink ra dự án khác (repo mang sẵn): không nạp đồ thị đó."""
    other = _other_project(policy_project.parent)
    link = policy_project / ".nexgraph" / "graph.json"
    link.unlink()
    link.symlink_to(other / ".nexgraph" / "graph.json")
    graphify_view.clear_views()
    for tool, arguments in [("get_node", {"label": "b_private"}), ("get_section", {"label": "Riêng B"})]:
        _error, text = _server_call(policy_project, tool, arguments)
        for leaked in OTHER_LEAKS:
            assert leaked not in text, (tool, text)


# ── Finding 2 (QA #69): mặc định tham số theo từng nhánh ────────────────────

@pytest.fixture(scope="module")
def sqlite_project(tmp_path_factory):
    """Dự án chỉ có graph.db (không có graph.json) → nhánh SQLite của 11 tool."""
    root = tmp_path_factory.mktemp("sqlite") / "bookstore"
    shutil.copytree(FIXTURES / "bookstore_app", root)
    conn = open_graph_db(root / ".nexgraph" / "graph.db")
    try:
        store = GraphStore(conn)
        store.init_project(root.name, has_git=False)
        Indexer(store, root, on_progress=lambda _e: None, cancel=threading.Event()).run()
    finally:
        conn.close()
    assert not (root / ".nexgraph" / "graph.json").exists()
    graphify_view.clear_views()
    return root


def test_sqlite_query_graph_defaults(sqlite_project, monkeypatch):
    """Không có graph.json: mặc định phải như trước PR — depth 2, budget 2000."""
    import nexgraph_engine.mcp.server as server_module

    seen: list[tuple[int, int, str]] = []
    real = server_module.ask_graph

    def spy(store, question, depth, budget, mode):
        seen.append((depth, budget, mode))
        return real(store, question, depth, budget, mode)

    monkeypatch.setattr(server_module, "ask_graph", spy)
    error, text = _server_call(sqlite_project, "query_graph", {"question": "login auth"})
    assert error is False, text
    assert seen == [(2, 2000, "bfs")]


def test_sqlite_shortest_path_default_max_hops(sqlite_project, monkeypatch):
    """Không có graph.json: mặc định max_hops 4 (bản cũ), không phải 8 của vendor."""
    import nexgraph_engine.mcp.server as server_module

    seen: list[tuple[int, bool]] = []
    real = server_module.find_paths

    def spy(store, node_ids, max_hops, directed):
        seen.append((max_hops, directed))
        return real(store, node_ids, max_hops, directed)

    monkeypatch.setattr(server_module, "find_paths", spy)
    error, text = _server_call(sqlite_project, "shortest_path", {
        "source": "lib/services/auth_service.dart#file",
        "target": "lib/screens/login_screen.dart#file",
    })
    assert error is False, text
    assert seen == [(4, True)]


def test_vendor_query_graph_defaults(parity, monkeypatch):
    """Có graph.json: mặc định theo bản gốc — depth 3, token_budget 2000."""
    import graphify.serve as vendor_serve

    root, _ = parity
    seen: dict = {}
    real = vendor_serve._query_graph_text

    def spy(G, question, **kwargs):
        seen.update(kwargs)
        return real(G, question, **kwargs)

    monkeypatch.setattr(vendor_serve, "_query_graph_text", spy)
    error, text = _server_call(root, "query_graph", {"question": "login auth"})
    assert error is False, text
    assert seen["depth"] == 3 and seen["token_budget"] == 2000


def test_vendor_shortest_path_default_max_hops(parity, monkeypatch):
    """Có graph.json: mặc định max_hops 8 như bản gốc."""
    import graphify.serve as vendor_serve

    root, _ = parity
    seen: dict = {}
    real = vendor_serve._shortest_path_text

    def spy(G, arguments):
        seen.update(arguments)
        return real(G, arguments)

    monkeypatch.setattr(vendor_serve, "_shortest_path_text", spy)
    error, text = _server_call(root, "shortest_path", {"source": "LoginScreen", "target": "AuthService"})
    assert error is False, text
    assert seen["max_hops"] == 8 and seen["undirected"] is False


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


# ── NG-PAR-3: 3 tool PR với `gh` giả ────────────────────────────────────────

PR_LIST = [
    {"number": 1, "title": "Sai nhánh gốc", "state": "OPEN", "headRefName": "nhanh-1",
     "baseRefName": "develop", "author": {"login": "an"}, "isDraft": False, "reviewDecision": "",
     "statusCheckRollup": [], "updatedAt": "2026-11-20T10:00:00Z"},
    {"number": 2, "title": "CI hỏng", "state": "OPEN", "headRefName": "nhanh-2",
     "baseRefName": "main", "author": {"login": "binh"}, "isDraft": False, "reviewDecision": "",
     "statusCheckRollup": [{"status": "COMPLETED", "conclusion": "FAILURE"}],
     "updatedAt": "2026-11-21T10:00:00Z"},
    {"number": 3, "title": "Bản nháp", "state": "OPEN", "headRefName": "nhanh-3",
     "baseRefName": "main", "author": {"login": "chi"}, "isDraft": True, "reviewDecision": "",
     "statusCheckRollup": [], "updatedAt": "2026-11-22T10:00:00Z"},
    {"number": 4, "title": "Sẵn sàng", "state": "OPEN", "headRefName": "nhanh-4",
     "baseRefName": "main", "author": {"login": "dung"}, "isDraft": False,
     "reviewDecision": "APPROVED", "statusCheckRollup": [{"status": "COMPLETED", "conclusion": "SUCCESS"}],
     "updatedAt": "2026-11-23T10:00:00Z"},
]

PR_FILES = {
    2: ["lib/services/auth_service.dart"],
    3: ["lib/screens/login_screen.dart", "README.md"],
    4: ["lib/widgets/primary_button.dart", "lib/router.dart"],
}

PR_VIEW = {
    2: {**PR_LIST[1], "statusCheckRollup": [{"status": "COMPLETED", "conclusion": "FAILURE"}]},
    4: {**PR_LIST[3]},
}


@pytest.fixture
def fake_gh(monkeypatch):
    """Gh giả: chỉ vá các hàm `graphify.prs` mà 3 tool PR gọi (không ra mạng)."""
    import graphify.prs as prs

    def _gh(*args: str):
        if args[:2] == ("repo", "view"):
            return {"defaultBranchRef": {"name": "main"}}
        if args[:2] == ("pr", "list"):
            return PR_LIST
        if args[:2] == ("pr", "view") and len(args) >= 3:
            return PR_VIEW.get(int(args[2]))
        return None

    monkeypatch.setattr(prs, "_gh", _gh)
    monkeypatch.setattr(prs, "fetch_worktrees", lambda: {"nhanh-2": "/tmp/wt-nhanh-2"})
    monkeypatch.setattr(prs, "fetch_pr_files", lambda number, repo=None: PR_FILES.get(number, []))
    return prs


def _call_low_level(server, tool: str, arguments: dict) -> tuple[bool, str]:
    async def run():
        async with create_connected_server_and_client_session(server) as client:
            return await client.call_tool(tool, arguments)
    result = anyio.run(run)
    text = "\n".join(getattr(item, "text", "") for item in result.content)
    return bool(result.isError), text


@pytest.fixture
def pr_servers(parity, fake_gh, monkeypatch):
    from graphify import serve as vendor_serve

    root, graph_json = parity
    monkeypatch.chdir(root)
    graphify_view.clear_views()
    vendor_server = vendor_serve._build_server(str(graph_json))
    ours = build_server(root, None)
    return vendor_server, ours._mcp_server


@pytest.mark.parametrize("tool,arguments", [
    ("list_prs", {}),
    ("list_prs", {"base": "develop"}),
    ("get_pr_impact", {"pr_number": 4}),
    ("get_pr_impact", {"pr_number": 2}),
    ("triage_prs", {}),
    ("triage_prs", {"base": "main"}),
])
def test_pr_tools_match_original(pr_servers, tool, arguments):
    vendor_server, our_server = pr_servers
    vendor_error, vendor_text = _call_low_level(vendor_server, tool, arguments)
    our_error, our_text = _call_low_level(our_server, tool, arguments)
    assert vendor_error is False, (tool, vendor_text)
    assert our_error is False, (tool, our_text)
    assert our_text == graphify_view.rebrand_text(vendor_text), (tool, arguments)


def test_pr_tool_reports_gh_failure(pr_servers, monkeypatch):
    """`gh` hỏng → lỗi tool đọc được, không phải văn bản rỗng (như bản gốc ném ToolError)."""
    import graphify.prs as prs

    def boom(*args, **kwargs):
        raise RuntimeError("gh CLI not found or not authenticated. Run: gh auth login")

    monkeypatch.setattr(prs, "fetch_prs", boom)
    _, our_server = pr_servers
    error, text = _call_low_level(our_server, "list_prs", {})
    assert error is True
    assert "gh CLI not found" in text
