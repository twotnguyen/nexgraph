"""Chốt "tra đồ thị trước" của tool tệp MCP (`--file-guard`), tương đương `graphify hook-guard [--strict]`.

Nex chạy `nexgraph-engine mcp --file-guard strict`: lần đầu đọc/tìm tệp thô khi phiên chưa tra đồ thị và đồ
thị còn mới thì bị từ chối đúng một lần, kèm lời nhắc. Agent ngoài mặc định `off`, không đổi hành vi.
"""
import os
import time

import pytest

from nexgraph_engine.interfaces.cli import _build_parser as build_parser
from nexgraph_engine.interfaces.mcp.server import FILE_GUARD_DENY, FILE_GUARD_NUDGE, build_server
from support import call, payload


@pytest.fixture
def indexed(api, copy_fixture, tmp_path):
    root = copy_fixture("py_mini")
    pid = api.open(root)["project_id"]
    assert api.index(pid)["state"] == "done"
    return root, tmp_path / "appdata"


def _a_python_file(root):
    return next(p.relative_to(root).as_posix() for p in sorted(root.rglob("*.py")))


def test_off_by_default_for_external_agents(indexed):
    server = build_server(*indexed)
    body = payload(call(server, "grep", {"pattern": "def"}))
    assert body["matches"] and "hint" not in body


def test_nudge_adds_hint_until_the_graph_is_consulted(indexed):
    server = build_server(*indexed, file_guard="nudge")
    assert payload(call(server, "glob", {"pattern": "*.py"}))["hint"] == FILE_GUARD_NUDGE
    payload(call(server, "search", {"query": "helper"}))
    assert "hint" not in payload(call(server, "glob", {"pattern": "*.py"}))


def test_strict_refuses_the_first_raw_read_only_once(indexed):
    root, _ = indexed
    server = build_server(*indexed, file_guard="strict")
    first = call(server, "read_file", {"path": _a_python_file(root)})
    assert first.isError and first.content[0].text.endswith(FILE_GUARD_DENY)
    second = payload(call(server, "read_file", {"path": _a_python_file(root)}))
    assert second["text"] and second["hint"] == FILE_GUARD_NUDGE
    assert not call(server, "grep", {"pattern": "def"}).isError


def test_strict_lets_files_through_after_a_graph_tool(indexed):
    server = build_server(*indexed, file_guard="strict")
    payload(call(server, "search", {"query": "helper"}))
    body = payload(call(server, "grep", {"pattern": "def"}))
    assert body["matches"] and "hint" not in body


def test_strict_never_blocks_listing_a_directory(indexed):
    server = build_server(*indexed, file_guard="strict")
    for path in (".", ""):
        body = payload(call(server, "read_file", {"path": path}))
        assert body["kind"] == "directory" and "hint" not in body


def test_strict_steps_aside_when_the_file_changed_after_indexing(indexed):
    """Đồ thị cũ với tệp đích thì không có gì để chỉ: đọc thẳng, như hook-guard."""
    root, _ = indexed
    name = _a_python_file(root)
    later = time.time() + 60
    os.utime(root / name, (later, later))
    server = build_server(*indexed, file_guard="strict")
    body = payload(call(server, "read_file", {"path": name}))
    assert body["text"] and "hint" not in body


def test_grep_is_guarded_too(indexed):
    server = build_server(*indexed, file_guard="strict")
    result = call(server, "grep", {"pattern": "def"})
    assert result.isError and FILE_GUARD_DENY in result.content[0].text


def test_cli_accepts_file_guard_modes():
    args = build_parser().parse_args(["mcp", "--project", ".", "--file-guard", "strict"])
    assert args.file_guard == "strict"
    assert build_parser().parse_args(["mcp", "--project", "."]).file_guard == "off"
    with pytest.raises(SystemExit):
        build_parser().parse_args(["mcp", "--project", ".", "--file-guard", "always"])
    with pytest.raises(ValueError):
        build_server(__import__("pathlib").Path("."), None, file_guard="always")
