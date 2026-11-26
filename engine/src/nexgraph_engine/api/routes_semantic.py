"""Phân tích ngữ nghĩa bằng AI (W9): bật theo dự án, ước tính, chạy job, hàng đợi khối của đường A."""
from __future__ import annotations

from contextlib import closing
from typing import Annotated, Literal

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from nexgraph_engine.api.errors import ApiError, error_response, open_graph_readonly
from nexgraph_engine.pipeline.job_manager import IndexAlreadyRunning, UnknownProject
from nexgraph_engine.semantic.chunks import TARGETS, Sources, plan
from nexgraph_engine.semantic.run import Request as SemanticRequest
from nexgraph_engine.semantic.run import estimate, make_work
from nexgraph_engine.semantic.transport import DirectTransport, LlmQueue, check_base_url
from nexgraph_engine.sources import sources_root
from nexgraph_engine.store.graph_store import GraphStore

router = APIRouter(prefix="/v1")


class AiSettingsBody(BaseModel):
    enabled: bool
    transport: Literal["direct", "app"] | None = None
    model: str | None = Field(default=None, max_length=200)


class DirectBody(BaseModel):
    kind: Literal["direct"]
    base_url: str = Field(max_length=2048)
    api_key: str = Field(default="", max_length=8192)  # chỉ giữ trong bộ nhớ của job, không ghi đĩa/log
    model: str = Field(min_length=1, max_length=200)


class AppBody(BaseModel):
    kind: Literal["app"]
    model_label: str = Field(default="", max_length=200)


class PrItem(BaseModel):
    number: int = Field(ge=1)
    title: str = Field(max_length=500)
    status: str = Field(default="", max_length=40)
    ci: str = Field(default="", max_length=40)
    review: str = Field(default="", max_length=40)
    age_days: int = Field(default=0, ge=0)
    author: str = Field(default="", max_length=100)
    blast_radius: str = Field(default="", max_length=100)


Target = Literal["docs", "images", "deep", "labels", "dedup", "pr_triage"]
assert set(Target.__args__) == set(TARGETS)
Transport = Annotated[DirectBody | AppBody, Field(discriminator="kind")]


class SemanticBody(BaseModel):
    targets: Target
    transport: Transport
    max_tokens_budget: int = Field(default=1_000_000, ge=1, le=1_000_000_000)
    prs: list[PrItem] = Field(default_factory=list, max_length=200)
    no_cache: bool = False  # chạy lại không dùng kết quả đã lưu


class EstimateBody(BaseModel):
    targets: Target
    transport: Transport | None = None
    max_tokens_budget: int = Field(default=1_000_000, ge=1, le=1_000_000_000)
    prs: list[PrItem] = Field(default_factory=list, max_length=200)
    no_cache: bool = False  # chạy lại không dùng kết quả đã lưu


class AnswerBody(BaseModel):
    text: str | None = Field(default=None, max_length=10 * 1024 * 1024)
    error: str | None = Field(default=None, max_length=2000)


def _project(request: Request, project_id: str):
    services = request.app.state.services
    info = services.registry.get(project_id)
    if info is None:
        raise ApiError(404, "unknown_project", f"Không có dự án {project_id}")
    return services, info


def _sources(services, info) -> Sources:
    return Sources(info.path, sources_root(services.data_dir, info.project_id),
                   services.data_dir / "transcripts" / info.project_id)


@router.get("/projects/{project_id}/ai")
def get_ai(project_id: str, request: Request) -> dict:
    services, _ = _project(request, project_id)
    return services.registry.ai_settings(project_id)


@router.put("/projects/{project_id}/ai")
def put_ai(project_id: str, body: AiSettingsBody, request: Request) -> dict:
    services, _ = _project(request, project_id)
    return services.registry.set_ai_settings(project_id, enabled=body.enabled, transport=body.transport,
                                             model=body.model)


def _gh_prs(store: GraphStore, root) -> list[dict]:
    """Hàng PR mở qua `gh`, lọc theo SourcePolicy vì sẽ gửi cho model."""
    from nexgraph_engine.prs.listing import list_prs_json, triage_items, triage_json
    from nexgraph_engine.query.model_view import ModelGraph
    prs = triage_items(triage_json(list_prs_json(store, root, model=ModelGraph(store, root))))
    if not prs:
        raise ValueError("Không có pull request nào để xếp hạng")
    return prs


def _needs_gh(body) -> bool:
    """`pr_triage` không kèm `prs` (tab PR): engine tự lấy danh sách PR."""
    return body.targets == "pr_triage" and not body.prs


