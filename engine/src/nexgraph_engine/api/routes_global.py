"""Graph chung nhiều repo (W8): thành viên, tìm kiếm chung, graph gộp chỉ đọc, xuất graph.json gộp."""
from __future__ import annotations

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field

from nexgraph_engine.api.errors import ApiError
from nexgraph_engine.api.routes_export import _writable_dir
from nexgraph_engine.global_graph.link import open_members
from nexgraph_engine.global_graph.store import GlobalStore
from nexgraph_engine.global_graph.view import export_global, graph_global, search_global

router = APIRouter(prefix="/v1/global")


class MemberBody(BaseModel):
    project_id: str = Field(min_length=36, max_length=36)


class GlobalExportBody(BaseModel):
    out_dir: str
    projects: list[str] | None = Field(default=None, max_length=100)


def _ids(raw: str | None) -> list[str] | None:
    return [p for p in raw.split(",") if p] if raw else None


@router.get("/projects")
def list_members(request: Request) -> list[dict]:
    services = request.app.state.services
    out = []
    for pid, added in GlobalStore(services.data_dir).members():
        info = services.registry.get(pid)
        out.append({"project_id": pid, "name": info.name if info else None, "path": str(info.path) if info else None,
                    "added_at": added, "available": bool(info and info.path.is_dir() and info.graph_db.is_file())})
    return out


@router.post("/projects")
def add_member(body: MemberBody, request: Request) -> dict:
    services = request.app.state.services
    if services.registry.get(body.project_id) is None:
        raise ApiError(404, "unknown_project", f"Không có dự án {body.project_id}")
    GlobalStore(services.data_dir).add(body.project_id)
    return {"project_id": body.project_id, "job_id": services.relink_global()}


@router.delete("/projects/{project_id}")
def remove_member(project_id: str, request: Request) -> dict:
    services = request.app.state.services
    if not GlobalStore(services.data_dir).remove(project_id):  # cạnh của dự án mất ngay (ON DELETE CASCADE)
        raise ApiError(404, "not_member", f"Dự án {project_id} không nằm trong graph chung")
    return {"removed": True, "job_id": services.relink_global()}


@router.get("/search")
def global_search(request: Request, q: str = Query(...), limit: int = Query(20, ge=1, le=100),
                  projects: str | None = None) -> list[dict]:
    services = request.app.state.services
    with open_members(services.data_dir, services.registry, _ids(projects)) as (members, _):
        return search_global(members, q, limit)


@router.get("/graph")
def global_graph(request: Request, projects: str | None = None, limit: int = Query(400, ge=1, le=2000)) -> dict:
    services = request.app.state.services
    with open_members(services.data_dir, services.registry, _ids(projects)) as (members, skipped):
        cross = GlobalStore(services.data_dir).edges([m.project_id for m in members])
        return {**graph_global(members, cross, limit), "skipped": skipped}


@router.post("/export")
def global_export(body: GlobalExportBody, request: Request) -> dict:
    services = request.app.state.services
    out_dir = _writable_dir(body.out_dir)
    with open_members(services.data_dir, services.registry, body.projects) as (members, skipped):
        if not members:
            raise ApiError(409, "no_members", "Graph chung chưa có dự án nào đã lập chỉ mục")
        cross = GlobalStore(services.data_dir).edges([m.project_id for m in members])
        try:
            return {**export_global(members, cross, out_dir), "skipped": skipped}
        except OSError as exc:
            raise ApiError(500, "export_failed", f"Không ghi được graph.json gộp: {exc.strerror}") from exc
