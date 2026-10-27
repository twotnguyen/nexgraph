import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path, PurePosixPath, PureWindowsPath

from fastapi import APIRouter, Query, Request

from nexgraph_engine.api.errors import ApiError
from nexgraph_engine.api.serialize import edge_json, node_json
from nexgraph_engine.index.discovery import language_of, sha256_file
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.schema.enums import EdgeType
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.projects import ProjectInfo

router = APIRouter(prefix="/v1/projects/{project_id}")
MAX_CODE_LINES = 2000


@contextmanager
def open_store(request: Request, project_id: str) -> Iterator[tuple[GraphStore, ProjectInfo]]:
    info = request.app.state.services.registry.get(project_id)
    if info is None:
        raise ApiError(404, "unknown_project", f"Không có dự án {project_id}")
    try:
        conn = open_graph_db(info.graph_db, read_only=True)
    except (sqlite3.Error, OSError) as exc:
        raise ApiError(404, "graph_unavailable", f"Chưa có dữ liệu đồ thị: {exc}") from exc
    try:
        yield GraphStore(conn), info
    finally:
        conn.close()


@router.get("/stats")
def stats(project_id: str, request: Request) -> dict:
    with open_store(request, project_id) as (store, _):
        return store.stats()


@router.get("/nodes/{node_id:path}")
def get_node(project_id: str, node_id: str, request: Request) -> dict:
    with open_store(request, project_id) as (store, _):
        node = store.get_node(node_id)
    if node is None:
        raise ApiError(404, "unknown_node", f"Không có nút {node_id}")
    return node_json(node)


@router.get("/neighbors")
def neighbors(project_id: str, request: Request, node: str = Query(...), types: str | None = None,
              direction: str = Query("both", pattern="^(in|out|both)$"), depth: int = Query(1, ge=1, le=3),
              limit: int = Query(500, ge=1, le=2000)) -> dict:
    try:
        wanted = {EdgeType(t) for t in types.split(",") if t} if types else None
    except ValueError as exc:
        raise ApiError(400, "bad_param", f"Loại cạnh không hợp lệ: {exc}") from exc
    with open_store(request, project_id) as (store, _):
        try:
            hood = store.neighbors(node, types=wanted, direction=direction, depth=depth, limit=limit)  # type: ignore[arg-type]
        except KeyError as exc:
            raise ApiError(404, "unknown_node", f"Không có nút {node}") from exc
    return {"nodes": [node_json(n) for n in hood.nodes], "edges": [edge_json(e) for e in hood.edges],
            "truncated": hood.truncated}


def _safe_file(root: Path, file: str) -> Path:
    if (not file or file.startswith("/") or "\\" in file or PureWindowsPath(file).drive
            or PurePosixPath(file).is_absolute() or ".." in PurePosixPath(file).parts):
        raise ApiError(400, "bad_path", "Đường dẫn phải là đường dẫn tương đối nằm trong dự án")
    resolved = (root / file).resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise ApiError(403, "outside_project", "Tệp nằm ngoài thư mục dự án")
    return resolved


@router.get("/code")
def code(project_id: str, request: Request, file: str = Query(...), start: int | None = None,
         end: int | None = None) -> dict:
    with open_store(request, project_id) as (store, info):
        path = _safe_file(info.path, file)
        record = store.file_record(file)
    if record is None:  # chỉ phục vụ tệp đã được lập chỉ mục (không đọc .git, .nexgraph, khóa bí mật...)
        raise ApiError(404, "file_not_found", f"Tệp chưa được lập chỉ mục: {file}")
    if not path.is_file():
        raise ApiError(404, "file_not_found", f"Tệp không còn tồn tại: {file}")
    first = 1 if start is None else start
    if first < 1 or (end is not None and (end < first or end - first + 1 > MAX_CODE_LINES)):
        raise ApiError(400, "bad_param", f"start >= 1, end >= start, tối đa {MAX_CODE_LINES} dòng mỗi lần")
    lines = path.read_bytes().decode("utf-8", errors="replace").splitlines()
    last = min(len(lines), end if end is not None else first + MAX_CODE_LINES - 1)
    return {"file": file, "start": first, "end": last, "text": "\n".join(lines[first - 1:last]),
            "language": language_of(file), "stale": sha256_file(path) != record.sha256}
