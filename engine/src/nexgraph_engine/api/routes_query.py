from typing import Literal

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field

from nexgraph_engine.api.errors import ApiError
from nexgraph_engine.api.routes_graph import for_model, model_payload, open_store
from nexgraph_engine.query.ask import ask_graph
from nexgraph_engine.query.context import build_context, locate_json
from nexgraph_engine.query.paths import find_paths, impact_of
from nexgraph_engine.query.section import section_json
from nexgraph_engine.query.source_policy import SourcePolicy

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
    with open_store(request, project_id) as (store, _):
        try:
            return find_paths(store, body.node_ids, body.max_hops, body.directed)
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
    with open_store(request, project_id) as (store, _):
        try:
            return ask_graph(store, body.question, body.depth, body.budget, body.mode)
        except ValueError as exc:
            raise ApiError(400, "bad_param", str(exc)) from exc


@router.post("/context")
def context(project_id: str, request: Request, body: ContextBody) -> dict:
    with open_store(request, project_id) as (store, info):
        try:
            return build_context(store, info.path, body.question, body.budget)
        except ValueError as exc:
            raise ApiError(400, "bad_param", str(exc)) from exc


@router.get("/locate")
def locate(project_id: str, request: Request, file: str = Query(...), line: int = Query(..., ge=1)) -> dict:
    with open_store(request, project_id) as (store, _):
        return locate_json(store, file, line)


@router.get("/section")
def section(project_id: str, request: Request, node: str = Query(...)) -> dict:
    with open_store(request, project_id) as (store, info):
        source = SourcePolicy(info.path, store.last_exclude()) if for_model(request) else None
        return section_json(store, info.path, node, source=source,
                            transcript_dir=request.app.state.services.registry.app_data_dir / "transcripts" / project_id)
