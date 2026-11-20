from fastapi import APIRouter, Request

from nexgraph_engine.api.routes_graph import open_store
from nexgraph_engine.report.build import report_json
from nexgraph_engine.sources import sources_root

router = APIRouter(prefix="/v1/projects/{project_id}")


@router.get("/report")
def report(project_id: str, request: Request) -> dict:
    with open_store(request, project_id) as (store, info):
        return report_json(store, info.path, sources_dir=sources_root(request.app.state.services.data_dir, project_id))
