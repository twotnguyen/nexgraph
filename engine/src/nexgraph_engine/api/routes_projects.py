import logging
import sqlite3

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from nexgraph_engine.api.errors import ApiError, error_response
from nexgraph_engine.index.extra_sources import ExtraSources
from nexgraph_engine.index.jobs import IndexAlreadyRunning, UnknownProject
from nexgraph_engine.index import scan as scan_module
from nexgraph_engine.schema.db import (
    SchemaOutdatedError, SchemaVersionError, UnsupportedSqliteError, open_graph_db,
)
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.projects import ProjectGraphUnreadable, ProjectInfo, ProjectPathError

router = APIRouter(prefix="/v1")
logger = logging.getLogger(__name__)


class OpenBody(BaseModel):
    path: str


class SourcesBody(BaseModel):
    """Nguồn bổ sung (W11). DSN do Electron main gửi kèm từng lần index; engine không ghi đĩa hay log."""
    postgres_dsn: str | None = Field(default=None, max_length=4096, repr=False)
    cargo: bool = False
    manifests: bool = False
    scip_files: list[str] = Field(default_factory=list, max_length=50)
    mcp_files: list[str] = Field(default_factory=list, max_length=50)


class IndexBody(BaseModel):
    subdir: str | None = None
    exclude: list[str] = Field(default_factory=list, max_length=200)
    # None = giữ tuỳ chọn của lần index trước (nút "Index lại" không gửi cờ); hộp thoại gửi giá trị tường minh.
    include_docs: bool | None = None
    include_media: bool | None = None
    include_config: bool | None = None
    # Ảnh cục bộ (E10): tách khỏi `include_media` để bản đóng gói (không có faster-whisper) vẫn index ảnh được.
    include_images: bool | None = None
    workers: int | None = Field(default=None, ge=1, le=64)  # None = tự chọn theo số tệp
    force: bool = False  # bỏ cache AST, trích lại mọi tệp
    sources: SourcesBody | None = None


def _transient_read_error(exc: BaseException) -> bool:
    """Lỗi đọc chỉ là tạm thời: CSDL đang bị tiến trình khác giữ, chưa có bảng, hoặc schema mới hơn app.

    Không phải lỗi đọc thật (file hỏng) nên không được hiện "Không đọc được lần lập chỉ mục cuối"
    như thể đồ thị đã mất (F6 của review PR #41).
    """
    if isinstance(exc, (SchemaVersionError, SchemaOutdatedError, UnsupportedSqliteError)):
        return True
    if not isinstance(exc, sqlite3.DatabaseError):
        return True  # OSError khi mở tệp… cũng chỉ là tạm thời với người dùng
    text = str(exc).lower()
    return "locked" in text or "busy" in text or "no such table" in text


def _last_run(info: ProjectInfo) -> tuple[int | None, str | None, str | None]:
    """(thời điểm, commit, lỗi đọc) — lỗi đọc phải đến người dùng, không chỉ ghi log (ENG-07/M3)."""
    if not info.graph_db.exists():
        return None, None, None
    try:
        conn = open_graph_db(info.graph_db, read_only=True)
        try:
            store = GraphStore(conn)
            run = store.last_completed_run() if store.has_published_graph() else None
        finally:
            conn.close()
    except Exception as exc:
        if _transient_read_error(exc):
            logger.info("Bỏ qua lần đọc trạng thái lập chỉ mục tạm thời của %s: %s", info.graph_db, exc)
            return None, None, None
        logger.warning("Không đọc được lần lập chỉ mục cuối trong %s", info.graph_db, exc_info=True)
        return None, None, (f"Không đọc được lần lập chỉ mục cuối trong {info.graph_db} "
                            f"({type(exc).__name__}: {exc})")
    return (run[0], run[1], None) if run else (None, None, None)


def _summary(info: ProjectInfo) -> dict:
    return {"project_id": info.project_id, "path": str(info.path), "name": info.name, "is_git": info.is_git,
            "storage": info.storage}


@router.post("/projects")
def open_project(body: OpenBody, request: Request) -> dict:
    try:
        info = request.app.state.services.registry.open_project(body.path)
    except ProjectPathError as exc:
        raise ApiError(400, "bad_path", str(exc)) from exc
    except SchemaVersionError as exc:
        raise ApiError(400, "schema_version", str(exc)) from exc
    except ProjectGraphUnreadable as exc:
        raise ApiError(400, "graph_unreadable", str(exc)) from exc
    at, commit, read_error = _last_run(info)
    return {**_summary(info), "last_indexed_at": at, "last_index_commit": commit,
            "last_index_error": read_error}


@router.get("/projects")
def list_projects(request: Request) -> list[dict]:
    out = []
    for info in request.app.state.services.registry.list_projects():
        at, commit, read_error = _last_run(info)
        out.append({**_summary(info), "last_indexed_at": at, "last_index_commit": commit,
                    "last_index_error": read_error})
    return out


@router.delete("/projects/{project_id}")
def remove_project(project_id: str, request: Request) -> dict:
    try:
        request.app.state.services.jobs.remove_project(project_id)
    except UnknownProject as exc:
        raise ApiError(404, "unknown_project", f"Không có dự án {project_id}") from exc
    except IndexAlreadyRunning as exc:
        raise ApiError(409, "project_busy", "Dự án đang được cập nhật. Hãy đợi hoàn tất hoặc hủy lập chỉ mục rồi thử lại.") from exc
    request.app.state.services.leave_global(project_id)  # W8: gỡ khỏi app thì gỡ khỏi graph chung
    return {"removed": True}


def _sources(body: IndexBody | None) -> ExtraSources | None:
    s = body.sources if body else None
    if s is None:
        return None
    clean = lambda paths: tuple(p for p in paths if p.strip())  # noqa: E731
    return ExtraSources(postgres_dsn=s.postgres_dsn or None, cargo=s.cargo, manifests=s.manifests,
                        scip_files=clean(s.scip_files), mcp_files=clean(s.mcp_files))


@router.post("/projects/{project_id}/index", status_code=202)
def start_index(project_id: str, request: Request, body: IndexBody | None = None):
    try:
        return {"job_id": request.app.state.services.jobs.start_index(project_id, subdir=body.subdir if body else None,
                                                                       exclude=[e for e in body.exclude if e.strip()] if body else None,
                                                                       include_docs=body.include_docs if body else None,
                                                                       include_media=body.include_media if body else None,
                                                                       include_config=body.include_config if body else None,
                                                                       include_images=body.include_images if body else None,
                                                                       workers=body.workers if body else None,
                                                                       force=body.force if body else False,
                                                                       sources=_sources(body))}
    except ProjectPathError as exc:
        raise ApiError(400, "bad_path", str(exc)) from exc
    except UnknownProject as exc:
        raise ApiError(404, "unknown_project", f"Không có dự án {project_id}") from exc
    except IndexAlreadyRunning as exc:
        return error_response(409, "index_running", "Dự án đang được lập chỉ mục", job_id=exc.job_id)


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
            "top_dirs": [{"path": p, "files": n} for p, n in result.top_dirs],
            "unreadable_paths": result.unreadable, "unreadable_count": len(result.unreadable)}


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
