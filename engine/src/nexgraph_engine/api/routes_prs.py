"""Pull request của GitHub (W7): trạng thái `gh`, danh sách PR, ảnh hưởng và review cục bộ của một PR. Chỉ đọc."""
from __future__ import annotations

from fastapi import APIRouter, Query, Request

from nexgraph_engine.api.errors import ApiError
from nexgraph_engine.api.routes_graph import for_model, model_payload, open_store
from nexgraph_engine.prs import gh
from nexgraph_engine.prs.listing import MAX_LIST, gh_status, list_prs_json
from nexgraph_engine.prs.review import pr_detail_json
from nexgraph_engine.query.model_view import ModelGraph

router = APIRouter(prefix="/v1/projects/{project_id}/prs")


def _model(request: Request, store, info) -> ModelGraph | None:
    # Lọc trước khi dựng chuỗi (nhận xét, danh sách tệp): ModelGraph.filter ở cuối không nhìn vào trong chuỗi.
    return ModelGraph(store, info.path) if for_model(request) else None


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
            return model_payload(request, store, info, list_prs_json(store, info.path, limit, model=_model(request, store, info)))
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
            return model_payload(request, store, info, pr_detail_json(store, info.path, n, model=_model(request, store, info)))
        except gh.GhError as exc:
            raise exc.api_error() from exc
