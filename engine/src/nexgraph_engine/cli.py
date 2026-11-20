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
    guard = sub.add_parser("hook-guard", help="Hook PreToolUse/BeforeTool: nhắc trợ lý AI hỏi graph trước khi đọc tệp (luôn thoát 0)")
    guard.add_argument("kind", choices=["read", "search", "gemini"])
    guard.add_argument("--project", required=True, type=Path)
    guard.add_argument("--data-dir", type=Path, default=None)
    guard.add_argument("--strict", action="store_true", help="Chặn lần Read đầu tiên mỗi phiên khi chưa hỏi graph")
    return parser


def _refresh(project: Path, data_dir: Path | None) -> int:
    """In một dòng JSON; thoát 0 kể cả khi bỏ qua (không bao giờ làm commit thất bại), 3 khi dự án chưa lập chỉ mục."""
    import sqlite3
    from contextlib import closing

    from nexgraph_engine.index.refresh import refresh_project
    from nexgraph_engine.mcp.server import ProjectNotIndexed, resolve_graph_db
    from nexgraph_engine.schema.db import open_graph_db
    from nexgraph_engine.store.graph_store import GraphStore
    from nexgraph_engine.store.publication import GraphWriteBusy, graph_writer

    skipped = {"status": "skipped", "reason": "index_running", "added": 0, "changed": 0, "removed": 0, "seconds": 0.0}
    try:
        db = resolve_graph_db(project, data_dir)
    except ProjectNotIndexed as exc:
        print(str(exc), file=sys.stderr)
        return 3
    try:
        with graph_writer(db) as path, closing(open_graph_db(path)) as conn:
            store = GraphStore(conn)
            if not store.has_published_graph():
                print(f"Dự án chưa được lập chỉ mục trong NexGraph: {project}", file=sys.stderr)
                return 3
            if conn.execute("SELECT 1 FROM lan_lap_chi_muc WHERE trang_thai IN ('cho', 'cau_truc', 'phan_giai') LIMIT 1").fetchone():
                print(json.dumps(skipped))
                return 0
            r = refresh_project(store, project.resolve())
    except (GraphWriteBusy, sqlite3.OperationalError):
        print(json.dumps(skipped))
        return 0
    print(json.dumps({"status": "ok", "added": r.added, "changed": r.changed, "removed": r.removed,
                      "unchanged": r.unchanged, "seconds": round(r.seconds, 3)}))
    return 0


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
        return _refresh(args.project, args.data_dir)
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
