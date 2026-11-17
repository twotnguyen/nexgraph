import os
import tempfile
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel

from nexgraph_engine.api.errors import ApiError
from nexgraph_engine.api.routes_graph import open_store, require_indexed
from nexgraph_engine.bridge.to_nx import Scope
from nexgraph_engine.export.run import ExportFormat, export_graph, push_graph, validate_push_uri

router = APIRouter(prefix="/v1/projects/{project_id}")


class ScopeBody(BaseModel):
    kind: Literal["all", "community", "node"] = "all"
    value: str | None = None


class ExportBody(BaseModel):
    format: ExportFormat
    scope: ScopeBody = ScopeBody()
    out_dir: str


class PushBody(BaseModel):
    target: Literal["neo4j", "falkordb"]
    uri: str
    user: str | None = None
    password: str | None = None
    scope: ScopeBody = ScopeBody()


def _writable_dir(raw: str) -> Path:
    path = Path(raw)
    if not path.is_absolute() or not path.is_dir():
        raise ApiError(400, "bad_path", "Thư mục đích phải là đường dẫn tuyệt đối tới một thư mục có sẵn")
    # Khi triển khai đặt NEXGRAPH_EXPORT_ROOT, mọi lần export phải nằm trong root đó.
    # Không set biến này thì giữ nguyên hợp đồng v1 (bất kỳ thư mục tuyệt đối có sẵn nào cũng được).
    export_root = os.environ.get("NEXGRAPH_EXPORT_ROOT")
    if export_root and not path.resolve().is_relative_to(Path(export_root).resolve()):
        raise ApiError(400, "bad_path", "Thư mục đích nằm ngoài NEXGRAPH_EXPORT_ROOT")
    try:
        fd, probe = tempfile.mkstemp(dir=path, prefix=".nexgraph-probe-")
        os.close(fd)
        os.unlink(probe)
    except OSError as exc:
        raise ApiError(400, "bad_path", f"Không ghi được vào thư mục đích: {exc.strerror}") from exc
    return path


def _scope(body: ScopeBody) -> Scope:
    return Scope(kind=body.kind, value=body.value)


@router.post("/export")
def export(project_id: str, request: Request, body: ExportBody) -> dict:
    out_dir = _writable_dir(body.out_dir)
    with open_store(request, project_id) as (store, info):
        require_indexed(store, request, project_id)
        try:
            r = export_graph(store, body.format, _scope(body.scope), out_dir, info.name)
        except KeyError as exc:
            raise ApiError(404, "unknown_scope", f"Không có phạm vi {body.scope.value}") from exc
        except Exception as exc:  # lỗi trong exporter của Graphify: trả lỗi JSON thay vì 500 trần
            raise ApiError(500, "export_failed", f"Xuất {body.format} thất bại: {type(exc).__name__}: {exc}") from exc
        return {"files": r.files, "truncated": r.truncated}


@router.post("/export/push")
def push(project_id: str, request: Request, body: PushBody) -> dict:
    try:
        validate_push_uri(body.uri)  # 400 bad_param thay vì để driver chạy URI tuỳ ý (SSRF)
    except ValueError as exc:
        raise ApiError(400, "bad_param", str(exc)) from exc
    with open_store(request, project_id) as (store, _):
        require_indexed(store, request, project_id)
        try:
            return push_graph(store, body.target, body.uri, body.user, body.password, _scope(body.scope))
        except KeyError as exc:
            raise ApiError(404, "unknown_scope", f"Không có phạm vi {body.scope.value}") from exc
        except Exception as exc:  # lỗi kết nối/đăng nhập của driver; không đưa mật khẩu vào thông điệp
            raise ApiError(502, "push_failed", f"Không đẩy được lên {body.target}: {type(exc).__name__}") from exc
