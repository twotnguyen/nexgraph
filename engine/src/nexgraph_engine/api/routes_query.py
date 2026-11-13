from typing import Literal

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field

from nexgraph_engine.api.errors import ApiError
from nexgraph_engine.api.routes_graph import open_store, require_indexed
from nexgraph_engine.query.ask import ask_graph
from nexgraph_engine.query.paths import find_paths, impact_of

router = APIRouter(prefix="/v1/projects/{project_id}")


class PathsBody(BaseModel):
    node_ids: list[str] = Field(min_length=2, max_length=10)
    max_hops: int = Field(4, ge=1, le=6)
    directed: bool = True


class AskBody(BaseModel):
    question: str
    depth: int = Field(2, ge=1, le=6)
    budget: int = Field(2000, ge=1, le=100_000)
    mode: Literal["bfs", "dfs"] = "bfs"


@router.post("/paths")
def paths(project_id: str, request: Request, body: PathsBody) -> dict:
    with open_store(request, project_id) as (store, _):
        require_indexed(store)
        try:
            return find_paths(store, body.node_ids, body.max_hops, body.directed)
        except KeyError as exc:
            raise ApiError(404, "unknown_node", f"Không có nút {exc.args[0]}") from exc


@router.get("/impact")
def impact(project_id: str, request: Request, node: str = Query(...)) -> dict:
    with open_store(request, project_id) as (store, _):
        require_indexed(store)
        try:
            return impact_of(store, node)
        except KeyError as exc:
            raise ApiError(404, "unknown_node", f"Không có nút {node}") from exc


@router.post("/ask")
def ask(project_id: str, request: Request, body: AskBody) -> dict:
    with open_store(request, project_id) as (store, _):
        require_indexed(store)
        try:
            return ask_graph(store, body.question, body.depth, body.budget, body.mode)
        except ValueError as exc:
            raise ApiError(400, "bad_param", str(exc)) from exc
