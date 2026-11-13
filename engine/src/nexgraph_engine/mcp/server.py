"""MCP server chỉ đọc của NexGraph cho trợ lý AI (spec §5.8, UC10).

Chạy: ``nexgraph-engine mcp --project <đường dẫn> [--data-dir <thư mục app>]`` (stdio).

Mọi tool gọi cùng hàm với route HTTP ``/v1`` (ADR 0002), mở CSDL đồ thị ở chế độ chỉ đọc
cho từng lần gọi, nên app vẫn ghi song song được (WAL).

Phần ``_run_off_loop`` / ``_offload`` và cách viết SERVER_INSTRUCTIONS định tuyến theo loại câu hỏi
chép và rút gọn từ code-review-graph (MIT, Copyright (c) 2026 Tirth Kanani),
commit 29d8bd94312a02dc85b2f4e3e6c97ebe7e768fb8, tệp ``code_review_graph/main.py``.
Giấy phép: ``engine/third_party/code-review-graph/LICENSE``.
Modified by NexGraph contributors, 2026.
"""

from __future__ import annotations

import asyncio
import os
import sqlite3
from collections.abc import Callable
from pathlib import Path
from typing import Any, Literal

import anyio.to_thread
from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from mcp.types import ToolAnnotations

from nexgraph_engine import __version__
from nexgraph_engine.api.errors import ApiError
from nexgraph_engine.api.routes_arch import architecture_json, evidence_json
from nexgraph_engine.api.routes_changes import changes_json
from nexgraph_engine.api.routes_graph import get_node_json, neighbors_json, parse_edge_types, search_json
from nexgraph_engine.api.routes_graph import read_code as read_code_json
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.projects import NEXGRAPH_DIR, ProjectRegistry

READ_ONLY = ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False)

SERVER_INSTRUCTIONS = (
    "Đồ thị tri thức của dự án đang mở trong NexGraph (Tree-sitter AST + cạnh gọi hàm / import / kế thừa / "
    "kiểm thử, mỗi cạnh có bằng chứng tệp:dòng). Dùng khi câu hỏi là về QUAN HỆ giữa các phần của mã:\n"
    "- tìm ký hiệu, tệp theo tên -> search\n"
    "- ai gọi / import / kế thừa X -> get_neighbors direction=in\n"
    "- X gọi / dùng gì -> get_neighbors direction=out\n"
    "- các khối kiến trúc và mũi tên giữa chúng -> get_architecture, rồi get_evidence để lấy tệp:dòng\n"
    "- sửa X thì ảnh hưởng đâu, test nào liên quan -> get_impact\n"
    "- đọc đoạn mã để trích dẫn -> read_code\n"
    "Khi trả lời, trích dẫn dạng tệp:dòng lấy từ kết quả tool; không bịa đường đi không có trong đồ thị. "
    "Mọi tool chỉ đọc."
)


class ProjectNotIndexed(RuntimeError):
    pass


def resolve_graph_db(project: Path, data_dir: Path | None) -> Path:
    """Tìm CSDL đồ thị mà app đã tạo; không tạo mới (MCP không được ghi)."""
    root = project.resolve()
    in_project = root / NEXGRAPH_DIR / "graph.db"
    if in_project.is_file():
        return in_project
    if data_dir is not None and (data_dir / "app.db").is_file():
        for info in ProjectRegistry(data_dir).list_projects():
            if info.path.resolve() == root and info.graph_db.is_file():
                return info.graph_db
    raise ProjectNotIndexed(f"Dự án chưa được lập chỉ mục trong NexGraph: {root}")


async def _run_off_loop(work: Callable[[], Any]) -> Any:
    # anyio thay vì asyncio.to_thread: cùng bộ giới hạn luồng FastMCP dùng; cho phép huỷ khi quá thời gian.
    return await anyio.to_thread.run_sync(work, abandon_on_cancel=True)


async def _offload(tool_name: str, work: Callable[[], Any]) -> Any:
    """Chạy thân tool ngoài vòng sự kiện stdio, có giới hạn thời gian tuỳ chọn (NEXGRAPH_MCP_TIMEOUT giây)."""
    timeout = float(os.environ.get("NEXGRAPH_MCP_TIMEOUT", "0") or 0)
    if timeout <= 0:
        return await _run_off_loop(work)
    try:
        return await asyncio.wait_for(_run_off_loop(work), timeout=timeout)
    except asyncio.TimeoutError as exc:
        raise ToolError(f"{tool_name} quá {timeout:g}s") from exc


