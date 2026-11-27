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
import io
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
from nexgraph_engine.analysis import memory
from nexgraph_engine.core.errors import ApiError
from nexgraph_engine.analysis.flows.query import flow_json, list_flows_json, trace_from_json
from nexgraph_engine.interfaces.hook_guard import touch_query_stamp
from nexgraph_engine.analysis.impact.analyze import tests_for as tests_for_node
from nexgraph_engine.analysis.query.ask import ask_graph
from nexgraph_engine.analysis.query.common import nodes_by_pk
from nexgraph_engine.analysis.query.contracts import (
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
from nexgraph_engine.analysis.query.context import build_context
from nexgraph_engine.interfaces.mcp import graphify_view
from nexgraph_engine.analysis.prs.gh import GhError
from nexgraph_engine.analysis.prs.listing import list_prs_json, triage_json
from nexgraph_engine.analysis.prs.review import pr_detail_json, review_status_json
from nexgraph_engine.analysis.query.model_view import ModelGraph
from nexgraph_engine.analysis.query.paths import find_paths, impact_of
from nexgraph_engine.analysis.query.section import section_json
from nexgraph_engine.analysis.query.source_policy import SourcePolicy, protected_source
from nexgraph_engine.analysis.report.build import audit_json, report_json, report_markdown
from nexgraph_engine.indexing.sources import sources_root
from nexgraph_engine.core.schema.db import open_graph_db
from nexgraph_engine.core.schema.enums import EdgeType
from nexgraph_engine.storage.store.graph_store import GraphStore
from nexgraph_engine.storage.store.projects import ProjectNotIndexed, ProjectRegistry, resolve_graph_db  # noqa: F401 (cli, test dùng qua module này)

READ_ONLY = ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False)
# Ngoại lệ duy nhất (ADR 0019): `remember` ghi bảng ký ức trong CSDL của NexGraph, không ghi tệp dự án.
WRITES_MEMORY = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True, openWorldHint=False)

