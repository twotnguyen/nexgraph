"""Route bản đồ toàn cảnh và vòng phụ thuộc (F12)."""
from fastapi import APIRouter, Query, Request

from nexgraph_engine.api.errors import ApiError
from nexgraph_engine.api.routes_graph import for_model, model_payload, open_store
from nexgraph_engine.arch.builder import UnknownBlock
from nexgraph_engine.arch.cycles import import_cycles
from nexgraph_engine.arch.map import build_map
from nexgraph_engine.query.model_view import ModelGraph

router = APIRouter(prefix="/v1/projects/{project_id}")


def map_json(conn, parent: str | None, detail: int) -> dict:
    try:
        return build_map(conn, parent or None, detail)
    except UnknownBlock as exc:
        raise ApiError(404, "unknown_block", f"Không có khối {parent}") from exc


@router.get("/map")
def project_map(project_id: str, request: Request, parent: str | None = None,
                detail: int = Query(400, ge=50, le=1500)) -> dict:
    with open_store(request, project_id) as (store, info):
        payload = map_json(store.conn, parent, detail)
        filtered = model_payload(request, store, info, payload)
        if filtered is not payload:  # tổng số phải khớp các khối còn lại, không đếm cả khối bị ẩn
            nodes = filtered["nodes"]
            filtered["totals"] = {"files": sum(node.get("files", 0) for node in nodes), "nodes": len(nodes)}
        return filtered


@router.get("/cycles")
def project_cycles(project_id: str, request: Request, limit: int = Query(20, ge=1, le=100)) -> dict:
    with open_store(request, project_id) as (store, info):
        payload = import_cycles(store.conn, limit)
        if not for_model(request):
            return payload
        # Danh sách tệp trần nên `ModelGraph.filter` không lọc được: bỏ cả chu trình có tệp bị loại.
        return ModelGraph(store, info.path).filter_cycles(payload)
