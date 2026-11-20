import argparse
import json
import multiprocessing
import os
import socket
import sys
import threading
from pathlib import Path

import uvicorn

from nexgraph_engine.api.app import create_app

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


def _mid_pick_sequence(project: Path, git_dir: Path) -> bool:
    """Cherry-pick/revert một dải: bỏ qua mọi bước trừ bước cuối. `sequencer/` cũ (sau reset --hard) không được tính."""
    try:
        steps = [s for s in (git_dir / "sequencer" / "todo").read_text(encoding="utf-8").splitlines() if s.strip()]
    except OSError:
        return False
    if len(steps) < 2:
        return False
    verb, _, rest = steps[0].partition(" ")
    subject = rest.partition(" ")[2]
    expected = {"pick": subject, "revert": f'Revert "{subject}"'}.get(verb)
    return expected is not None and _git_out(project, "log", "-1", "--format=%s") == expected


def _skip_reason(project: Path, hook: str | None, args: list[str]) -> str | None:
    """Luật bỏ qua giống graphify hooks.py. git còn giữ MERGE_HEAD khi post-merge chạy và rebase-merge/ khi post-rewrite chạy."""
    if os.environ.get("NEXGRAPH_SKIP_HOOK") == "1":
        return "skip_env"
    if hook == "post-checkout" and (len(args) < 3 or args[2] != "1" or args[0] == args[1]):
        return "no_branch_switch"
    if hook == "post-rewrite" and args[:1] != ["rebase"]:
        return "amend"  # amend đã được post-commit cập nhật
    git_dir = _git_dir(project)
    if git_dir is None:
        return None
    if hook != "post-rewrite" and ((git_dir / "rebase-merge").is_dir() or (git_dir / "rebase-apply").is_dir()):
        return "rebase"
    if hook != "post-merge" and (git_dir / "MERGE_HEAD").is_file():
        return "merge"
    if hook == "post-commit":  # git còn giữ CHERRY_PICK_HEAD khi post-commit chạy
        return "cherry_pick" if _mid_pick_sequence(project, git_dir) else None
    if (git_dir / "CHERRY_PICK_HEAD").is_file():
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
    timeout = float(os.environ.get("NEXGRAPH_REFRESH_TIMEOUT", "600") or 0)

    def bail() -> None:
        log({"status": "timeout", "seconds": timeout})
        os._exit(124)  # SQLite và khoá flock tự phục hồi khi tiến trình chết

    timer = threading.Timer(timeout, bail) if timeout > 0 else None
    if timer:
        timer.daemon = True
        timer.start()
    try:
        code, out = _refresh(project, data_dir)
    except Exception as exc:
        log({"status": "error", "error": repr(exc)})
        raise
    finally:
        if timer:
            timer.cancel()
    log(out)
    return code


def _refresh(project: Path, data_dir: Path | None) -> tuple[int, dict]:
    """In một dòng JSON; thoát 0 kể cả khi bỏ qua (không bao giờ làm commit thất bại), 3 khi dự án chưa lập chỉ mục."""
    import sqlite3
    from contextlib import closing

    from nexgraph_engine.index.refresh import refresh_project
    from nexgraph_engine.mcp.server import ProjectNotIndexed, resolve_graph_db
    from nexgraph_engine.schema.db import open_graph_db
    from nexgraph_engine.sources import sources_root
    from nexgraph_engine.store.graph_store import GraphStore
    from nexgraph_engine.store.publication import GraphWriteBusy, graph_writer

    skipped = {**_SKIPPED, "reason": "index_running"}
    try:
        db = resolve_graph_db(project, data_dir)
    except ProjectNotIndexed as exc:
        print(str(exc), file=sys.stderr)
        return 3, {"status": "not_indexed"}
    try:
        with graph_writer(db) as path, closing(open_graph_db(path)) as conn:
            store = GraphStore(conn)
            if not store.has_published_graph():
                print(f"Dự án chưa được lập chỉ mục trong NexGraph: {project}", file=sys.stderr)
                return 3, {"status": "not_indexed"}
            if conn.execute("SELECT 1 FROM lan_lap_chi_muc WHERE trang_thai IN ('cho', 'cau_truc', 'phan_giai') LIMIT 1").fetchone():
                print(json.dumps(skipped))
                return 0, skipped
            r = refresh_project(store, project.resolve(), sources_dir=sources_root(data_dir, store.project_id()))
    except (GraphWriteBusy, sqlite3.OperationalError):
        print(json.dumps(skipped))
        return 0, skipped
    out = {"status": "ok", "added": r.added, "changed": r.changed, "removed": r.removed,
           "unchanged": r.unchanged, "seconds": round(r.seconds, 3)}
    print(json.dumps(out))
    return 0, out


def _exit_when_stdin_closes(server: uvicorn.Server) -> None:
    """Chặn đến khi stdin gặp EOF (tiến trình cha thoát hoặc bị kill), rồi tắt server."""
    try:
        sys.stdin.buffer.read()
    finally:
        server.should_exit = True


def _serve(data_dir: Path, port: int, exit_on_stdin_close: bool) -> int:
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
                return run_http(args.project, args.data_dir, args.port, key)
            return run_stdio(args.project, args.data_dir)
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