def build_server(project: Path, data_dir: Path | None) -> FastMCP:
    root = project.resolve()
    graph_db = resolve_graph_db(root, data_dir)
    mcp = FastMCP("nexgraph", instructions=SERVER_INSTRUCTIONS)
    mcp._mcp_server.version = __version__

    async def run(tool_name: str, body: Callable[[GraphStore], Any]) -> Any:
        def work() -> Any:
            try:
                conn = open_graph_db(graph_db, read_only=True)
            except (sqlite3.Error, OSError) as exc:
                raise ToolError(f"Không mở được dữ liệu đồ thị: {exc}") from exc
            try:
                return body(GraphStore(conn))
            except ApiError as exc:  # lỗi nghiệp vụ dùng chung với HTTP -> lỗi tool đọc được
                raise ToolError(exc.message) from exc
            finally:
                conn.close()
        return await _offload(tool_name, work)

    @mcp.tool(annotations=READ_ONLY)
    async def search(query: str, kinds: list[str] | None = None, limit: int = 20) -> list[dict]:
        """Tìm nút (tệp, lớp, hàm, widget...) theo tên/từ khoá, xếp hạng giảm dần. kinds lọc theo NodeKind."""
        return await run("search", lambda s: search_json(s, query, kinds, max(1, min(limit, 100))))

    @mcp.tool(annotations=READ_ONLY)
    async def get_node(node_id: str) -> dict:
        """Lấy một nút theo id (ví dụ `lib/main.dart#file`, `lib/a.dart::A.run#method`)."""
        return await run("get_node", lambda s: get_node_json(s, node_id))

    @mcp.tool(annotations=READ_ONLY)
    async def get_neighbors(node_id: str, types: list[str] | None = None,
                            direction: Literal["in", "out", "both"] = "both", depth: int = 1,
                            limit: int = 200) -> dict:
        """Nút lân cận qua cạnh thật. types lọc EdgeType (CALLS, IMPORTS, INHERITS, TESTED_BY...).
        direction=in: ai trỏ tới nút này; out: nút này trỏ tới đâu. depth 1–3."""
        wanted = parse_edge_types(types) if types else None
        return await run("get_neighbors", lambda s: neighbors_json(
            s, node_id, wanted, direction, max(1, min(depth, 3)), max(1, min(limit, 2000))))

    @mcp.tool(annotations=READ_ONLY)
    async def get_architecture(parent: str | None = None) -> dict:
        """Bản đồ kiến trúc: tối đa 12 khối và mũi tên (đếm cạnh IMPORTS/CALLS). parent = id khối để đi sâu."""
        return await run("get_architecture", lambda s: architecture_json(s.conn, parent))

    @mcp.tool(annotations=READ_ONLY)
    async def get_evidence(from_block: str, to_block: str, limit: int = 50) -> list[dict]:
        """Bằng chứng tệp:dòng cho mũi tên giữa hai khối kiến trúc."""
        return await run("get_evidence", lambda s: evidence_json(s.conn, from_block, to_block,
                                                                 max(1, min(limit, 200))))

    @mcp.tool(annotations=READ_ONLY)
    async def get_impact() -> dict:
        """Thay đổi chưa commit (hoặc so với lần lập chỉ mục nếu không có Git), vùng ảnh hưởng,
        test liên quan và hàm đổi chưa có test. Dựa trên đồ thị đã lập chỉ mục; không tự lập chỉ mục lại."""
        return await run("get_impact", lambda s: changes_json(s, root))

    @mcp.tool(annotations=READ_ONLY)
    async def read_code(file: str, start: int | None = None, end: int | None = None) -> dict:
        """Đọc mã của tệp đã lập chỉ mục (đường dẫn tương đối trong dự án), tối đa 2.000 dòng."""
        return await run("read_code", lambda s: read_code_json(s, root, file, start, end))

    return mcp



def run_stdio(project: Path, data_dir: Path | None) -> int:
    build_server(project, data_dir).run("stdio")
    return 0
