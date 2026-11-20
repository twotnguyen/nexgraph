"""Bộ nhớ làm việc và Memory neo vào node (W10). Ghi qua `memory.writer` (khoá ghi của dự án)."""
from __future__ import annotations

import sqlite3
from collections.abc import Callable
from typing import Literal

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field

from nexgraph_engine import memory
from nexgraph_engine.api.errors import ApiError
from nexgraph_engine.api.routes_graph import open_store
from nexgraph_engine.query.context import locate_json
from nexgraph_engine.store.graph_store import GraphStore

router = APIRouter(prefix="/v1/projects/{project_id}")


class MemoryBody(BaseModel):
    kind: str = Field(max_length=32)
    text: str = Field(max_length=memory.MAX_TEXT)
    node_ids: list[str] = Field(default_factory=list, max_length=memory.MAX_NODES)


class CitationBody(BaseModel):
    file: str = Field(min_length=1, max_length=2048)
    line: int = Field(ge=1)


class RatingBody(BaseModel):
    question: str = Field(max_length=memory.MAX_TEXT)
    answer: str = Field(max_length=200_000)
    outcome: Literal["huu_ich", "ngo_cut", "da_sua"]
    correction: str | None = Field(None, max_length=memory.MAX_TEXT)
    citations: list[CitationBody] = Field(default_factory=list, max_length=200)


def _write(request: Request, project_id: str, body: Callable[[sqlite3.Connection], dict]) -> dict:
    services = request.app.state.services
    info = services.registry.get(project_id)
    if info is None:
        raise ApiError(404, "unknown_project", f"Không có dự án {project_id}")
    if services.jobs.is_active(project_id):
        raise ApiError(409, "index_running", "Dự án đang được lập chỉ mục, thử lại khi xong")
    try:
        with memory.writer(info.graph_db) as conn:
            return body(conn)
    except memory.MemoryBusy as exc:
        raise ApiError(409, "index_running", str(exc)) from exc
    except ValueError as exc:
        raise ApiError(400, "bad_param", str(exc)) from exc


def _cited_nodes(conn: sqlite3.Connection, citations: list[CitationBody]) -> list[str]:
    store, ids = GraphStore(conn), []
    for c in citations:
        try:
            node_id = locate_json(store, c.file, c.line)["node"]["id"]
        except ApiError:
            continue  # trích dẫn tới tệp chưa lập chỉ mục: bỏ qua
        if node_id not in ids:
            ids.append(node_id)
    return ids[:memory.MAX_NODES]


@router.get("/memory")
def recall(project_id: str, request: Request, node: str | None = Query(None, max_length=2048),
           q: str | None = Query(None, max_length=memory.MAX_TEXT), limit: int = Query(50, ge=1, le=200)) -> dict:
    with open_store(request, project_id) as (store, _):
        try:
            return memory.recall(store.conn, query=q, node_id=node, limit=limit)
        except ValueError as exc:
            raise ApiError(400, "bad_param", str(exc)) from exc


@router.post("/memory")
def add_memory(project_id: str, body: MemoryBody, request: Request) -> dict:
    return _write(request, project_id, lambda conn: memory.remember(conn, body.kind, body.text, body.node_ids, "nguoi_dung"))


@router.post("/memory/ratings")
def add_rating(project_id: str, body: RatingBody, request: Request) -> dict:
    return _write(request, project_id, lambda conn: memory.rate(
        conn, body.question, body.answer, body.outcome, _cited_nodes(conn, body.citations), body.correction))


@router.get("/lessons")
def get_lessons(project_id: str, request: Request) -> dict:
    with open_store(request, project_id) as (store, _):
        return memory.lessons(store.conn)
