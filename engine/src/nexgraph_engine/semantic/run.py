"""Hàm `work(ctx)` của job `semantic` cho `JobManager.start_task`.

Job giữ khoá dự án (start_task) và khoá ghi `graph_writer` suốt lúc chạy. Mỗi khối được kiểm rồi ghi trong một
transaction cùng dòng cache, sau khi đã xem cờ huỷ: huỷ giữa chừng chỉ mất các khối chưa ghi, không có khối ghi dở.
"""
from __future__ import annotations

import threading
from collections.abc import Callable
from contextlib import closing
from dataclasses import dataclass, field

from graphify.llm import _LLM_JSON_MAX_BYTES

from nexgraph_engine.index.jobs import TaskCancelled, TaskContext
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.semantic import cache, ingest
from nexgraph_engine.semantic.chunks import Chunk, Sources, plan
from nexgraph_engine.semantic.transport import ChunkError, DirectTransport, LlmQueue
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.publication import graph_writer


@dataclass
class Request:
    target: str
    budget: int
    prs: list[dict] = field(default_factory=list)
    no_cache: bool = False  # chạy lại: vẫn ghi cache mới nhưng không đọc cache cũ


def estimate(chunks: list[Chunk], store: GraphStore, *, no_cache: bool = False) -> dict:
    todo = [c for c in chunks if no_cache or cache.get(store.conn, c.key) is None]
    return {"files": sorted({f for c in chunks for f in c.files}), "chunks": len(chunks),
            "cached_chunks": len(chunks) - len(todo), "input_tokens": sum(c.input_tokens for c in todo),
            "output_tokens": sum(c.output_tokens for c in todo)}


def _apply(store: GraphStore, req: Request, chunk: Chunk, value, result: dict) -> None:
    """Ghi kết quả đã kiểm của một khối (caller giữ transaction)."""
    if req.target in ("docs", "deep", "images"):
        nodes, edges = ingest.write_fragment(store, chunk.files, value)
        result["nodes_added"] += nodes
        result["edges_added"] += edges
    elif req.target == "labels":
        result["labels"].update({str(k): v for k, v in ingest.write_labels(store, chunk.meta, value).items()})
    elif req.target == "pr_triage":
        result["triage"] = value  # không ghi graph: W7 đọc từ result của job


def _parse(req: Request, chunk: Chunk, text: str):
    """Mọi lỗi khi đọc kết quả (kể cả JSON lồng quá sâu → RecursionError, MemoryError) chỉ làm hỏng khối này."""
    if len(text) > _LLM_JSON_MAX_BYTES:
        raise ChunkError("Kết quả của model quá lớn")
    try:
        if req.target == "labels":
            return ingest.parse_labels(text, list(chunk.meta))
        if req.target == "pr_triage":
            return ingest.parse_triage(text, chunk.meta["numbers"])
        return ingest.parse_fragment(text)
    except ChunkError:
        raise
    except (Exception, RecursionError, MemoryError) as exc:  # noqa: BLE001 — đầu ra của model là dữ liệu không tin cậy
        raise ChunkError(f"Không đọc được kết quả của model ({type(exc).__name__})") from None


def _complete(transport: DirectTransport, chunk: Chunk, cancel: threading.Event) -> tuple[str, int, int]:
    """Gọi model trong luồng riêng, xem cờ huỷ mỗi 0,5 s: huỷ thì bỏ kết quả, không chờ hết timeout HTTP."""
    box: dict = {}

    def call() -> None:
        try:
            box["ok"] = transport.complete(chunk)
        except BaseException as exc:  # noqa: BLE001 — chuyển lỗi về luồng job
            box["err"] = exc

    thread = threading.Thread(target=call, daemon=True, name=f"semantic-{chunk.id}")
    thread.start()
    while thread.is_alive():
        thread.join(0.5)
        if cancel.is_set():
            raise TaskCancelled
    if "err" in box:
        raise box["err"]
    return box["ok"]


def make_work(*, graph_db, src: Sources, req: Request, transport: DirectTransport | LlmQueue,
              on_written: Callable[[], None]) -> Callable[[TaskContext], dict]:
    def work(ctx: TaskContext) -> dict:
        result = {"target": req.target, "nodes_added": 0, "edges_added": 0, "labels": {}, "triage": None,
                  "merged": 0, "errors": [], "usage": {"input_tokens": 0, "output_tokens": 0},
                  "chunks": {"total": 0, "cached": 0, "sent": 0, "done": 0, "failed": 0, "skipped_budget": 0}}
        stats = result["chunks"]
        try:
            with graph_writer(graph_db) as db, closing(open_graph_db(db)) as conn:
                store = GraphStore(conn)
                if req.target == "dedup":
                    with conn:
                        result["merged"] = ingest.dedup_concepts(store, src.root)
                    if result["merged"]:
                        on_written()
                    return result
                chunks = plan(req.target, store, src, req.prs)
                stats["total"] = len(chunks)
                todo: list[Chunk] = []
                spent = 0
                for chunk in chunks:
                    if ctx.cancel.is_set():
                        raise TaskCancelled
                    hit = None if req.no_cache else cache.get(conn, chunk.key)
                    if hit is not None:
                        with conn:
                            _apply(store, req, chunk, hit, result)
                        stats["cached"] += 1
                    elif spent + chunk.input_tokens + chunk.output_tokens > req.budget:
                        stats["skipped_budget"] += 1
                    else:
                        spent += chunk.input_tokens + chunk.output_tokens
                        todo.append(chunk)
                done = stats["cached"]
                ctx.progress(done, len(chunks), "Đang phân tích bằng AI")

                def handle(chunk: Chunk, text: str | None, error: str | None) -> None:
                    nonlocal done
                    try:
                        if error is not None:
                            raise ChunkError(error[:500])
                        value = _parse(req, chunk, text or "")
                        if ctx.cancel.is_set():
                            raise TaskCancelled
                        with conn:  # một transaction: kết quả + dòng cache
                            _apply(store, req, chunk, value, result)
                            cache.put(conn, chunk.key, value)
                        stats["done"] += 1
                    except ChunkError as exc:
                        stats["failed"] += 1
                        result["errors"].append({"chunk_id": chunk.id, "files": chunk.files, "message": str(exc)})
                    done += 1
                    ctx.progress(done, len(chunks), "Đang phân tích bằng AI")

                if isinstance(transport, LlmQueue):
                    transport.offer(todo)
                    stats["sent"] = len(todo)
                    remaining = {c.id: c for c in todo}
                    if remaining:
                        ctx.set_state("waiting_llm")
                    while remaining:
                        if ctx.cancel.is_set():
                            raise TaskCancelled
                        answer = transport.wait(0.1)
                        if answer is not None and answer[0] in remaining:
                            handle(remaining.pop(answer[0]), answer[1], answer[2])
                    ctx.set_state("running")
                else:
                    for chunk in todo:
                        if ctx.cancel.is_set():
                            raise TaskCancelled
                        stats["sent"] += 1
                        try:
                            text, used_in, used_out = _complete(transport, chunk, ctx.cancel)
                        except ChunkError as exc:
                            handle(chunk, None, str(exc))
                            continue
                        result["usage"]["input_tokens"] += used_in
                        result["usage"]["output_tokens"] += used_out
                        handle(chunk, text, None)
        finally:
            if isinstance(transport, LlmQueue):
                transport.close()
            if result["nodes_added"] or result["edges_added"] or result["labels"]:
                on_written()
        return result

    return work
