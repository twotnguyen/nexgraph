"""Route HTTP cho luồng thực thi (F11)."""
from __future__ import annotations

from fastapi import APIRouter, Query, Request

from nexgraph_engine.api.routes_graph import open_store, require_indexed
from nexgraph_engine.flows.query import flow_json, list_flows_json
from nexgraph_engine.tour.build import build_tour

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
    with open_store(request, project_id) as (store, _):
        require_indexed(store, request, project_id)
        return list_flows_json(store, q=q, kind=kind, node=node, limit=limit, offset=offset)


@router.get("/flows/{flow_id}")
def get_flow(project_id: str, flow_id: int, request: Request) -> dict:
    with open_store(request, project_id) as (store, _):
        require_indexed(store, request, project_id)
        return flow_json(store, flow_id)


@router.get("/tour")
def get_tour(project_id: str, request: Request) -> dict:
    with open_store(request, project_id) as (store, _):
        require_indexed(store, request, project_id)
        return build_tour(store)
