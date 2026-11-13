from fastapi import APIRouter, Query, Request

from nexgraph_engine.api.errors import ApiError
from nexgraph_engine.api.routes_graph import open_store
from nexgraph_engine.api.serialize import edge_json
from nexgraph_engine.arch.builder import UnknownBlock, build_view
from nexgraph_engine.arch.evidence import evidence_between

router = APIRouter(prefix="/v1/projects/{project_id}")


@router.get("/architecture")
def architecture(project_id: str, request: Request, parent: str | None = None) -> dict:
    with open_store(request, project_id) as (store, _):
        return architecture_json(store.conn, parent)


def architecture_json(conn, parent: str | None) -> dict:
    """Dùng chung cho route HTTP và tool MCP."""
    try:
        view = build_view(conn, parent or None)
    except UnknownBlock as exc:
        raise ApiError(404, "unknown_block", f"Không có khối {parent}") from exc
    return {
        "parent": {"id": view.parent[0], "label": view.parent[1]} if view.parent else None,
        "blocks": [{"id": b.id, "label": b.label, "kind": b.kind, "size": b.size, "symbols": b.symbols,
                    "drillable": b.drillable} for b in view.blocks],
        "links": [{"from": l.source, "to": l.target, "count": l.count, "types": l.types} for l in view.links],
    }


@router.get("/architecture/evidence")
def architecture_evidence(project_id: str, request: Request, from_: str = Query(..., alias="from"),
                          to: str = Query(...), limit: int = Query(50, ge=1, le=200)) -> list[dict]:
    with open_store(request, project_id) as (store, _):
        return evidence_json(store.conn, from_, to, limit)


def evidence_json(conn, from_: str, to: str, limit: int) -> list[dict]:
    try:
        edges = evidence_between(conn, from_, to, limit=limit)
    except UnknownBlock as exc:
        raise ApiError(404, "unknown_block", f"Không có khối {exc.args[0]}") from exc
    return [{"edge": edge_json(e), "file": e.file, "line": e.edge.line} for e in edges]
