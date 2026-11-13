from fastapi import APIRouter, Request

from nexgraph_engine.api.routes_graph import open_store, require_indexed
from nexgraph_engine.report.build import report_json

router = APIRouter(prefix="/v1/projects/{project_id}")


@router.get("/report")
def report(project_id: str, request: Request) -> dict:
    with open_store(request, project_id) as (store, _):
        require_indexed(store, request, project_id)
        return report_json(store)