SERVER_INSTRUCTIONS = (
    "Đồ thị tri thức của dự án đang mở trong NexGraph (Tree-sitter AST + cạnh gọi hàm / import / kế thừa / "
    "kiểm thử, mỗi cạnh có bằng chứng tệp:dòng). Dùng khi câu hỏi là về QUAN HỆ giữa các phần của mã:\n"
    "- tìm ký hiệu, tệp theo tên -> search; chỉ một loại nút (class, function, document...) -> find\n"
    "- chi tiết một nút (tệp, dòng, loại, cụm) -> get_node\n"
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

    def run_sync(tool_name: str, body: Callable[[GraphStore], Any], guard: tuple[str, ...] = ()) -> Any:
        try:
            conn = open_graph_db(graph_db, read_only=True)
        except (sqlite3.Error, OSError) as exc:
            raise ToolError(f"Không mở được dữ liệu đồ thị: {exc}") from exc
        try:
            store = GraphStore(conn)
            if not store.has_published_graph():
                raise ToolError("Dự án chưa được lập chỉ mục xong")
            model = ModelGraph(store, root, source=SourcePolicy(root, store.last_exclude()))
            # Như HTTP: hỏi thẳng về nút bị loại khỏi ngữ cảnh AI thì từ chối, kể cả khi láng giềng của nó hiển thị được.
            if not all(model.allows_node(node_id) for node_id in guard):
                raise protected_source()
            return model.filter(body(store))
        except ApiError as exc:  # lỗi nghiệp vụ dùng chung với HTTP -> lỗi tool đọc được
            raise ToolError(exc.message) from exc
        finally:
            conn.close()

    async def run(tool_name: str, body: Callable[[GraphStore], Any], guard: tuple[str, ...] = ()) -> Any:
        return await _offload(tool_name, lambda: run_sync(tool_name, body, guard))

    # ── Lớp xem đồ thị vendor (ADR 0025 mục 2) ────────────────────────────
    pid_cache: list[str] = []
    root_resolved = root.resolve()

    def project_id() -> str | None:
        """Id dự án trong graph.db, đọc một lần; None khi chưa có CSDL."""
        if pid_cache:
            return pid_cache[0]
        try:
            conn = open_graph_db(graph_db, read_only=True)
        except (sqlite3.Error, OSError):
            return None
        try:
            pid = GraphStore(conn).project_id()
        finally:
            conn.close()
        if pid:
            pid_cache.append(pid)
        return pid

    def source_policy(project_root: Path) -> tuple[SourcePolicy, tuple]:
        """Chính sách nguồn của dự án + khoá cache cho lớp xem vendor.

        Cùng quy tắc với nhánh SQLite (`ModelGraph`): mẫu `exclude` của lần lập chỉ mục gần nhất,
        `.gitignore`, tên tệp nhạy cảm, và biên dự án.
        """
        exclude: list[str] = []
        try:
            db = resolve_graph_db(project_root, data_dir if project_root == root_resolved else None)
            conn = open_graph_db(db, read_only=True)
        except (ProjectNotIndexed, sqlite3.Error, OSError):
            pass
        else:
            try:
                exclude = GraphStore(conn).last_exclude()
            finally:
                conn.close()
        try:
            gitignore = (project_root / ".gitignore").stat().st_mtime_ns
        except OSError:
            gitignore = 0
        return SourcePolicy(project_root, exclude), (str(project_root), tuple(exclude), gitignore)

    def blocked_nodes(G: Any, policy: SourcePolicy) -> set[str]:
        """Id các nút có `source_file` bị chính sách loại; nút không có tệp thì giữ lại."""
        allowed: dict[str, bool] = {}
        dropped: set[str] = set()
        for node_id, data in G.nodes(data=True):
            source_file = data.get("source_file")
            if not source_file:
                continue
            name = str(source_file).replace("\\", "/")  # chuẩn hoá như đường dẫn trong graph.db
            ok = allowed.get(name)
            if ok is None:
                ok = policy.allows(name)
                allowed[name] = ok
            if not ok:
                dropped.add(node_id)
        return dropped

    def vendor_view(project_path: str | None) -> graphify_view.LoadedGraph | None:
        """Đồ thị `.nexgraph/graph.json` của dự án hiện tại; None khi chưa có.

        `project_path` (tham số của bản gốc) chỉ được trỏ vào chính dự án đang mở: người dùng đồng ý
        gửi ngữ cảnh cho AI theo từng dự án, nên không đọc đồ thị/tệp của dự án khác. graph.json là
        symlink có đích ngoài dự án thì coi như chưa có đồ thị (review #69 vòng 2, F4).
        """
        project_root = root_resolved
        if project_path:
            try:
                requested = Path(project_path).expanduser().resolve()
            except (OSError, RuntimeError, ValueError):
                requested = None
            if requested != root_resolved:
                raise ToolError("project_path chỉ nhận thư mục của dự án đang mở")
        try:
            graph_real = graphify_view.graph_json_path(project_root).resolve()
            graph_real.relative_to(project_root)
        except (OSError, RuntimeError, ValueError):
            return None
        view = graphify_view.view_for(project_root)
        if view.get() is None:
            return None
        policy, key = source_policy(project_root)
        return view.policy_view(key, lambda graph: blocked_nodes(graph, policy))

    def vendor_text(tool_name: str, arguments: dict, project_path: str | None) -> str | None:
        """Văn bản của tool vendor đã đổi tên hiển thị; None để rơi về hành vi NexGraph (R-N3)."""
        loaded = vendor_view(project_path)
        if loaded is None:
            if project_path:
                raise ToolError(
                    f"Không tìm thấy {graphify_view.OUT_DIR_NAME}/{graphify_view.GRAPH_JSON_NAME} "
                    f"trong {project_path}")
            return None
        try:
            text = graphify_view.HANDLERS[tool_name](loaded, arguments)
        except graphify_view.VendorToolError as exc:
            raise ToolError(str(exc)) from exc
        except Exception as exc:
            # Như wrapper `call_tool` của vendor (serve.py:3505–3506): lỗi bất ngờ thành văn bản.
            return f"Error executing {tool_name}: {exc}"
        return graphify_view.rebrand_text(text)

    @mcp.tool(annotations=READ_ONLY)
    async def search(query: str, kinds: list[str] | None = None, limit: int = 20) -> list[dict]:
        """Tìm nút (tệp, lớp, hàm, widget...) theo tên/từ khoá, xếp hạng giảm dần. kinds lọc theo NodeKind."""
        return await run("search", lambda s: search_json(s, query, kinds, max(1, min(limit, 100))))

    @mcp.tool(annotations=READ_ONLY)
    async def get_node(label: str | None = None, node_id: str | None = None, id: str | None = None,
                       project_path: str | None = None) -> str | dict:
        """Get full details for a specific node by label or ID.

        `label`: nhãn hoặc id nút; `node_id`/`id` là tên thay thế cùng nghĩa. Có `.nexgraph/graph.json`
        thì trả văn bản như bản gốc (nguồn, loại, cộng đồng, bậc); chưa có thì trả JSON của NexGraph theo id.
        """
        raw = label or node_id or id

        def work() -> str | dict:
            text = vendor_text("get_node", {"label": raw}, project_path)
            if text is not None:
                return text
            if not raw:
                raise ToolError("Cần label hoặc node_id")
            node: str = raw
            return run_sync("get_node", lambda s: get_node_json(s, node), (node,))

        return await _offload("get_node", work)

    @mcp.tool(annotations=READ_ONLY)
    async def get_neighbors(label: str | None = None, node_id: str | None = None, id: str | None = None,
                            relation_filter: str = "", token_budget: int = 2000,
                            types: list[str] | None = None,
                            direction: Literal["in", "out", "both"] = "both", depth: int = 1,
                            limit: int = 200, project_path: str | None = None) -> str | dict:
        """Get all direct neighbors of a node with edge details.

        `label`/`node_id`/`id`: nhãn hoặc id nút. `relation_filter`: lọc theo loại quan hệ;
        `token_budget`: ngân sách token đầu ra. `types`/`direction`/`depth`/`limit` là tham số
        của NexGraph, chỉ dùng khi chưa có `.nexgraph/graph.json` (khi đó trả JSON như trước).
        """
        raw = label or node_id or id

        def work() -> str | dict:
            text = vendor_text("get_neighbors", {
                "label": raw, "relation_filter": relation_filter, "token_budget": token_budget,
            }, project_path)
            if text is not None:
                return text
            if not raw:
                raise ToolError("Cần label hoặc node_id")
            node: str = raw
            wanted = parse_edge_types(types) if types else None
            return run_sync("get_neighbors", lambda s: neighbors_json(
                s, node, wanted, direction, max(1, min(depth, 3)), max(1, min(limit, 2000))), (node,))

        return await _offload("get_neighbors", work)

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
            s, root, file, start, end, source=SourcePolicy(root, s.last_exclude()), sources_dir=src(s),
            redact_documents=True))

    @mcp.tool(annotations=READ_ONLY)
    async def query_graph(question: str, mode: Literal["bfs", "dfs"] = "bfs", depth: int | None = None,
                          token_budget: int | None = None, context_filter: list[str] | None = None,
                          demote_docs: bool = True, budget: int | None = None,
                          project_path: str | None = None) -> str | dict:
        """Search the knowledge graph using BFS or DFS. Returns relevant nodes and edges as text context.

        `question`: câu hỏi hoặc từ khoá. `mode`: bfs = ngữ cảnh rộng, dfs = lần theo một nhánh.
        `depth` 1–6 — bỏ trống thì 3 khi có `.nexgraph/graph.json` (như bản gốc), 2 khi chưa có
        (như NexGraph trước đây). `token_budget`: ngân sách token đầu ra, bỏ trống thì 2000.
        `context_filter`: lọc ngữ cảnh cạnh, ví dụ ["call", "field"]. `demote_docs`: xếp hạng mã
        nguồn trên tài liệu. `budget`: tên cũ của `token_budget`, vẫn nhận.
        """
        def work() -> str | dict:
            effective_budget = budget if budget is not None else (2000 if token_budget is None else token_budget)
            text = vendor_text("query_graph", {
                "question": question, "mode": mode,
                "depth": 3 if depth is None else depth,
                "token_budget": effective_budget,
                "context_filter": context_filter, "demote_docs": demote_docs,
            }, project_path)
            if text is not None:
                touch_query_stamp(data_dir, project_id())  # hook-guard thôi nhắc trong 30 phút
                return text

            def body(s: GraphStore) -> dict:
                try:
                    out = ask_graph(s, question, max(1, min(2 if depth is None else depth, 6)),
                                    max(1, min(effective_budget, 100_000)), mode)
                except ValueError as exc:
                    raise ToolError(str(exc)) from exc
                touch_query_stamp(data_dir, s.project_id())  # hook-guard thôi nhắc trong 30 phút
                return out
            return run_sync("query_graph", body)

        return await _offload("query_graph", work)

    @mcp.tool(annotations=READ_ONLY)
    async def shortest_path(source: str, target: str, max_hops: int | None = None, undirected: bool = False,
                            directed: bool | None = None,
                            project_path: str | None = None) -> str | dict:
        """Find the shortest path between two concepts in the knowledge graph. Follows stored edge
        direction by default; set `undirected=true` to ignore it. Ends with the path's confidence.

        `source`/`target`: nhãn hoặc id nút. `max_hops`: số bước tối đa — bỏ trống thì 8 khi có
        `.nexgraph/graph.json`, 4 khi chưa có (như NexGraph trước đây). `directed` là tên cũ
        (nghịch đảo của `undirected`), vẫn nhận. Chưa có graph.json → JSON của NexGraph.
        """
        def work() -> str | dict:
            text = vendor_text("shortest_path", {
                "source": source, "target": target,
                "max_hops": 8 if max_hops is None else max_hops,
                "undirected": (not directed) if directed is not None else undirected,
            }, project_path)
            if text is not None:
                return text
            go_directed = directed if directed is not None else not undirected
            hops = max(1, min(4 if max_hops is None else max_hops, 6))

            def body(s: GraphStore) -> dict:
                try:
                    return find_paths(s, [source, target], hops, go_directed)
                except KeyError as exc:
                    raise ToolError(f"Không có nút {exc.args[0]}") from exc
            return run_sync("shortest_path", body, (source, target))

        return await _offload("shortest_path", work)

    @mcp.tool(annotations=READ_ONLY)
    async def god_nodes(top_n: int = 10, exclude_hubs_percentile: float | None = None,
                        top: int | None = None, project_path: str | None = None) -> str | list[dict]:
        """Return the most connected nodes - the core abstractions of the knowledge graph.

        `top_n`: số nút (mặc định 10). `exclude_hubs_percentile` (0–100): bỏ nút có bậc vượt
        phân vị này. `top` là tên cũ của `top_n`, vẫn nhận. Chưa có `.nexgraph/graph.json` →
        JSON của NexGraph (bỏ tệp và test, tối đa 10).
        """
        def work() -> str | list[dict]:
            text = vendor_text("god_nodes", {
                "top_n": top if top is not None else top_n,
                "exclude_hubs_percentile": exclude_hubs_percentile,
            }, project_path)
            if text is not None:
                return text
            n = top if top is not None else top_n
            return run_sync("god_nodes", lambda s: report_json(
                s, root, SourcePolicy(root, s.last_exclude()), src(s))["god_nodes"][:max(1, min(n, 10))])

        return await _offload("god_nodes", work)

    @mcp.tool(annotations=READ_ONLY)
    async def graph_stats(project_path: str | None = None) -> str | dict:
        """Return summary statistics: node count, edge count, communities, confidence breakdown.

        Có `.nexgraph/graph.json` → văn bản như bản gốc (kèm commit dựng đồ thị); chưa có →
        JSON của NexGraph (số tệp, nút/cạnh theo loại, ngôn ngữ, độ mới).
        """
        def work() -> str | dict:
            text = vendor_text("graph_stats", {}, project_path)
            if text is not None:
                return text
            return run_sync("graph_stats", lambda s: stats_json(s, root, src(s)))

        return await _offload("graph_stats", work)

    @mcp.tool(annotations=READ_ONLY)
    async def get_community(community_id: int | str, limit: int = 200, token_budget: int = 2000,
                            project_path: str | None = None) -> str | dict:
        """Get all nodes in a community by community ID.

        `community_id`: số nguyên (0-indexed theo kích thước); dạng cũ `com:<số>` vẫn nhận.
        `token_budget`: ngân sách token đầu ra. Chưa có `.nexgraph/graph.json` → JSON của
        NexGraph (khối kiến trúc mức tệp; `limit` là số nút tối đa).
        """
        def work() -> str | dict:
            raw = str(community_id)
            candidate = raw[4:] if raw.startswith("com:") else raw
            try:
                cid: int | str = int(candidate)
            except ValueError:
                cid = community_id  # không phải số: để vendor báo lỗi như bản gốc
            text = vendor_text("get_community", {
                "community_id": cid, "token_budget": token_budget,
            }, project_path)
            if text is not None:
                return text
            return run_sync("get_community", lambda s: community_json(
                s, f"com:{cid}" if isinstance(cid, int) else raw, max(1, min(limit, 2000))))

        return await _offload("get_community", work)

    @mcp.tool(annotations=READ_ONLY)
    async def get_context(question: str, budget: int = 4000) -> dict:
        """Gói các nút và đoạn mã liên quan nhất tới câu hỏi, xếp hạng hợp nhất và gọn trong ngân sách token (500–20000)."""
        def body(s: GraphStore) -> dict:
            try:
                out = build_context(s, root, question, max(500, min(budget, 20_000)), sources_dir=src(s),
                                    redact_documents=True)
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
    async def get_section(label: str | None = None, node_id: str | None = None, id: str | None = None,
                          max_chars: int = 8000, project_path: str | None = None) -> str | dict:
        """Return the text of a Markdown section (a heading node, with its subsections) or a whole
        Markdown page, read from the source file. Use it instead of opening the .md file after
        query_graph or get_node lands on a heading.

        `label`: nhãn heading, id nút, hoặc 'path/file.md::Heading' khi nhiều tệp trùng heading;
        `node_id`/`id` là tên thay thế. `max_chars`: trần ký tự trả về (mặc định 8000).
        Chưa có `.nexgraph/graph.json` → JSON của NexGraph (đã che secret, có cờ stale).
        """
        raw = label or node_id or id

        def work() -> str | dict:
            text = vendor_text("get_section", {"label": raw, "max_chars": max_chars}, project_path)
            if text is not None:
                return text
            if not raw:
                raise ToolError("Cần label hoặc node_id")
            node: str = raw
            return run_sync("get_section", lambda s: section_json(
                s, root, node, source=SourcePolicy(root, s.last_exclude()), sources_dir=src(s)))

        return await _offload("get_section", work)

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
    async def list_prs(base: str | None = None, repo: str | None = None, limit: int = 50,
                       project_path: str | None = None) -> str | dict:
        """List open GitHub PRs with CI status, review state, and graph impact (which communities
        each PR touches, blast radius). Use this before starting work to check if a PR already
        covers the area you're about to change.

        `base`: nhánh gốc để lọc (tự dò nếu bỏ trống). `repo`: chủ/tên repo trên GitHub (mặc định
        repo hiện tại). Cần `gh` đã đăng nhập. Chưa có `.nexgraph/graph.json` → JSON của NexGraph
        (kèm cặp PR xung đột; `limit` là số PR tối đa).
        """
        def work() -> str | dict:
            text = vendor_text("list_prs", {"base": base, "repo": repo}, project_path)
            if text is not None:
                return text
            return run_sync("list_prs", lambda s: pr_call(lambda: list_prs_json(
                s, root, max(1, min(limit, 100)), model=ModelGraph(s, root))))

        return await _offload("list_prs", work)

    @mcp.tool(annotations=READ_ONLY)
    async def get_pr_impact(pr_number: int, repo: str | None = None,
                            project_path: str | None = None) -> str | dict:
        """Get detailed graph impact for a specific PR: which files it changes, which knowledge-graph
        communities are affected, and how many nodes are touched.

        `pr_number`: số PR. `repo`: chủ/tên repo trên GitHub (mặc định repo hiện tại). Chưa có
        `.nexgraph/graph.json` → JSON của NexGraph (vùng ảnh hưởng có điểm, test liên quan…).
        """
        def work() -> str | dict:
            text = vendor_text("get_pr_impact", {"pr_number": pr_number, "repo": repo}, project_path)
            if text is not None:
                return text
            return run_sync("get_pr_impact", lambda s: pr_call(lambda: pr_detail_json(
                s, root, pr_number, model=ModelGraph(s, root), data_dir=data_dir)))

        return await _offload("get_pr_impact", work)

    @mcp.tool(annotations=READ_ONLY)
    async def triage_prs(base: str | None = None, repo: str | None = None,
                         project_path: str | None = None) -> str | dict:
        """Return all actionable open PRs (correct base, not stale) with full graph impact data so
        you can reason about review priority, merge order, and conflict risk.

        `base`: nhánh gốc (tự dò nếu bỏ trống). `repo`: chủ/tên repo trên GitHub (mặc định repo
        hiện tại). Chưa có `.nexgraph/graph.json` → JSON của NexGraph (hàng đợi review theo luật).
        """
        def work() -> str | dict:
            text = vendor_text("triage_prs", {"base": base, "repo": repo}, project_path)
            if text is not None:
                return text
            return run_sync("triage_prs", lambda s: pr_call(lambda: triage_json(
                list_prs_json(s, root, model=ModelGraph(s, root)))))

        return await _offload("triage_prs", work)

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
    from nexgraph_engine.analysis.global_graph.link import cross_repo_edges, visible_cross_repo
    from nexgraph_engine.analysis.global_graph.store import GlobalStore

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


