import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query, Request

from nexgraph_engine.api.errors import ApiError, open_graph_readonly
from nexgraph_engine.query.contracts import (
    get_node_json,
    neighbors_json,
    parse_edge_types,
    read_code,
    search_json,
    stats_json,
)
from nexgraph_engine.query.model_view import MODEL_AUDIENCE_HEADER, ModelGraph
from nexgraph_engine.query.source_policy import SourcePolicy, protected_source
from nexgraph_engine.sources import sources_root
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.projects import ProjectInfo

router = APIRouter(prefix="/v1/projects/{project_id}")


def for_model(request: Request) -> bool:
    return request.headers.get(MODEL_AUDIENCE_HEADER) == "model"


def model_payload(request: Request, store: GraphStore, info: ProjectInfo, value: Any) -> Any:
    return ModelGraph(store, info.path).filter(value) if for_model(request) else value


@contextmanager
def open_store(request: Request, project_id: str) -> Iterator[tuple[GraphStore, ProjectInfo]]:
    """Đọc bản đã công bố, kể cả khi đang dựng lại ở CSDL tạm."""
    info = request.app.state.services.registry.get(project_id)
    if info is None:
        raise ApiError(404, "unknown_project", f"Không có dự án {project_id}")
    try:
        conn = open_graph_readonly(info.graph_db)
    except (sqlite3.Error, OSError) as exc:
        raise ApiError(404, "graph_unavailable", f"Chưa có dữ liệu đồ thị: {exc}") from exc
    try:
        store = GraphStore(conn)
        if not store.has_published_graph():
            if request.app.state.services.jobs.is_active(project_id):
                raise ApiError(409, "index_running", "Dự án đang được lập chỉ mục, thử lại khi xong")
            raise ApiError(409, "not_indexed", "Dự án chưa được lập chỉ mục xong")
        yield store, info
    finally:
        conn.close()


@router.get("/stats")
def stats(project_id: str, request: Request) -> dict:
    with open_store(request, project_id) as (store, info):
        return stats_json(store, info.path, sources_root(request.app.state.services.data_dir, project_id))


@router.get("/nodes/{node_id:path}")
def get_node(project_id: str, node_id: str, request: Request) -> dict:
    with open_store(request, project_id) as (store, info):
        return model_payload(request, store, info, get_node_json(store, node_id))


@router.get("/neighbors")
def neighbors(project_id: str, request: Request, node: str = Query(...), types: str | None = None,
              direction: str = Query("both", pattern="^(in|out|both)$"), depth: int = Query(1, ge=1, le=3),
              limit: int = Query(500, ge=1, le=2000)) -> dict:
    wanted = parse_edge_types(types.split(",")) if types else None
    with open_store(request, project_id) as (store, info):
        if not for_model(request):
            return neighbors_json(store, node, wanted, direction, depth, limit)
        model = ModelGraph(store, info.path)
        if not model.allows_node(node):
            raise protected_source()
        return model.filter(neighbors_json(store, node, wanted, direction, depth, limit))


@router.get("/code")
def code(project_id: str, request: Request, file: str = Query(...), start: int | None = None,
         end: int | None = None) -> dict:
    with open_store(request, project_id) as (store, info):
        source = SourcePolicy(info.path, store.last_exclude()) if for_model(request) else None
        return read_code(store, info.path, file, start, end,
                         transcript_dir=request.app.state.services.registry.app_data_dir / "transcripts" / project_id,
                         source=source, sources_dir=sources_root(request.app.state.services.data_dir, project_id))


@router.get("/search")
def search_nodes(project_id: str, request: Request, q: str = Query(...), kinds: str | None = None,
                 limit: int = Query(20, ge=1, le=100)) -> list[dict]:
    with open_store(request, project_id) as (store, info):
        hits = search_json(store, q, kinds.split(",") if kinds else None, limit)
        return model_payload(request, store, info, hits)