def _prs(body, store: GraphStore, info) -> list[dict]:
    if not _needs_gh(body):
        return [p.model_dump() for p in body.prs]
    from nexgraph_engine.prs import gh
    try:
        return _gh_prs(store, info.path)
    except gh.GhError as exc:
        raise exc.api_error() from exc
    except ValueError as exc:
        raise ApiError(400, "bad_param", str(exc)) from exc


def _load_prs(info):
    """Chạy trong job: mở graph chỉ đọc riêng, không giữ request chờ `gh` (timeout 30 s mỗi lời gọi)."""
    def load() -> list[dict]:
        with closing(open_graph_readonly(info.graph_db)) as conn:
            return _gh_prs(GraphStore(conn), info.path)
    return load


@router.post("/projects/{project_id}/semantic/estimate")
def semantic_estimate(project_id: str, body: EstimateBody, request: Request) -> dict:
    services, info = _project(request, project_id)
    with closing(open_graph_readonly(info.graph_db)) as conn:
        store = GraphStore(conn)
        if not store.has_published_graph():
            raise ApiError(409, "not_indexed", "Dự án chưa được lập chỉ mục")
        return estimate(plan(body.targets, store, _sources(services, info), _prs(body, store, info)), store,
                        no_cache=body.no_cache)


@router.post("/projects/{project_id}/semantic", status_code=202)
def semantic_start(project_id: str, body: SemanticBody, request: Request):
    services, info = _project(request, project_id)
    # `dedup` chỉ chạy trên máy (gộp khái niệm trùng), không gửi gì cho model nên không đòi bật AI.
    if body.targets != "dedup" and not services.registry.ai_settings(project_id)["enabled"]:
        raise ApiError(403, "ai_disabled", "Chưa bật phân tích bằng AI cho dự án này")
    with closing(open_graph_readonly(info.graph_db)) as conn:
        store = GraphStore(conn)
        if not store.has_published_graph():
            raise ApiError(409, "not_indexed", "Dự án chưa được lập chỉ mục")
        prs = [] if _needs_gh(body) else _prs(body, store, info)
    if body.transport.kind == "direct":
        try:
            check_base_url(body.transport.base_url)
        except ValueError as exc:
            raise ApiError(400, "bad_url", str(exc)) from exc
        transport = DirectTransport(body.transport.base_url, body.transport.api_key, body.transport.model)
    else:
        transport = LlmQueue()
    work = make_work(graph_db=info.graph_db, src=_sources(services, info),
                     req=SemanticRequest(body.targets, body.max_tokens_budget, prs,
                                         body.no_cache),
                     transport=transport,
                     on_written=lambda: services.bus.publish({"type": "graph_updated", "project_id": project_id}),
                     load_prs=_load_prs(info) if _needs_gh(body) else None)
    holder: dict = {}

    def tracked(ctx):
        try:
            return work(ctx)
        finally:  # job kết thúc: bỏ hàng đợi khỏi bảng tra, `next`/`answer` trả 404
            services.llm_queues.pop(holder.get("job_id"), None)

    try:
        job_id = services.jobs.start_task(project_id, "semantic", tracked)
    except UnknownProject as exc:
        raise ApiError(404, "unknown_project", f"Không có dự án {project_id}") from exc
    except IndexAlreadyRunning as exc:
        return error_response(409, "index_running", "Dự án đang được lập chỉ mục hoặc cập nhật", job_id=exc.job_id)
    if isinstance(transport, LlmQueue):
        holder["job_id"] = job_id
        services.llm_queues[job_id] = transport
        if transport.closed:  # job đã xong trước khi kịp đăng ký
            services.llm_queues.pop(job_id, None)
    return {"job_id": job_id}


def _queue(request: Request, job_id: str) -> LlmQueue:
    q = request.app.state.services.llm_queues.get(job_id)
    if q is None:
        raise ApiError(404, "unknown_job", f"Không có job đường A {job_id}")
    return q


@router.get("/jobs/{job_id}/llm/next", response_model=None)
def llm_next(job_id: str, request: Request):
    chunk = _queue(request, job_id).next()
    return Response(status_code=204) if chunk is None else chunk.wire()


@router.post("/jobs/{job_id}/llm/{chunk_id}")
def llm_answer(job_id: str, chunk_id: str, body: AnswerBody, request: Request) -> dict:
    if (body.text is None) == (body.error is None):
        raise ApiError(400, "bad_param", "Cần đúng một trong hai trường text hoặc error")
    status = _queue(request, job_id).answer(chunk_id, body.text, body.error)
    if status == "closed":
        raise ApiError(409, "job_finished", "Job đã kết thúc")
    if status == "unknown":
        raise ApiError(404, "unknown_chunk", f"Không có khối {chunk_id} đang chờ")
    return {"accepted": True}
