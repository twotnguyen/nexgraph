"""Nguồn ngoài thư mục (W6): mở dự án từ URL GitHub/GitLab, thêm/xem/xoá nguồn tải từ URL."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Query, Request
from graphify.security import validate_url
from pydantic import BaseModel, Field

from nexgraph_engine.api.errors import ApiError, error_response
from nexgraph_engine.api.routes_projects import _summary
from nexgraph_engine.index.jobs import IndexAlreadyRunning, UnknownProject
from nexgraph_engine.sources import ingest_url, list_sources, remove_source, sources_root
from nexgraph_engine.sources.clone import clone_repo, parse_repo_url

router = APIRouter(prefix="/v1")


class CloneBody(BaseModel):
    url: str = Field(max_length=2048)
    depth: int = Field(default=1, ge=1, le=1_000_000)


@router.post("/projects/clone", status_code=202)
def clone_project(body: CloneBody, request: Request) -> dict:
    try:
        name = parse_repo_url(body.url)
    except ValueError as exc:
        raise ApiError(400, "bad_url", str(exc)) from exc
    services = request.app.state.services
    dest = services.data_dir / "clones" / f"{name}-{uuid.uuid4().hex[:8]}"

    def work(ctx) -> dict:
        ctx.progress(0, 2, "Đang tải mã nguồn")
        clone_repo(body.url.strip(), dest, depth=body.depth, cancel=ctx.cancel)
        ctx.progress(1, 2, "Đang mở dự án")
        info = services.registry.open_project(dest)
        return {"project": {**_summary(info), "last_indexed_at": None, "last_index_commit": None}}

    return {"job_id": services.jobs.start_task(None, "clone", work)}


class SourceBody(BaseModel):
    url: str = Field(max_length=2048)


def _project_dir(request: Request, project_id: str):
    services = request.app.state.services
    if services.registry.get(project_id) is None:
        raise ApiError(404, "unknown_project", f"Không có dự án {project_id}")
    return services, sources_root(services.data_dir, project_id)


@router.post("/projects/{project_id}/sources", status_code=202)
def add_source(project_id: str, body: SourceBody, request: Request):
    services, directory = _project_dir(request, project_id)
    url = body.url.strip()
    try:
        validate_url(url)  # chặn sớm file://, ftp://, IP nội bộ trước khi tạo job
    except ValueError as exc:
        raise ApiError(400, "bad_url", str(exc)) from exc

    def work(ctx) -> dict:
        ctx.progress(0, 2, "Đang tải nội dung")
        rel = ingest_url(url, directory)
        ctx.progress(1, 2, "Đang cập nhật đồ thị")
        return {"file": rel, "refresh": services.refresh.refresh_now(project_id)}

    try:
        return {"job_id": services.jobs.start_task(project_id, "ingest", work)}
    except UnknownProject as exc:
        raise ApiError(404, "unknown_project", f"Không có dự án {project_id}") from exc
    except IndexAlreadyRunning as exc:
        return error_response(409, "index_running", "Dự án đang được lập chỉ mục hoặc cập nhật", job_id=exc.job_id)


@router.get("/projects/{project_id}/sources")
def get_sources(project_id: str, request: Request) -> list[dict]:
    _, directory = _project_dir(request, project_id)
    return list_sources(directory)


@router.delete("/projects/{project_id}/sources")
def delete_source(project_id: str, request: Request, name: str = Query(..., max_length=255)) -> dict:
    services, directory = _project_dir(request, project_id)
    lock = services.locks.get(project_id)
    if services.jobs.is_active(project_id) or not lock.acquire(blocking=False):
        raise ApiError(409, "index_running", "Dự án đang được lập chỉ mục hoặc cập nhật")
    try:
        if not remove_source(directory, name):
            raise ApiError(404, "unknown_source", f"Không có nguồn {name}")
        return {"removed": True, "refresh": services.refresh.refresh_now(project_id)}
    finally:
        lock.release()
