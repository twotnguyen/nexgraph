from fastapi import APIRouter, Query, Request

from nexgraph_engine.api.errors import ApiError
from nexgraph_engine.api.routes_graph import open_store
from nexgraph_engine.api.serialize import node_json
from nexgraph_engine.changes.model import read_changes
from nexgraph_engine.impact.analyze import analyze
from nexgraph_engine.index.jobs import UnknownProject

router = APIRouter(prefix="/v1/projects/{project_id}")


@router.post("/refresh")
def refresh(project_id: str, request: Request) -> dict:
    try:
        return request.app.state.services.refresh.refresh(project_id)
    except UnknownProject as exc:
        raise ApiError(404, "unknown_project", f"Không có dự án {project_id}") from exc


@router.get("/changes")
def changes(project_id: str, request: Request, refresh: bool = Query(True)) -> dict:
    if refresh:
        try:
            request.app.state.services.refresh.refresh(project_id)  # `skipped` vẫn đọc được thay đổi từ đồ thị hiện có
        except UnknownProject as exc:
            raise ApiError(404, "unknown_project", f"Không có dự án {project_id}") from exc
    with open_store(request, project_id) as (store, info):
        return changes_json(store, info.path)


def changes_json(store, root) -> dict:
    """Dùng chung cho route HTTP và tool MCP."""
    cs = read_changes(root, store)
    report = analyze(store.conn, cs)
    return {
        "base": cs.base, "base_commit": cs.base_commit, "note": cs.note,
        "changed_files": [{"path": f.path, "status": f.status, "old_path": f.old_path} for f in cs.files],
        "changed_nodes": [node_json(n) for n in report.changed_nodes],
        "impacted": [{"node": node_json(i.node), "score": i.score, "hops": i.hops} for i in report.impacted],
        "tests": [node_json(n) for n in report.tests],
        "test_gaps": [node_json(n) for n in report.test_gaps],
        "truncated": cs.truncated or report.truncated,
    }
