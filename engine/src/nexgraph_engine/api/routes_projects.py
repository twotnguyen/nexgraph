from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from nexgraph_engine.api.errors import ApiError
from nexgraph_engine.index.jobs import IndexAlreadyRunning, UnknownProject
from nexgraph_engine.index import scan as scan_module
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.projects import ProjectInfo, ProjectPathError

router = APIRouter(prefix="/v1")


class OpenBody(BaseModel):
    path: str


class IndexBody(BaseModel):
    subdir: str | None = None
    exclude: list[str] = Field(default_factory=list, max_length=200)
    include_docs: bool = False
    include_media: bool = False


def _last_run(info: ProjectInfo) -> tuple[int | None, str | None]:
    if not info.graph_db.exists():
        return None, None
    try:
        conn = open_graph_db(info.graph_db, read_only=True)
        try:
            run = GraphStore(conn).last_completed_run()
        finally:
            conn.close()
    except Exception:
        return None, None
    return run if run else (None, None)


def _summary(info: ProjectInfo) -> dict:
    return {"project_id": info.project_id, "path": str(info.path), "name": info.name, "is_git": info.is_git,
            "storage": info.storage}


@router.post("/projects")
def open_project(body: OpenBody, request: Request) -> dict:
    try:
        info = request.app.state.services.registry.open_project(body.path)
    except ProjectPathError as exc:
        raise ApiError(400, "bad_path", str(exc)) from exc
    at, commit = _last_run(info)
    return {**_summary(info), "last_indexed_at": at, "last_index_commit": commit}


@router.get("/projects")
def list_projects(request: Request) -> list[dict]:
    out = []
    for info in request.app.state.services.registry.list_projects():
        at, commit = _last_run(info)
        out.append({**_summary(info), "last_indexed_at": at, "last_index_commit": commit})
    return out


@router.post("/projects/{project_id}/index", status_code=202)
def start_index(project_id: str, request: Request, body: IndexBody | None = None) -> dict:
    try:
        return {"job_id": request.app.state.services.jobs.start_index(project_id, subdir=body.subdir if body else None,
                                                                       exclude=[e for e in body.exclude if e.strip()] if body else None,
                                                                       include_docs=bool(body and body.include_docs),
                                                                       include_media=bool(body and body.include_media))}
    except ProjectPathError as exc:
        raise ApiError(400, "bad_path", str(exc)) from exc
    except UnknownProject as exc:
        raise ApiError(404, "unknown_project", f"Không có dự án {project_id}") from exc
    except IndexAlreadyRunning as exc:
        raise ApiError(409, "index_running", "Dự án đang được lập chỉ mục") from exc


@router.get("/jobs/{job_id}")
def get_job(job_id: str, request: Request) -> dict:
    job = request.app.state.services.jobs.get(job_id)
    if job is None:
        raise ApiError(404, "unknown_job", f"Không có công việc {job_id}")
    return job


@router.delete("/jobs/{job_id}")
def cancel_job(job_id: str, request: Request) -> dict:
    jobs = request.app.state.services.jobs
    if jobs.get(job_id) is None:
        raise ApiError(404, "unknown_job", f"Không có công việc {job_id}")
    return {"cancelled": jobs.cancel(job_id)}


@router.get("/projects/{project_id}/scan")
def scan_project(project_id: str, request: Request) -> dict:
    info = request.app.state.services.registry.get(project_id)
    if info is None:
        raise ApiError(404, "unknown_project", f"Không có dự án {project_id}")
    result = scan_module.scan_project(info.path)
    return {"files": result.files, "by_language": result.by_language, "large": result.large,
            "threshold": scan_module.LARGE_FILE_COUNT,
            "top_dirs": [{"path": p, "files": n} for p, n in result.top_dirs]}


@router.post("/projects/{project_id}/communities")
def recluster(project_id: str, request: Request) -> dict:
    from nexgraph_engine.index.refresh_service import NotIndexed
    try:
        return {"communities": request.app.state.services.refresh.recluster(project_id)}
    except UnknownProject as exc:
        raise ApiError(404, "unknown_project", f"Không có dự án {project_id}") from exc
    except IndexAlreadyRunning as exc:
        raise ApiError(409, "index_running", "Dự án đang được lập chỉ mục hoặc cập nhật") from exc
    except NotIndexed as exc:
        raise ApiError(409, "not_indexed", "Dự án chưa được lập chỉ mục xong") from exc
