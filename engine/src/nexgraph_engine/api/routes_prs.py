"""Pull request của GitHub (W7): trạng thái `gh`, danh sách PR, ảnh hưởng và review cục bộ của một PR. Chỉ đọc."""
from __future__ import annotations

from fastapi import APIRouter, Query, Request

from nexgraph_engine.api.errors import ApiError
from nexgraph_engine.api.routes_graph import model_payload, open_store
from nexgraph_engine.prs import gh
from nexgraph_engine.prs.listing import MAX_LIST, gh_status, list_prs_json
from nexgraph_engine.prs.review import pr_detail_json

router = APIRouter(prefix="/v1/projects/{project_id}/prs")


@router.get("/status")
def status(project_id: str, request: Request) -> dict:
    info = request.app.state.services.registry.get(project_id)
    if info is None:
        raise ApiError(404, "unknown_project", f"Không có dự án {project_id}")
    return gh_status(info.path)


@router.get("")
def list_prs(project_id: str, request: Request, limit: int = Query(50, ge=1, le=MAX_LIST)) -> dict:
    with open_store(request, project_id) as (store, info):
        try:
            return model_payload(request, store, info, list_prs_json(store, info.path, limit))
        except gh.GhError as exc:
            raise exc.api_error() from exc


@router.get("/{number}")
def pr_detail(project_id: str, number: str, request: Request) -> dict:
    try:
        n = gh.pr_number(number)
    except ValueError as exc:
        raise ApiError(400, "bad_param", str(exc)) from exc
    with open_store(request, project_id) as (store, info):
        try:
            return model_payload(request, store, info, pr_detail_json(store, info.path, n,
                                                                        data_dir=request.app.state.services.data_dir))
        except gh.GhError as exc:
            raise exc.api_error() from exc
