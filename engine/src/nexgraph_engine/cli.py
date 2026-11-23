from __future__ import annotations

import argparse
import json
import multiprocessing
import os
import socket
import sys
import threading
import time
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import uvicorn

# uvicorn và api.app nạp trong _serve: hook-guard chạy ở mỗi lần gọi tool của agent, không được trả 0,3 s nạp FastAPI.

MIN_TOKEN_LEN = 32


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="nexgraph-engine")
    sub = parser.add_subparsers(dest="command", required=True)
    serve = sub.add_parser("serve", help="Chạy HTTP API nội bộ tại 127.0.0.1")
    serve.add_argument("--data-dir", required=True, type=Path)
    serve.add_argument("--port", type=int, default=0)
    serve.add_argument(
        "--exit-on-stdin-close",
        action="store_true",
        help="Tự thoát khi stdin đóng (tiến trình cha chết), để không để lại engine mồ côi",
    )
    mcp = sub.add_parser("mcp", help="Chạy MCP server chỉ đọc qua stdio cho trợ lý AI")
    mcp.add_argument("--project", required=True, type=Path)
    mcp.add_argument("--data-dir", type=Path, default=None,
                     help="Thư mục dữ liệu của app, cần khi đồ thị không lưu trong <project>/.nexgraph")
    mcp.add_argument("--http", action="store_true",
                     help="Streamable HTTP tại 127.0.0.1 thay vì stdio; cần NEXGRAPH_MCP_KEY (>=32 ký tự)")
    mcp.add_argument("--port", type=int, default=0)
    mcp.add_argument("--global", dest="global_graph", action="store_true",
                     help="Graph chung nhiều repo: thêm list_repositories, query_graph nhận repository (cần --data-dir)")
    refresh = sub.add_parser("refresh", help="Cập nhật tăng dần đồ thị của một dự án đã lập chỉ mục (dùng cho git hook)")
    refresh.add_argument("--project", required=True, type=Path)
    refresh.add_argument("--data-dir", type=Path, default=None)
    refresh.add_argument("--hook", choices=GIT_HOOKS, default=None, help="Tên git hook đang gọi; quyết định luật bỏ qua")
    refresh.add_argument("hook_args", nargs="*", help=argparse.SUPPRESS)
    guard = sub.add_parser("hook-guard", help="Hook PreToolUse/BeforeTool: nhắc trợ lý AI hỏi graph trước khi đọc tệp (luôn thoát 0)")
    guard.add_argument("kind", choices=["read", "search", "gemini"])
    guard.add_argument("--project", required=True, type=Path)
    guard.add_argument("--data-dir", type=Path, default=None)
    guard.add_argument("--strict", action="store_true", help="Chặn lần Read đầu tiên mỗi phiên khi chưa hỏi graph")
    return parser


GIT_HOOKS = ("post-commit", "post-checkout", "post-merge", "post-rewrite")
_SKIPPED = {"status": "skipped", "added": 0, "changed": 0, "removed": 0, "seconds": 0.0}


