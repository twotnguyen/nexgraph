from fastapi import APIRouter, Query, Request

from nexgraph_engine.api.errors import ApiError
from nexgraph_engine.api.routes_graph import model_payload, open_store
from nexgraph_engine.pipeline.job_manager import UnknownProject
from nexgraph_engine.query.contracts import changes_json

router = APIRouter(prefix="/v1/projects/{project_id}")


@router.post("/refresh")
def refresh(project_id: str, request: Request) -> dict:
    try:
        return request.app.state.services.refresh.refresh(project_id)
    except UnknownProject as exc:
        raise ApiError(404, "unknown_project", f"Không có dự án {project_id}") from exc


@router.get("/changes")
def changes(project_id: str, request: Request, refresh: bool = Query(True)) -> dict:
    if refresh:
        try:
            request.app.state.services.refresh.refresh(project_id)  # `skipped` vẫn đọc được thay đổi từ đồ thị hiện có
        except UnknownProject as exc:
            raise ApiError(404, "unknown_project", f"Không có dự án {project_id}") from exc
    with open_store(request, project_id) as (store, info):
        return model_payload(request, store, info, changes_json(store, info.path))

