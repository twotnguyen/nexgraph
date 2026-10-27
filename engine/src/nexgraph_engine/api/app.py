import hmac

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from nexgraph_engine import GRAPHIFY_COMMIT, __version__


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)


def create_app(token: str, allowed_hosts: set[str]) -> FastAPI:
    app = FastAPI(title="NexGraph Engine", docs_url=None, redoc_url=None, openapi_url=None)
    expected = token.encode("utf-8")

    @app.middleware("http")
    async def guard(request: Request, call_next):
        if request.headers.get("host", "") not in allowed_hosts:
            return _error(403, "forbidden_host", "Host không được phép")
        header = request.headers.get("authorization", "")
        scheme, _, supplied = header.partition(" ")
        if scheme != "Bearer" or not hmac.compare_digest(supplied.encode("utf-8"), expected):
            return _error(401, "unauthorized", "Thiếu hoặc sai token")
        return await call_next(request)

    @app.get("/v1/health")
    def health():
        return {"status": "ok", "api_version": "1",
                "engine_version": __version__, "graphify_commit": GRAPHIFY_COMMIT}

    return app