def _git_out(project: Path, *args: str) -> str | None:
    import subprocess
    try:
        r = subprocess.run(["git", "-C", str(project), *args], capture_output=True, text=True, encoding="utf-8", timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    return r.stdout.strip() if r.returncode == 0 else None


def _git_dir(project: Path) -> Path | None:
    """Thư mục git riêng của worktree (chứa rebase-merge, MERGE_HEAD…); worktree có `.git` là tệp nên phải hỏi git."""
    if (project / ".git").is_dir():
        return project / ".git"
    raw = _git_out(project, "rev-parse", "--git-path", ".")
    return (project / raw).resolve() if raw else None


_GIT_MARKERS = ("rebase-merge", "rebase-apply", "MERGE_HEAD", "CHERRY_PICK_HEAD")


def _git_state(project: Path) -> tuple[set[str], list[str], str | None]:
    """(dấu trạng thái có mặt, tối đa 2 dòng đầu `sequencer/todo`, tiêu đề HEAD).

    Khối hook chụp sẵn các giá trị này đồng bộ trước khi chạy nền (biến NEXGRAPH_GIT_STATE…), vì lúc Python
    khởi động xong thì git đã đi tiếp; chạy tay thì đọc đĩa."""
    env = os.environ
    if "NEXGRAPH_GIT_STATE" in env:
        todo = [s for s in env.get("NEXGRAPH_SEQ_TODO", "").splitlines() if s.strip()][:2]
        return set(env["NEXGRAPH_GIT_STATE"].split()), todo, env.get("NEXGRAPH_HEAD_SUBJECT")
    git_dir = _git_dir(project)
    if git_dir is None:
        return set(), [], None
    try:
        todo = [s for s in (git_dir / "sequencer" / "todo").read_text(encoding="utf-8").splitlines() if s.strip()][:2]
    except OSError:
        todo = []
    subject = _git_out(project, "log", "-1", "--format=%s") if len(todo) > 1 else None
    return {m for m in _GIT_MARKERS if (git_dir / m).exists()}, todo, subject


def _mid_pick_sequence(todo: list[str], head_subject: str | None) -> bool:
    """Cherry-pick/revert một dải: bỏ qua mọi bước trừ bước cuối. `sequencer/` cũ (sau reset --hard) không được tính."""
    if len(todo) < 2:
        return False
    verb, _, rest = todo[0].partition(" ")
    subject = rest.partition(" ")[2]
    expected = {"pick": subject, "revert": f'Revert "{subject}"'}.get(verb)
    return expected is not None and head_subject == expected


def _skip_reason(project: Path, hook: str | None, args: list[str]) -> str | None:
    """Luật bỏ qua giống graphify hooks.py. git còn giữ MERGE_HEAD khi post-merge chạy và rebase-merge/ khi post-rewrite chạy."""
    if os.environ.get("NEXGRAPH_SKIP_HOOK") == "1":
        return "skip_env"
    if hook == "post-checkout" and (len(args) < 3 or args[2] != "1" or args[0] == args[1]):
        return "no_branch_switch"
    if hook == "post-rewrite" and args[:1] != ["rebase"]:
        return "amend"  # amend đã được post-commit cập nhật
    state, todo, head_subject = _git_state(project)
    if hook != "post-rewrite" and state & {"rebase-merge", "rebase-apply"}:
        return "rebase"
    if hook != "post-merge" and "MERGE_HEAD" in state:
        return "merge"
    if hook == "post-commit":  # git còn giữ CHERRY_PICK_HEAD khi post-commit chạy
        return "cherry_pick" if _mid_pick_sequence(todo, head_subject) else None
    if "CHERRY_PICK_HEAD" in state:
        return "cherry_pick"
    return None


def _refresh_logger(data_dir: Path | None, hook: str | None):
    def log(payload: dict) -> None:
        if data_dir is None:
            return
        from datetime import datetime
        try:
            (data_dir / "logs").mkdir(parents=True, exist_ok=True)
            with (data_dir / "logs" / "refresh.log").open("a", encoding="utf-8") as f:
                f.write(f"{datetime.now().isoformat(timespec='seconds')} {hook or 'manual'} {json.dumps(payload, ensure_ascii=False)}\n")
        except OSError:
            pass
    return log


def _refresh_cmd(project: Path, data_dir: Path | None, hook: str | None = None, hook_args: list[str] | None = None) -> int:
    """Bọc `_refresh`: bỏ qua theo trạng thái git, ghi `<data_dir>/logs/refresh.log`, timeout NEXGRAPH_REFRESH_TIMEOUT (600 s)."""
    for key in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX", "GIT_COMMON_DIR"):
        os.environ.pop(key, None)  # hook có thể chạy từ kho/worktree khác với dự án
    log = _refresh_logger(data_dir, hook)
    reason = _skip_reason(project, hook, hook_args or [])
    if reason:
        out = {**_SKIPPED, "reason": reason}
        print(json.dumps(out))
        log(out)
        return 0
    try:
        timeout = float(os.environ.get("NEXGRAPH_REFRESH_TIMEOUT") or 600)
    except ValueError:
        timeout = 600.0

    def bail() -> None:
        log({"status": "timeout", "seconds": timeout})
        os._exit(124)  # SQLite và khoá flock tự phục hồi khi tiến trình chết

    timer = threading.Timer(timeout, bail) if timeout > 0 else None
    if timer:
        timer.daemon = True
        timer.start()
    # Từ hook: khoá ghi bận thì chờ (tối đa nửa timeout) chứ không bỏ qua, nếu không thay đổi của lần checkout/merge này bị mất.
    deadline = time.monotonic() + (timeout / 2 if hook and timeout > 0 else 300 if hook else 0)
    try:
        while True:
            code, out = _refresh(project, data_dir)
            if out.get("reason") != "index_running" or time.monotonic() >= deadline:
                break
            time.sleep(1)
    except Exception as exc:
        log({"status": "error", "error": repr(exc)})
        raise
    finally:
        if timer:
            timer.cancel()
    if code == 0:
        print(json.dumps(out))
    log(out)
    return code


def _refresh(project: Path, data_dir: Path | None) -> tuple[int, dict]:
    """(0, kết quả) kể cả khi bỏ qua (không bao giờ làm lệnh git thất bại); (3, …) khi dự án chưa lập chỉ mục."""
    import sqlite3

    from nexgraph_engine.index.refresh import refresh_project
    from nexgraph_engine.store.projects import ProjectNotIndexed, resolve_graph_db
    from nexgraph_engine.sources import sources_root
    from nexgraph_engine.store.graph_store import GraphStore
    from nexgraph_engine.store.publication import GraphWriteBusy, publish_stage, stage_graph

    skipped = {**_SKIPPED, "reason": "index_running"}
    try:
        db = resolve_graph_db(project, data_dir)
    except ProjectNotIndexed as exc:
        print(str(exc), file=sys.stderr)
        return 3, {"status": "not_indexed"}
    try:
        # Ghi vào bản staging rồi mới thay thế CSDL thật (REV-10): kill giữa chừng giữ nguyên đồ thị cũ.
        with stage_graph(db) as (live_path, stage):
            store = GraphStore(stage)
            if not store.has_published_graph():
                print(f"Dự án chưa được lập chỉ mục trong NexGraph: {project}", file=sys.stderr)
                return 3, {"status": "not_indexed"}
            # Lần refresh trước bị kill không còn dấu trên CSDL thật (bản staging bị bỏ), nhưng giữ lời gọi cho
            # trường hợp bản staging cũ do tiến trình khác để lại trước khi có cơ chế này.
            store.abort_stale_runs()
            pid = store.project_id()
            r = refresh_project(store, project.resolve(), sources_dir=sources_root(data_dir, pid), keep_sources=data_dir is None,
                                transcript_dir=data_dir / "transcripts" / pid if data_dir and pid else None)
            publish_stage(stage, live_path)
    except (GraphWriteBusy, sqlite3.OperationalError):
        return 0, skipped
    out = {"status": "ok", "added": r.added, "changed": r.changed, "removed": r.removed,
           "unchanged": r.unchanged, "seconds": round(r.seconds, 3)}
    return 0, out


def _exit_when_stdin_closes(server: uvicorn.Server) -> None:
    """Chặn đến khi stdin gặp EOF (tiến trình cha thoát hoặc bị kill), rồi tắt server."""
    try:
        sys.stdin.buffer.read()
    finally:
        server.should_exit = True


def _serve(data_dir: Path, port: int, exit_on_stdin_close: bool) -> int:
    import uvicorn

    from nexgraph_engine.api.app import create_app

    token = os.environ.get("NEXGRAPH_TOKEN", "")
    if len(token) < MIN_TOKEN_LEN:
        print("NEXGRAPH_TOKEN is required (>=32 chars)", file=sys.stderr)
        return 2
    data_dir.mkdir(parents=True, exist_ok=True)

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", port))
    sock.listen(128)  # nhận kết nối vào hàng đợi ngay cả trước khi uvicorn accept
    real_port = sock.getsockname()[1]
    app = create_app(token, {f"127.0.0.1:{real_port}", f"localhost:{real_port}"}, data_dir=data_dir)

    print(json.dumps({"event": "ready", "port": real_port, "pid": os.getpid()}), flush=True)
    server = uvicorn.Server(uvicorn.Config(app, log_level="warning"))
    if exit_on_stdin_close:
        threading.Thread(target=_exit_when_stdin_closes, args=(server,), daemon=True).start()
    server.run(sockets=[sock])
    return 0


def main(argv: list[str] | None = None) -> int:
    multiprocessing.freeze_support()
    argv = sys.argv[1:] if argv is None else argv
    try:
        args = _build_parser().parse_args(argv)
    except SystemExit:
        # Hook thoát 2 thì Claude Code chặn lần gọi tool: tham số sai của hook-guard vẫn phải thoát 0.
        if argv[:1] == ["hook-guard"]:
            return 0
        raise
    if args.command == "serve":
        return _serve(args.data_dir, args.port, args.exit_on_stdin_close)
    if args.command == "refresh":
        return _refresh_cmd(args.project, args.data_dir, args.hook, args.hook_args)
    if args.command == "mcp":
        from nexgraph_engine.mcp.server import ProjectNotIndexed, run_http, run_stdio
        if args.http:
            key = os.environ.get("NEXGRAPH_MCP_KEY", "")
            if len(key) < MIN_TOKEN_LEN:
                print("NEXGRAPH_MCP_KEY is required (>=32 chars)", file=sys.stderr)
                return 2
        try:
            if args.http:
                return run_http(args.project, args.data_dir, args.port, key, args.global_graph)
            return run_stdio(args.project, args.data_dir, args.global_graph)
        except ProjectNotIndexed as exc:
            print(str(exc), file=sys.stderr)  # stdout dành riêng cho giao thức MCP
            return 3
    if args.command == "hook-guard":
        from nexgraph_engine.hook_guard import guard_output
        try:
            raw = b"" if args.kind == "gemini" else sys.stdin.buffer.read()
            sys.stdout.buffer.write(guard_output(args.kind, args.project, args.data_dir, args.strict, raw).encode("utf-8"))
        except Exception:
            pass  # fail-open: không bao giờ chặn lần gọi tool vì lỗi của hook
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
