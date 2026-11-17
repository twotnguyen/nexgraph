from fastapi import APIRouter, Query, Request

from nexgraph_engine.api.routes_graph import open_store
from nexgraph_engine.query.contracts import architecture_json, evidence_json

router = APIRouter(prefix="/v1/projects/{project_id}")


@router.get("/architecture")
def architecture(project_id: str, request: Request, parent: str | None = None) -> dict:
    with open_store(request, project_id) as (store, _):
        return architecture_json(store.conn, parent)


@router.get("/architecture/evidence")
def architecture_evidence(project_id: str, request: Request, from_: str = Query(..., alias="from"),
                          to: str = Query(...), limit: int = Query(50, ge=1, le=200)) -> list[dict]:
    with open_store(request, project_id) as (store, _):
        return evidence_json(store.conn, from_, to, limit)
