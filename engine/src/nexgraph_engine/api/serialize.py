"""Chuyển mô hình lưu trữ sang JSON v1 (hình dạng ghi ở roadmap, mục "Hình dạng JSON v1")."""
from nexgraph_engine.store.models import Node, StoredEdge


def node_json(n: Node) -> dict:
    return {"id": n.id, "kind": n.kind.value, "label": n.label, "qualified_name": n.qualified_name,
            "language": n.language, "file": n.file, "line_start": n.line_start, "line_end": n.line_end,
            "is_test": n.is_test, "origin": n.origin.value, "signature": n.signature, "community": None}


def edge_json(se: StoredEdge) -> dict:
    e = se.edge
    evidence = {"file": se.file, "line": e.line, "col": e.col} if e.line is not None else None
    return {"id": se.id, "source": e.source, "target": e.target, "type": e.type.value, "subtype": e.subtype,
            "confidence": e.confidence.value, "confidence_score": e.confidence_score, "origin": e.origin.value,
            "evidence": evidence}
