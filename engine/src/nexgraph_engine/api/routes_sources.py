"""Nguồn ngoài thư mục (W6): mở dự án từ URL GitHub/GitLab, thêm/xem/xoá nguồn tải từ URL."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from nexgraph_engine.api.errors import ApiError
from nexgraph_engine.api.routes_projects import _summary
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
