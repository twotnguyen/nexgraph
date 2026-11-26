"""Route HTTP cho luồng thực thi (F11)."""
from __future__ import annotations

from fastapi import APIRouter, Query, Request

from nexgraph_engine.interfaces.api.errors import ApiError
from nexgraph_engine.interfaces.api.routes_graph import for_model, model_payload, open_store
from nexgraph_engine.analysis.flows.query import flow_json, list_flows_json
from nexgraph_engine.analysis.query.model_view import ModelGraph
from nexgraph_engine.analysis.report.i18n import check_lang
from nexgraph_engine.analysis.tour.build import build_tour

router = APIRouter(prefix="/v1/projects/{project_id}")


@router.get("/flows")
def get_flows(
    project_id: str,
    request: Request,
    q: str | None = Query(None),
    kind: str | None = Query(None),
    node: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    with open_store(request, project_id) as (store, info):
        flows = list_flows_json(store, q=q, kind=kind, node=node, limit=limit, offset=offset)
        return model_payload(request, store, info, flows)


@router.get("/flows/{flow_id}")
def get_flow(project_id: str, flow_id: int, request: Request) -> dict:
    with open_store(request, project_id) as (store, info):
        return model_payload(request, store, info, flow_json(store, flow_id))


@router.get("/tour")
def get_tour(project_id: str, request: Request, lang: str = Query("vi")) -> dict:
    """`lang=vi|en`: tour do engine sinh; mặc định `vi` như trước E4."""
    try:
        tour_lang = check_lang(lang, "vi")
    except ValueError as exc:
        raise ApiError(400, "bad_param", str(exc)) from exc
    with open_store(request, project_id) as (store, info):
        payload = build_tour(store, lang=tour_lang)
        if not for_model(request):
            return payload
        # `ModelGraph.filter` từ chối cả payload khi một bước bị bỏ (luồng có lỗ hổng); tour thì bỏ bước đó là đủ.
        return ModelGraph(store, info.path).filter_tour(payload)
