import json
import os
import subprocess
import sys
import time

import anyio
import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from nexgraph_engine.interfaces.hook_guard import guard_output, stamp_path, touch_query_stamp
from nexgraph_engine.interfaces.mcp.server import build_server


@pytest.fixture
def proj(api, copy_fixture, tmp_path):
    root = copy_fixture("py_mini")
    pid = api.open(root)["project_id"]
    assert api.index(pid)["state"] == "done"
    return root, tmp_path / "appdata", pid


def _in(tool: str, **tool_input) -> bytes:
    return json.dumps({"session_id": "s1", "tool_name": tool, "tool_input": tool_input}).encode()


def _ctx(out: str) -> str:
    return json.loads(out)["hookSpecificOutput"].get("additionalContext", "")


def test_fresh_stamp_is_silent(proj):
    root, data, pid = proj
    touch_query_stamp(data, pid)
    assert guard_output("read", root, data, False, _in("Read", file_path=str(root / "util.py"))) == ""


def test_missing_or_old_stamp_nudges(proj):
    root, data, pid = proj
    out = guard_output("read", root, data, False, _in("Read", file_path=str(root / "util.py")))
    assert "query_graph" in _ctx(out)
    touch_query_stamp(data, pid)
    old = time.time() - 31 * 60
    os.utime(stamp_path(data, pid), (old, old))
    assert "query_graph" in _ctx(guard_output("search", root, data, False, _in("Grep", pattern="helper")))


def test_strict_denies_read_once_per_session(proj):
    root, data, _ = proj
    raw = _in("Read", file_path=str(root / "util.py"))
    first = json.loads(guard_output("read", root, data, True, raw))["hookSpecificOutput"]
    assert first["permissionDecision"] == "deny"
    second = json.loads(guard_output("read", root, data, True, raw))["hookSpecificOutput"]
    assert "permissionDecision" not in second and "query_graph" in second["additionalContext"]


def test_strict_never_denies_glob_or_search(proj):
    root, data, _ = proj
    for kind, raw in (("read", _in("Glob", pattern="*.py")), ("search", _in("Grep", pattern="x"))):
        assert "permissionDecision" not in guard_output(kind, root, data, True, raw)


def test_bash_only_nudges_real_searches(proj):
    root, data, _ = proj
    assert guard_output("search", root, data, False, _in("Bash", command='git commit -m "grep it"')) == ""
    assert _ctx(guard_output("search", root, data, False, _in("Bash", command="rg helper")))


def test_stale_graph_is_silent(proj):
    root, data, _ = proj
    target = root / "util.py"
    future = time.time() + 120
    os.utime(target, (future, future))
    assert guard_output("read", root, data, True, _in("Read", file_path=str(target))) == ""


def test_outside_project_read_is_silent(proj, tmp_path):
    root, data, _ = proj
    other = tmp_path / "elsewhere.py"
    other.write_text("x = 1\n")
    assert guard_output("read", root, data, False, _in("Read", file_path=str(other))) == ""


def test_no_data_dir_or_unindexed_is_silent(proj, tmp_path):
    root, data, _ = proj
    raw = _in("Read", file_path=str(root / "util.py"))
    assert guard_output("read", root, None, False, raw) == ""
    assert guard_output("read", tmp_path, data, False, raw) == ""


def test_gemini_always_allows(proj, tmp_path):
    root, data, _ = proj
    assert json.loads(guard_output("gemini", root, data, False, b""))["decision"] == "allow"
    assert json.loads(guard_output("gemini", tmp_path, data, False, b"")) == {"decision": "allow"}


@pytest.mark.parametrize("stdin", [b"{not json", b"[1,2]", b"\xff\xfe"])
def test_broken_stdin_exits_zero(proj, stdin):
    root, data, _ = proj
    r = subprocess.run([sys.executable, "-m", "nexgraph_engine.cli", "hook-guard", "read", "--strict",
                        "--project", str(root), "--data-dir", str(data)], input=stdin, capture_output=True)
    assert r.returncode == 0 and r.stdout == b""


def test_cli_prints_nudge(proj):
    root, data, _ = proj
    r = subprocess.run([sys.executable, "-m", "nexgraph_engine.cli", "hook-guard", "search",
                        "--project", str(root), "--data-dir", str(data)], input=_in("Grep", pattern="x"),
                       capture_output=True)
    assert r.returncode == 0 and "query_graph" in _ctx(r.stdout.decode())


def test_mcp_query_writes_stamp(proj):
    root, data, pid = proj
    server = build_server(root, data)

    async def run():
        async with create_connected_server_and_client_session(server._mcp_server) as client:
            return await client.call_tool("query_graph", {"question": "helper"})
    assert anyio.run(run).isError is False
    assert stamp_path(data, pid).is_file()


def test_touch_without_data_dir_is_noop(tmp_path):
    touch_query_stamp(None, "abc")
    touch_query_stamp(tmp_path, "../escape")
    assert not (tmp_path.parent / "escape").exists() and list(tmp_path.iterdir()) == []


def test_bad_arguments_still_exit_zero():
    r = subprocess.run([sys.executable, "-m", "nexgraph_engine.cli", "hook-guard", "nope"], capture_output=True)
    assert r.returncode == 0 and r.stdout == b""


def test_hook_guard_skips_heavy_imports(proj):
    root, data, _ = proj
    code = ("import sys, io; from nexgraph_engine.interfaces.cli import main; sys.stdin = io.TextIOWrapper(io.BytesIO(b'{}'));"
            f"main(['hook-guard', 'read', '--project', {str(root)!r}, '--data-dir', {str(data)!r}]);"
            "print(sorted(m for m in ('uvicorn', 'fastapi', 'mcp.server.fastmcp', 'nexgraph_engine.interfaces.api.app') if m in sys.modules), file=sys.stderr)")
    # Lời nhắc tiếng Việt: ép UTF-8 cả hai đầu, Windows mặc định cp1252.
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, encoding="utf-8",
                       env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    assert r.returncode == 0 and r.stderr.strip().endswith("[]"), r.stderr


def test_nexgraph_dir_and_outside_paths_are_silent(proj, tmp_path):
    root, data, _ = proj
    (root / ".nexgraph").mkdir(exist_ok=True)
    (root / ".nexgraph" / "notes.md").write_text("x\n")
    assert guard_output("read", root, data, True, _in("Read", file_path=str(root / ".nexgraph" / "notes.md"))) == ""
    assert guard_output("search", root, data, False, _in("Grep", pattern="x", path=str(tmp_path))) == ""
    assert guard_output("read", root, data, False, _in("Glob", pattern="*.py", path=str(tmp_path))) == ""
    assert guard_output("search", root, data, False, _in("Grep", pattern="x", path="."))  # trong dự án vẫn nhắc



def test_silent_after_head_moves(api, copy_fixture, tmp_path):
    import shutil
    if shutil.which("git") is None:
        pytest.skip("cần git")
    root = copy_fixture("py_mini")
    git = ["git", "-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false"]
    subprocess.run([*git, "init", "-q"], cwd=root, check=True)
    subprocess.run([*git, "add", "."], cwd=root, check=True)
    subprocess.run([*git, "commit", "-q", "-m", "a"], cwd=root, check=True)
    assert api.index(api.open(root)["project_id"])["state"] == "done"
    data, raw = tmp_path / "appdata", _in("Grep", pattern="x")
    assert _ctx(guard_output("search", root, data, False, raw))
    subprocess.run([*git, "commit", "-q", "--allow-empty", "-m", "b"], cwd=root, check=True)
    assert guard_output("search", root, data, False, raw) == ""
