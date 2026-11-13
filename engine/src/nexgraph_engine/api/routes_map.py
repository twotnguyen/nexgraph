"""Route bản đồ toàn cảnh và vòng phụ thuộc (F12)."""
from fastapi import APIRouter, Query, Request

from nexgraph_engine.api.errors import ApiError
from nexgraph_engine.api.routes_graph import open_store, require_indexed
from nexgraph_engine.arch.builder import UnknownBlock
from nexgraph_engine.arch.cycles import import_cycles
from nexgraph_engine.arch.map import build_map

router = APIRouter(prefix="/v1/projects/{project_id}")


def map_json(conn, parent: str | None, detail: int) -> dict:
    try:
        return build_map(conn, parent or None, detail)
    except UnknownBlock as exc:
        raise ApiError(404, "unknown_block", f"Không có khối {parent}") from exc


@router.get("/map")
def project_map(project_id: str, request: Request, parent: str | None = None,
                detail: int = Query(400, ge=50, le=1500)) -> dict:
    with open_store(request, project_id) as (store, _):
        require_indexed(store, request, project_id)
        return map_json(store.conn, parent, detail)


@router.get("/cycles")
def project_cycles(project_id: str, request: Request, limit: int = Query(20, ge=1, le=100)) -> dict:
    with open_store(request, project_id) as (store, _):
        require_indexed(store, request, project_id)
        return import_cycles(store.conn, limit)
