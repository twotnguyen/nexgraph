import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from fastapi import APIRouter, Query, Request

from nexgraph_engine.api.errors import ApiError
from nexgraph_engine.query.contracts import (
    get_node_json,
    neighbors_json,
    parse_edge_types,
    read_code,
    search_json,
    stats_json,
)
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.projects import ProjectInfo

router = APIRouter(prefix="/v1/projects/{project_id}")


@contextmanager
def open_store(request: Request, project_id: str) -> Iterator[tuple[GraphStore, ProjectInfo]]:
    info = request.app.state.services.registry.get(project_id)
    if info is None:
        raise ApiError(404, "unknown_project", f"Không có dự án {project_id}")
    try:
        conn = open_graph_db(info.graph_db, read_only=True)
    except (sqlite3.Error, OSError) as exc:
        raise ApiError(404, "graph_unavailable", f"Chưa có dữ liệu đồ thị: {exc}") from exc
    try:
        yield GraphStore(conn), info
    finally:
        conn.close()


def require_indexed(store: GraphStore, request: Request, project_id: str) -> None:
    """Báo cáo, export, truy vấn trên CSDL rỗng hoặc dở dang sẽ cho kết quả gây hiểu nhầm: báo lỗi rõ thay vào đó.
    Index lại đầy đủ xoá đồ thị trước khi dựng, nên đang chạy hoặc lần gần nhất bị huỷ/lỗi đều không dùng được."""
    if request.app.state.services.jobs.is_active(project_id):
        raise ApiError(409, "index_running", "Dự án đang được lập chỉ mục, thử lại khi xong")
    last_full = store.conn.execute(
        "SELECT trang_thai FROM lan_lap_chi_muc WHERE loai = 'day_du' ORDER BY ma_lan DESC LIMIT 1").fetchone()
    if last_full is None or last_full[0] != "hoan_tat":
        raise ApiError(409, "not_indexed", "Dự án chưa được lập chỉ mục xong")


@router.get("/stats")
def stats(project_id: str, request: Request) -> dict:
    with open_store(request, project_id) as (store, info):
        return stats_json(store, info.path)


@router.get("/nodes/{node_id:path}")
def get_node(project_id: str, node_id: str, request: Request) -> dict:
    with open_store(request, project_id) as (store, _):
        return get_node_json(store, node_id)


@router.get("/neighbors")
def neighbors(project_id: str, request: Request, node: str = Query(...), types: str | None = None,
              direction: str = Query("both", pattern="^(in|out|both)$"), depth: int = Query(1, ge=1, le=3),
              limit: int = Query(500, ge=1, le=2000)) -> dict:
    wanted = parse_edge_types(types.split(",")) if types else None
    with open_store(request, project_id) as (store, _):
        return neighbors_json(store, node, wanted, direction, depth, limit)


@router.get("/code")
def code(project_id: str, request: Request, file: str = Query(...), start: int | None = None,
         end: int | None = None) -> dict:
    with open_store(request, project_id) as (store, info):
        return read_code(store, info.path, file, start, end,
                         transcript_dir=request.app.state.services.registry.app_data_dir / "transcripts" / project_id)


@router.get("/search")
def search_nodes(project_id: str, request: Request, q: str = Query(...), kinds: str | None = None,
                 limit: int = Query(20, ge=1, le=100)) -> list[dict]:
    with open_store(request, project_id) as (store, _):
        return search_json(store, q, kinds.split(",") if kinds else None, limit)