class _PreInitFilter(io.TextIOBase):
    """Lọc stdin stdio: chặn message SDK sẽ nuốt cả chục dòng validation ra stderr.

    Claude Code 2.1.330 gửi probe `server/discover` trước initialize; SDK từ chối và in cả chục dòng
    validation ra stderr, client tưởng server hỏng rồi respawn (A4-F1). Method lạ — trước hay sau
    initialize — nhận MethodNotFound một dòng; batch JSON-RPC (SDK không hỗ trợ, làm chết vòng đọc)
    nhận -32600 cho từng request. `ping` được đi qua vì spec cho phép ping trước initialize.
    """

    def __init__(self, inner: Any, out: Any) -> None:
        self._inner = inner
        self._out = out

    def readline(self, size: int = -1) -> str:
        while True:
            line = self._inner.readline() if size < 0 else self._inner.readline(size)
            if not line:
                return line
            try:
                message = json.loads(line)
            except (TypeError, ValueError):
                return line
            if isinstance(message, list):  # batch: SDK không hỗ trợ và dừng đọc cả stream
                for item in message:
                    if isinstance(item, dict) and "id" in item:
                        self._reply(item["id"], -32600, "Invalid Request: JSON-RPC batch không được hỗ trợ")
                continue
            if not isinstance(message, dict):
                return line
            method = message.get("method")
            if method is None or method in _known_methods():
                return line
            if "id" in message:  # request lạ: trả lỗi JSON-RPC một dòng, không để SDK dump stack
                self._reply(message["id"], -32601, f"Method not found: {method}")
            # notification lạ: bỏ im lặng

    def _reply(self, request_id: Any, code: int, text: str) -> None:
        body = {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": text}}
        self._out.write((json.dumps(body, ensure_ascii=False) + "\n").encode("utf-8"))
        self._out.flush()

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)


