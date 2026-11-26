from typing import Literal

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field

from nexgraph_engine.interfaces.api.errors import ApiError
from nexgraph_engine.interfaces.api.routes_graph import for_model, model_payload, open_store
from nexgraph_engine.analysis.query.ask import ask_graph
from nexgraph_engine.analysis.query.context import build_context, locate_json
from nexgraph_engine.analysis.query.explain import explain_json
from nexgraph_engine.analysis.query.paths import find_paths, impact_of
from nexgraph_engine.analysis.query.section import section_json
from nexgraph_engine.analysis.query.model_view import ModelGraph
from nexgraph_engine.analysis.query.source_policy import SourcePolicy, protected_source
from nexgraph_engine.indexing.sources import sources_root

router = APIRouter(prefix="/v1/projects/{project_id}")


class PathsBody(BaseModel):
    node_ids: list[str] = Field(min_length=2, max_length=10)
    max_hops: int = Field(4, ge=1, le=6)
    directed: bool = True


class ContextBody(BaseModel):
    question: str
    budget: int = Field(4000, ge=500, le=20_000)


class AskBody(BaseModel):
    question: str
    depth: int = Field(2, ge=1, le=6)
    budget: int = Field(2000, ge=1, le=100_000)
    mode: Literal["bfs", "dfs"] = "bfs"


@router.get("/ai/source-scope")
def ai_source_scope(project_id: str, request: Request) -> dict:
    with open_store(request, project_id) as (store, _):
        return {"exclude": store.last_exclude()}


@router.post("/paths")
def paths(project_id: str, request: Request, body: PathsBody) -> dict:
    with open_store(request, project_id) as (store, info):
        if for_model(request):
            model = ModelGraph(store, info.path)
            if not all(model.allows_node(node_id) for node_id in body.node_ids):
                raise protected_source()
        try:
            return model_payload(request, store, info, find_paths(store, body.node_ids, body.max_hops, body.directed))
        except KeyError as exc:
            raise ApiError(404, "unknown_node", f"Không có nút {exc.args[0]}") from exc


@router.get("/impact")
def impact(project_id: str, request: Request, node: str = Query(...)) -> dict:
    with open_store(request, project_id) as (store, info):
        try:
            return model_payload(request, store, info, impact_of(store, node))
        except KeyError as exc:
            raise ApiError(404, "unknown_node", f"Không có nút {node}") from exc


@router.post("/ask")
def ask(project_id: str, request: Request, body: AskBody) -> dict:
    with open_store(request, project_id) as (store, info):
        try:
            return model_payload(request, store, info, ask_graph(store, body.question, body.depth, body.budget, body.mode))
        except ValueError as exc:
            raise ApiError(400, "bad_param", str(exc)) from exc


@router.post("/context")
def context(project_id: str, request: Request, body: ContextBody) -> dict:
    with open_store(request, project_id) as (store, info):
        try:
            return build_context(store, info.path, body.question, body.budget,
                                 sources_dir=sources_root(request.app.state.services.data_dir, project_id),
                                 redact_documents=for_model(request))
        except ValueError as exc:
            raise ApiError(400, "bad_param", str(exc)) from exc


@router.get("/locate")
def locate(project_id: str, request: Request, file: str = Query(...), line: int = Query(..., ge=1)) -> dict:
    with open_store(request, project_id) as (store, info):
        if for_model(request) and not SourcePolicy(info.path, store.last_exclude()).allows(file):
            raise protected_source()
        return model_payload(request, store, info, locate_json(store, file, line))


@router.get("/section")
def section(project_id: str, request: Request, node: str = Query(...)) -> dict:
    with open_store(request, project_id) as (store, info):
        # Đường tới model dùng policy strict: tài liệu tên nhạy cảm bị từ chối như trên main, không miễn theo tên.
        # Đường UI (không phải model) vẫn trả bản đã che.
        source = SourcePolicy(info.path, store.last_exclude()) if for_model(request) else None
        return section_json(store, info.path, node, source=source,
                            transcript_dir=request.app.state.services.registry.app_data_dir / "transcripts" / project_id,
                            sources_dir=sources_root(request.app.state.services.data_dir, project_id))


@router.get("/explain")
def explain(project_id: str, request: Request, node: str = Query(...), limit: int = Query(20, ge=1, le=200)) -> dict:
    with open_store(request, project_id) as (store, info):
        return model_payload(request, store, info, explain_json(store, node, limit))
