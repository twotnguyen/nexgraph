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
    return parser


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
    args = _build_parser().parse_args(argv)
    if args.command == "serve":
        return _serve(args.data_dir, args.port, args.exit_on_stdin_close)
    if args.command == "mcp":
        from nexgraph_engine.mcp.server import ProjectNotIndexed, run_stdio
        try:
            return run_stdio(args.project, args.data_dir)
        except ProjectNotIndexed as exc:
            print(str(exc), file=sys.stderr)  # stdout dành riêng cho giao thức MCP
            return 3
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
