from fastapi import APIRouter, Request

from nexgraph_engine.api.routes_graph import for_model, open_store
from nexgraph_engine.query.model_view import ModelGraph
from nexgraph_engine.query.source_policy import SourcePolicy
from nexgraph_engine.report.build import report_json
from nexgraph_engine.sources import sources_root

router = APIRouter(prefix="/v1/projects/{project_id}")


@router.get("/report")
def report(project_id: str, request: Request) -> dict:
    with open_store(request, project_id) as (store, info):
        source = SourcePolicy(info.path, store.last_exclude()) if for_model(request) else None
        payload = report_json(store, info.path, source,
                              sources_dir=sources_root(request.app.state.services.data_dir, project_id))
        if source is None:
            return payload
        model = ModelGraph(store, info.path, source=source)
        return model.filter(model.filter_cycles(payload))
