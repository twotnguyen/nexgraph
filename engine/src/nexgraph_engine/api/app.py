import hmac
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from nexgraph_engine import VENDOR_COMMIT, __version__
from nexgraph_engine.api import (
    routes_arch, routes_changes, routes_events, routes_export, routes_flows,
    routes_graph, routes_map, routes_projects, routes_query, routes_report, routes_tools,
)
from nexgraph_engine.api import routes_sources
from nexgraph_engine.api import routes_memory
from nexgraph_engine.api import routes_global
from nexgraph_engine.api import routes_prs
from nexgraph_engine.api import routes_semantic
from nexgraph_engine.api.errors import ApiError, error_response
from nexgraph_engine.api.services import Services
from nexgraph_engine.selftest import run_selftest

logger = logging.getLogger(__name__)


class Guard:
    """ASGI thuần (không dùng BaseHTTPMiddleware để SSE không bị chặn): kiểm Host rồi token."""

    def __init__(self, app, token: str, allowed_hosts: set[str]) -> None:
        self.app, self.expected, self.allowed_hosts = app, token.encode("utf-8"), allowed_hosts

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 1008})
                return
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        if headers.get("host", "") not in self.allowed_hosts:
            response = error_response(403, "forbidden_host", "Host không được phép")
        else:
            scheme, _, supplied = headers.get("authorization", "").partition(" ")
            if scheme != "Bearer" or not hmac.compare_digest(supplied.encode("utf-8"), self.expected):
                response = error_response(401, "unauthorized", "Thiếu hoặc sai token")
            else:
                await self.app(scope, receive, send)
                return
        await response(scope, receive, send)


def create_app(token: str, allowed_hosts: set[str], *, data_dir: Path | None = None,
               sse_ping_seconds: float = 15.0) -> FastAPI:
    services = Services(data_dir)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            services.shutdown()  # dừng job nền khi engine tắt (REV-19)

    app = FastAPI(title="NexGraph Engine", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.services = services
    app.state.sse_ping_seconds = sse_ping_seconds

    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        return error_response(exc.status, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", ())[1:]) or "request"
        return error_response(400, "bad_param", f"Tham số không hợp lệ ({where}): {first.get('msg', '')}")

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException):
        return error_response(exc.status_code, "not_found" if exc.status_code == 404 else "http_error", str(exc.detail))

    @app.exception_handler(Exception)
    async def _internal(_: Request, exc: Exception):
        logger.exception("Lỗi nội bộ engine", exc_info=exc)
        return error_response(500, "internal_error", "Lỗi nội bộ engine. Xem log để biết chi tiết.")

    @app.get("/v1/health")
    def health():
        return {"status": "ok", "api_version": "1", "engine_version": __version__,
                "vendor_commit": VENDOR_COMMIT}

    @app.get("/v1/selftest")
    def selftest():
        return run_selftest()

    app.include_router(routes_projects.router)
    app.include_router(routes_graph.router)
    app.include_router(routes_arch.router)
    app.include_router(routes_changes.router)
    app.include_router(routes_events.router)
    app.include_router(routes_report.router)
    app.include_router(routes_export.router)
    app.include_router(routes_query.router)
    app.include_router(routes_tools.router)
    app.include_router(routes_flows.router)
    app.include_router(routes_map.router)
    app.include_router(routes_sources.router)
    app.include_router(routes_memory.router)
    app.include_router(routes_global.router)
    app.include_router(routes_prs.router)
    app.include_router(routes_semantic.router)
    app.add_middleware(Guard, token=token, allowed_hosts=allowed_hosts)
    return app