_KNOWN_METHODS: frozenset[str] | None = None


def _known_methods() -> frozenset[str]:
    """Tên method SDK thật sự biết (đọc từ `mcp.types`), để không chặn method mới khi nâng SDK."""
    global _KNOWN_METHODS
    if _KNOWN_METHODS is None:
        from mcp import types

        found: set[str] = set()
        for name in dir(types):
            obj = getattr(types, name)
            field = getattr(obj, "model_fields", {}).get("method") if isinstance(obj, type) else None
            for literal in getattr(getattr(field, "annotation", None), "__args__", ()):
                if isinstance(literal, str):
                    found.add(literal)
        _KNOWN_METHODS = frozenset(found)
    return _KNOWN_METHODS


def _run_stdio_quiet(mcp: Any) -> None:
    import sys
    from io import TextIOWrapper

    stdin = anyio.wrap_file(_PreInitFilter(
        TextIOWrapper(sys.stdin.buffer, encoding="utf-8", errors="replace"), sys.stdout.buffer))
    anyio.run(_serve_stdio, mcp, stdin)


async def _serve_stdio(mcp: Any, stdin: Any) -> None:
    from mcp.server.stdio import stdio_server

    async with stdio_server(stdin=stdin) as (read_stream, write_stream):
        await mcp._mcp_server.run(read_stream, write_stream, mcp._mcp_server.create_initialization_options())


def run_stdio(project: Path, data_dir: Path | None, global_graph: bool = False) -> int:
    _run_stdio_quiet(build_server(project, data_dir, global_graph=global_graph))
    return 0

