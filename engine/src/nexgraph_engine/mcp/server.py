"""MCP server chỉ đọc của NexGraph cho trợ lý AI (spec §5.8, UC10).

Chạy: ``nexgraph-engine mcp --project <đường dẫn> [--data-dir <thư mục app>] [--http --port N]``
(stdio; hoặc Streamable HTTP tại 127.0.0.1 với header ``X-API-Key`` = biến môi trường ``NEXGRAPH_MCP_KEY``).

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
import hmac
import json
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
from nexgraph_engine import memory
from nexgraph_engine.errors import ApiError
from nexgraph_engine.flows.query import flow_json, list_flows_json, trace_from_json
from nexgraph_engine.hook_guard import touch_query_stamp
from nexgraph_engine.impact.analyze import tests_for as tests_for_node
from nexgraph_engine.query.ask import ask_graph
from nexgraph_engine.query.common import nodes_by_pk
from nexgraph_engine.query.contracts import (
    architecture_json,
    changes_json,
    evidence_json,
    get_node_json,
    neighbors_json,
    node_json,
    parse_edge_types,
    read_code as read_code_json,
    search_json,
    stats_json,
)
from nexgraph_engine.query.context import build_context
from nexgraph_engine.prs.gh import GhError
from nexgraph_engine.prs.listing import list_prs_json, triage_json
from nexgraph_engine.prs.review import pr_detail_json, review_status_json
from nexgraph_engine.query.model_view import ModelGraph
from nexgraph_engine.query.paths import find_paths, impact_of
from nexgraph_engine.query.section import section_json
from nexgraph_engine.query.source_policy import SourcePolicy, protected_source
from nexgraph_engine.report.build import audit_json, report_json, report_markdown
from nexgraph_engine.sources import sources_root
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.schema.enums import EdgeType
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.projects import ProjectNotIndexed, ProjectRegistry, resolve_graph_db  # noqa: F401 (cli, test dùng qua module này)

READ_ONLY = ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False)
# Ngoại lệ duy nhất (ADR 0019): `remember` ghi bảng ký ức trong CSDL của NexGraph, không ghi tệp dự án.
WRITES_MEMORY = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True, openWorldHint=False)

SERVER_INSTRUCTIONS = (
    "Đồ thị tri thức của dự án đang mở trong NexGraph (Tree-sitter AST + cạnh gọi hàm / import / kế thừa / "
    "kiểm thử, mỗi cạnh có bằng chứng tệp:dòng). Dùng khi câu hỏi là về QUAN HỆ giữa các phần của mã:\n"
    "- tìm ký hiệu, tệp theo tên -> search\n"
    "- ai gọi X -> get_callers; ai import / kế thừa X -> get_neighbors direction=in\n"
    "- test nào kiểm X -> tests_for\n"
    "- X gọi / dùng gì -> get_neighbors direction=out\n"
    "- các khối kiến trúc và mũi tên giữa chúng -> get_architecture, rồi get_evidence để lấy tệp:dòng\n"
    "- sửa X thì ảnh hưởng đâu, test nào liên quan -> get_impact\n"
    "- đọc đoạn mã để trích dẫn -> read_code\n"
    "- đọc một mục tài liệu (heading Markdown/docx/PDF) -> get_section\n"
    "- câu hỏi tự do, lấy đồ thị con liên quan -> query_graph\n"
    "- cần các đoạn mã liên quan nhất tới một câu hỏi, gọn trong ngân sách token -> get_context\n"
    "- đường đi giữa hai nút -> shortest_path\n"
    "- nút trung tâm, số liệu tổng, một cộng đồng -> god_nodes, graph_stats, get_community\n"
    "- một tính năng chạy qua những bước nào, luồng xử lý một route/lệnh -> list_flows rồi trace_flow\n"
    "- từ một hàm bất kỳ gọi tiếp tới đâu -> trace_flow entry=<id nút>\n"
    "- trước khi sửa một nút, xem bài học/quyết định/sự cố/người phụ trách đã ghi -> recall node_id=<id nút>\n"
    "- ghi lại bài học, quyết định, sự cố, người phụ trách gắn với nút -> remember\n"
    "- PR nào đang mở, nên review PR nào trước -> list_prs, triage_prs; một PR ảnh hưởng đâu, test nào cần chạy "
    "-> get_pr_impact, review_status\n"
    "Trước khi tin kết quả, gọi graph_stats một lần: stale=true nghĩa là mã nguồn đã đổi sau lần lập chỉ mục, "
    "hãy đọc lại tệp bằng read_code để xác nhận.\n"
    "Khi trả lời, trích dẫn dạng tệp:dòng lấy từ kết quả tool; không bịa đường đi không có trong đồ thị. "
    "Mọi tool chỉ đọc, trừ remember (chỉ ghi bộ nhớ của NexGraph, không ghi tệp)."
)


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


def build_server(project: Path, data_dir: Path | None, *, global_graph: bool = False) -> FastMCP:
    root = project.resolve()
    graph_db = resolve_graph_db(root, data_dir)
    mcp = FastMCP("nexgraph", instructions=SERVER_INSTRUCTIONS)
    mcp._mcp_server.version = __version__

    def src(s: GraphStore) -> Path | None:  # gốc phụ `sources/` (nguồn tải từ URL, W6)
        return sources_root(data_dir, s.project_id())

    async def run(tool_name: str, body: Callable[[GraphStore], Any], guard: tuple[str, ...] = ()) -> Any:
        def work() -> Any:
            try:
                conn = open_graph_db(graph_db, read_only=True)
            except (sqlite3.Error, OSError) as exc:
                raise ToolError(f"Không mở được dữ liệu đồ thị: {exc}") from exc
            try:
                store = GraphStore(conn)
                if not store.has_published_graph():
                    raise ToolError("Dự án chưa được lập chỉ mục xong")
                model = ModelGraph(store, root)
                # Như HTTP: hỏi thẳng về nút bị loại khỏi ngữ cảnh AI thì từ chối, kể cả khi láng giềng của nó hiển thị được.
                if not all(model.allows_node(node_id) for node_id in guard):
                    raise protected_source()
                return model.filter(body(store))
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
        return await run("get_node", lambda s: get_node_json(s, node_id), (node_id,))

    @mcp.tool(annotations=READ_ONLY)
    async def get_neighbors(node_id: str, types: list[str] | None = None,
                            direction: Literal["in", "out", "both"] = "both", depth: int = 1,
                            limit: int = 200) -> dict:
        """Nút lân cận qua cạnh thật. types lọc EdgeType (CALLS, IMPORTS, INHERITS, TESTED_BY...).
        direction=in: ai trỏ tới nút này; out: nút này trỏ tới đâu. depth 1–3."""
        wanted = parse_edge_types(types) if types else None
        return await run("get_neighbors", lambda s: neighbors_json(
            s, node_id, wanted, direction, max(1, min(depth, 3)), max(1, min(limit, 2000))), (node_id,))

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
    async def get_impact(node_id: str | None = None) -> dict:
        """Vùng ảnh hưởng. Không tham số: thay đổi chưa commit (hoặc so với lần lập chỉ mục nếu không có Git),
        vùng ảnh hưởng, test liên quan và hàm đổi chưa có test. Có `node_id`: vùng ảnh hưởng của riêng
        tệp/symbol đó (ví dụ `lib/a.dart::A.run#method`, `lib/a.dart#file`) cùng test liên quan.
        Dựa trên đồ thị đã lập chỉ mục; không tự lập chỉ mục lại."""
        if node_id is None:
            return await run("get_impact", lambda s: changes_json(s, root))

        def body(s: GraphStore) -> dict:
            try:
                return impact_of(s, node_id)
            except KeyError as exc:
                raise ToolError(f"Không có nút {node_id}") from exc

        return await run("get_impact", body, (node_id,))

    @mcp.tool(annotations=READ_ONLY)
    async def read_code(file: str, start: int | None = None, end: int | None = None) -> dict:
        """Đọc mã của tệp đã lập chỉ mục (đường dẫn tương đối trong dự án), tối đa 2.000 dòng."""
        return await run("read_code", lambda s: read_code_json(
            s, root, file, start, end, source=SourcePolicy(root, s.last_exclude()), sources_dir=src(s)))

    @mcp.tool(annotations=READ_ONLY)
    async def query_graph(question: str, depth: int = 2, budget: int = 2000,
                          mode: Literal["bfs", "dfs"] = "bfs") -> dict:
        """Hỏi đồ thị bằng câu tự do: tìm nút khớp rồi mở rộng BFS/DFS trong giới hạn token (budget)."""
        def body(s: GraphStore) -> dict:
            try:
                out = ask_graph(s, question, max(1, min(depth, 6)), max(1, min(budget, 100_000)), mode)
            except ValueError as exc:
                raise ToolError(str(exc)) from exc
            touch_query_stamp(data_dir, s.project_id())  # hook-guard thôi nhắc trong 30 phút
            return out
        return await run("query_graph", body)

    @mcp.tool(annotations=READ_ONLY)
    async def shortest_path(source: str, target: str, max_hops: int = 4, directed: bool = True) -> dict:
        """Đường đi ngắn nhất giữa hai nút (id), tối đa max_hops cạnh (1–6)."""
        def body(s: GraphStore) -> dict:
            try:
                return find_paths(s, [source, target], max(1, min(max_hops, 6)), directed)
            except KeyError as exc:
                raise ToolError(f"Không có nút {exc.args[0]}") from exc
        return await run("shortest_path", body, (source, target))

    @mcp.tool(annotations=READ_ONLY)
    async def god_nodes(top: int = 10) -> list[dict]:
        """Các nút có nhiều liên kết nhất (không tính tệp và test)."""
        return await run("god_nodes", lambda s: report_json(s, root, SourcePolicy(root, s.last_exclude()), src(s))["god_nodes"][:max(1, min(top, 10))])

    @mcp.tool(annotations=READ_ONLY)
    async def graph_stats() -> dict:
        """Số tệp, số nút theo loại, số cạnh theo loại, ngôn ngữ, số tham chiếu chưa phân giải, và độ mới của graph
        (indexed_at, index_commit, head_commit, changed_files, stale)."""
        return await run("graph_stats", lambda s: stats_json(s, root, src(s)))

    @mcp.tool(annotations=READ_ONLY)
    async def get_community(community_id: str, limit: int = 200) -> dict:
        """Một cộng đồng (khối kiến trúc) theo id dạng `com:<số>`: nhãn, kích thước, độ gắn kết và các nút."""
        return await run("get_community", lambda s: community_json(s, community_id, max(1, min(limit, 2000))))

    @mcp.tool(annotations=READ_ONLY)
    async def get_context(question: str, budget: int = 4000) -> dict:
        """Gói các nút và đoạn mã liên quan nhất tới câu hỏi, xếp hạng hợp nhất và gọn trong ngân sách token (500–20000)."""
        def body(s: GraphStore) -> dict:
            try:
                out = build_context(s, root, question, max(500, min(budget, 20_000)), sources_dir=src(s))
            except ValueError as exc:
                raise ToolError(str(exc)) from exc
            touch_query_stamp(data_dir, s.project_id())
            return out
        return await run("get_context", body)

    @mcp.tool(annotations=READ_ONLY)
    async def list_flows(query: str | None = None, kind: str | None = None, limit: int = 20) -> dict:
        """Danh sách các luồng thực thi (chức năng/route) từ các điểm vào của hệ thống."""
        return await run("list_flows", lambda s: list_flows_json(s, q=query, kind=kind, limit=max(1, min(limit, 200))))

    @mcp.tool(annotations=READ_ONLY)
    async def trace_flow(flow_id: int | None = None, entry: str | None = None) -> dict:
        """Truy vết chi tiết luồng thực thi: các bước từ điểm vào tới nơi kết thúc kèm tệp:dòng."""
        if (flow_id is None and entry is None) or (flow_id is not None and entry is not None):
            raise ToolError("Phải cung cấp đúng một trong hai tham số: flow_id hoặc entry")
        if flow_id is not None:
            return await run("trace_flow", lambda s: flow_json(s, flow_id))
        return await run("trace_flow", lambda s: trace_from_json(s, entry))  # type: ignore[arg-type]

    @mcp.tool(annotations=READ_ONLY)
    async def get_section(node_id: str) -> dict:
        """Đọc thân một mục tài liệu (nút document, mỗi heading một nút) từ tệp hiện tại, đã che secret,
        tối đa 8.000 ký tự. stale=true nghĩa là tệp đã đổi sau lần lập chỉ mục."""
        return await run("get_section", lambda s: section_json(s, root, node_id,
                                                               source=SourcePolicy(root, s.last_exclude()),
                                                               sources_dir=src(s)))

    @mcp.tool(annotations=READ_ONLY)
    async def get_callers(node_id: str, depth: int = 1, limit: int = 200) -> dict:
        """Ai gọi nút này (cạnh CALLS chiều vào), depth 1–3."""
        return await run("get_callers", lambda s: neighbors_json(
            s, node_id, {EdgeType.CALLS}, "in", max(1, min(depth, 3)), max(1, min(limit, 2000))), (node_id,))

    @mcp.tool(annotations=READ_ONLY)
    async def tests_for(node_id: str) -> list[dict]:
        """Test kiểm nút này: test gọi thẳng nút hoặc gọi một hàm gọi nó (tối đa 2 bước)."""
        def body(s: GraphStore) -> list[dict]:
            if s.get_node(node_id) is None:
                raise ToolError(f"Không có nút {node_id}")
            return [node_json(n) for n in tests_for_node(s.conn, node_id)]
        return await run("tests_for", body, (node_id,))

    @mcp.tool(annotations=READ_ONLY)
    async def find(query: str, kind: str | None = None, limit: int = 20) -> list[dict]:
        """Như search, lọc theo một loại nút (class, function, method, document...)."""
        return await run("find", lambda s: search_json(s, query, [kind] if kind else None, max(1, min(limit, 100))))

    @mcp.tool(annotations=WRITES_MEMORY)
    async def remember(kind: Literal["lesson", "decision", "incident", "owner"], text: str,
                       node_ids: list[str] | None = None) -> dict:
        """Ghi một bài học / quyết định / sự cố / người phụ trách, neo vào các nút (id). Chỉ ghi bộ nhớ của NexGraph.
        Trùng nội dung (không phân biệt hoa thường, dấu câu) và cùng tập nút thì trả bản đã có (created=false)."""
        def work() -> dict:
            try:
                with memory.writer(graph_db) as conn:
                    return memory.remember(conn, kind, text, node_ids or [], "mcp")
            except (memory.MemoryBusy, ValueError) as exc:
                raise ToolError(str(exc)) from exc
            except (sqlite3.Error, OSError) as exc:  # không đưa câu lỗi SQLite cho agent
                raise ToolError("Không ghi được bộ nhớ của dự án") from exc
        return await _offload("remember", work)

    @mcp.tool(annotations=READ_ONLY)
    async def recall(query: str | None = None, node_id: str | None = None, limit: int = 20) -> dict:
        """Ký ức đã ghi (bài học, quyết định, sự cố, người phụ trách, đánh giá câu trả lời) theo nút và/hoặc từ khoá.
        Theo nút thì kèm `lesson` (preferred/tentative/contested) và `node_exists`; nút đã mất có trong `missing_node_ids`."""
        def body(s: GraphStore) -> dict:
            try:
                return memory.recall(s.conn, query=query, node_id=node_id, limit=max(1, min(limit, 200)),
                                     allows=memory.source_filter(SourcePolicy(root, s.last_exclude())))
            except ValueError as exc:
                raise ToolError(str(exc)) from exc
        return await run("recall", body)

    # Pull request (W7): gọi `gh` chỉ đọc trong thư mục dự án; lỗi `gh` và số PR lạ thành lỗi tool đọc được.
    def pr_call(work: Callable[[], Any]) -> Any:
        try:
            return work()
        except (GhError, ValueError) as exc:
            raise ToolError(str(exc)) from exc

    @mcp.tool(annotations=READ_ONLY)
    async def list_prs(limit: int = 50) -> dict:
        """PR đang mở trên GitHub: nhãn (WRONG-BASE, CI-FAIL, CHANGES-REQ, DRAFT, STALE, PENDING, APPROVED, READY),
        tệp đổi, số nút bị ảnh hưởng, và các cặp PR xung đột (cùng tệp hoặc cùng vùng ảnh hưởng). Cần `gh` đã đăng nhập."""
        return await run("list_prs", lambda s: pr_call(lambda: list_prs_json(s, root, max(1, min(limit, 100)),
                                                                                   model=ModelGraph(s, root))))

    @mcp.tool(annotations=READ_ONLY)
    async def get_pr_impact(pr_number: int) -> dict:
        """Ảnh hưởng và review cục bộ của một PR (không checkout): nút đổi, vùng ảnh hưởng có điểm, test liên quan,
        symbol đổi thiếu test, tài liệu có thể cũ, code có thể không còn ai gọi, test nên chạy và lệnh gợi ý."""
        return await run("get_pr_impact", lambda s: pr_call(lambda: pr_detail_json(s, root, pr_number, model=ModelGraph(s, root), data_dir=data_dir)))

    @mcp.tool(annotations=READ_ONLY)
    async def triage_prs() -> dict:
        """Hàng đợi review xếp theo luật (bỏ PR sai nhánh gốc và PR cũ), kèm việc nên làm cho từng PR."""
        return await run("triage_prs", lambda s: pr_call(lambda: triage_json(list_prs_json(s, root, model=ModelGraph(s, root)))))

    @mcp.tool(annotations=READ_ONLY)
    async def review_status(pr_number: int) -> dict:
        """Tóm tắt review cục bộ của một PR: gate pass|advisory, số phát hiện, các phát hiện đầu và test nên chạy.
        Không đăng gì lên GitHub."""
        return await run("review_status", lambda s: pr_call(lambda: review_status_json(
            pr_detail_json(s, root, pr_number, model=ModelGraph(s, root), data_dir=data_dir))))

    def resource_json(uri: str, body: Callable[[GraphStore], Any], doc: str) -> None:
        async def read() -> str:
            return json.dumps(await run(uri, body), ensure_ascii=False)
        mcp.resource(uri, name=uri.removeprefix("nexgraph://"), description=doc, mime_type="application/json")(read)

    @mcp.resource("nexgraph://report", name="report", mime_type="text/markdown",
                  description="Báo cáo đồ thị dạng Markdown: nút trung tâm, cộng đồng, kết nối bất ngờ, câu hỏi gợi ý.")
    async def report_resource() -> str:
        return await run("nexgraph://report", lambda s: report_markdown(s, root.name, SourcePolicy(root, s.last_exclude())))

    resource_json("nexgraph://stats", lambda s: stats_json(s, root, src(s)), "Số liệu tổng và độ mới của graph.")
    resource_json("nexgraph://god-nodes", lambda s: report_json(s, root, SourcePolicy(root, s.last_exclude()), src(s))["god_nodes"], "Các nút có nhiều liên kết nhất.")
    resource_json("nexgraph://surprises", lambda s: report_json(s, root, SourcePolicy(root, s.last_exclude()), src(s))["surprising"], "Kết nối bất ngờ giữa các cộng đồng.")
    resource_json("nexgraph://questions", lambda s: report_json(s, root, SourcePolicy(root, s.last_exclude()), src(s))["questions"], "Câu hỏi gợi ý để khám phá graph.")
    resource_json("nexgraph://audit", audit_json, "Tỉ lệ cạnh EXTRACTED/INFERRED/AMBIGUOUS và lỗi phân tích.")

    if global_graph:
        _add_global_tools(mcp, root, graph_db, data_dir)
    return mcp


def _add_global_tools(mcp: FastMCP, root: Path, graph_db: Path, data_dir: Path | None) -> None:
    """`--global` (W8): thêm `list_repositories`, thay `query_graph` bằng bản nhận `repository`. Đều chỉ đọc."""
    from nexgraph_engine.global_graph.link import cross_repo_edges, visible_cross_repo
    from nexgraph_engine.global_graph.store import GlobalStore

    if data_dir is None:
        raise ProjectNotIndexed("--global cần --data-dir (graph chung nằm ở <data_dir>/global.db)")
    registry = ProjectRegistry(data_dir, read_only=True)
    store_global = GlobalStore(data_dir)

    def repositories() -> list[dict]:
        edges = store_global.edges(read_only=True)
        out = []
        for pid, _ in store_global.members(read_only=True):
            info = registry.get(pid)
            out.append({"project_id": pid, "name": info.name if info else None,
                        "available": bool(info and info.path.is_dir() and info.graph_db.is_file()),
                        "current": bool(info and info.graph_db.resolve() == graph_db.resolve()),
                        "cross_edges": sum(pid in (e["du_an_nguon"], e["du_an_dich"]) for e in edges)})
        return out

    @mcp.tool(annotations=READ_ONLY)
    async def list_repositories() -> list[dict]:
        """Các dự án trong graph chung (id, tên, còn mở được không, có phải dự án hiện tại, số cạnh liên repo)."""
        return await _offload("list_repositories", repositories)

    mcp.remove_tool("query_graph")

    @mcp.tool(annotations=READ_ONLY, name="query_graph")
    async def query_graph_global(question: str, depth: int = 2, budget: int = 2000,
                                 mode: Literal["bfs", "dfs"] = "bfs", repository: str | None = None) -> dict:
        """Hỏi đồ thị bằng câu tự do. repository = id hoặc tên dự án trong graph chung (xem list_repositories);
        bỏ trống là dự án hiện tại. Kết quả kèm cross_repo: cạnh liên repo chạm các nút tìm được."""
        def work() -> dict:
            if repository is None:
                pid, db, base = None, graph_db, root
            else:
                found = [r for r in repositories() if repository in (r["project_id"], r["name"])]
                if len(found) != 1 or not found[0]["available"]:
                    raise ToolError(f"Không có dự án {repository} trong graph chung (gọi list_repositories)")
                info = registry.get(found[0]["project_id"])
                pid, db, base = info.project_id, info.graph_db, info.path
            try:
                conn = open_graph_db(db, read_only=True)
            except (sqlite3.Error, OSError) as exc:
                raise ToolError(f"Không mở được dữ liệu đồ thị: {exc}") from exc
            try:
                s = GraphStore(conn)
                if not s.has_published_graph():
                    raise ToolError("Dự án chưa được lập chỉ mục xong")
                pid = pid or s.project_id()
                try:
                    out = ask_graph(s, question, max(1, min(depth, 6)), max(1, min(budget, 100_000)), mode)
                except ValueError as exc:
                    raise ToolError(str(exc)) from exc
                touch_query_stamp(data_dir, s.project_id())
                # Lọc trước rồi mới lấy id: nút bị loại khỏi AI không được dẫn sang cạnh liên repo.
                shown = ModelGraph(s, base).filter({**out, "repository": pid})
                ids = [n["id"] for n in shown.get("nodes", [])]
                cross = visible_cross_repo(data_dir, pid, cross_repo_edges(data_dir, pid, ids))
                return {**shown, "cross_repo": [{k: e[k] for k in ("project_id", "node_id", "via", "direction",
                                                                    "type", "subtype")} for e in cross]}
            except ApiError as exc:
                raise ToolError(exc.message) from exc
            finally:
                conn.close()
        return await _offload("query_graph", work)


def community_json(store: GraphStore, community_id: str, limit: int) -> dict:
    raw = community_id[4:] if community_id.startswith("com:") else ""
    # int() trên hàng nghìn chữ số ném ValueError (và giới hạn chuyển đổi của Python): chặn từ độ dài.
    valid = raw.isdigit() and len(raw) <= 10
    row = store.conn.execute("SELECT ma_khoi, ten, do_gan_ket FROM khoi_kien_truc WHERE ma_khoi = ?",
                             (int(raw),)).fetchone() if valid else None
    if row is None:
        raise ToolError(f"Không có cộng đồng {community_id}")
    pks = [r[0] for r in store.conn.execute(
        "SELECT ma_nut FROM nut WHERE ma_khoi = ? ORDER BY ma_nut", (row["ma_khoi"],))]
    nodes = [{**node_json(n), "community": community_id} for n in nodes_by_pk(store, pks[:limit])]
    return {"community": {"id": community_id, "label": row["ten"], "size": len(pks),
                          "cohesion": row["do_gan_ket"]},
            "nodes": nodes, "truncated": len(pks) > limit}


class ApiKeyMiddleware:
    """Chặn mọi request HTTP thiếu/sai header X-API-Key (so sánh hằng thời gian)."""

    def __init__(self, app: Any, key: str) -> None:
        self.app, self.key = app, key.encode()

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope["type"] == "http":
            given = dict(scope.get("headers") or []).get(b"x-api-key", b"")
            if not hmac.compare_digest(given, self.key):
                await send({"type": "http.response.start", "status": 401,
                            "headers": [(b"content-type", b"application/json")]})
                await send({"type": "http.response.body",
                            "body": b'{"error":{"code":"unauthorized","message":"X-API-Key sai hoac thieu"}}'})
                return
        await self.app(scope, receive, send)


def run_http(project: Path, data_dir: Path | None, port: int, key: str, global_graph: bool = False) -> int:
    import json
    import socket

    import uvicorn

    mcp = build_server(project, data_dir, global_graph=global_graph)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", port))
    sock.listen(128)
    print(json.dumps({"event": "ready", "port": sock.getsockname()[1], "pid": os.getpid()}), flush=True)
    app = ApiKeyMiddleware(mcp.streamable_http_app(), key)
    # Client AI giữ luồng SSE mở: không giới hạn thì tắt server (và thoát app) có thể treo mãi.
    uvicorn.Server(uvicorn.Config(app, log_level="warning", timeout_graceful_shutdown=2)).run(sockets=[sock])
    return 0


def run_stdio(project: Path, data_dir: Path | None, global_graph: bool = False) -> int:
    build_server(project, data_dir, global_graph=global_graph).run("stdio")
    return 0
