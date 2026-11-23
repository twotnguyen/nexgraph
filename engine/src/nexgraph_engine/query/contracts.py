"""Hình dạng JSON v1 dùng chung giữa route HTTP và tool MCP.

Module thuần tuý của tầng domain: không import FastAPI, không import `api.routes_*`.
Route chỉ bọc các hàm này bằng `open_store`, còn MCP gọi trực tiếp (ADR 0002).
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory

from nexgraph_engine.arch.builder import UnknownBlock, build_view
from nexgraph_engine.arch.evidence import evidence_between
from nexgraph_engine.changes.model import read_changes
from nexgraph_engine.docs.secrets import redact_doc_secrets
from nexgraph_engine.docs.text import doc_text
from nexgraph_engine.errors import ApiError
from nexgraph_engine.impact.analyze import analyze
from nexgraph_engine.index.extra_sources import is_source_language, is_source_path
from nexgraph_engine.index.discovery import DOC_LANGUAGES, FULL_SUPPORT, language_of, sha256_file, source_path
from nexgraph_engine.query.source_policy import SourcePolicy, protected_source, safe_project_path
from nexgraph_engine.query.terms import NO_MATCH_SUGGESTION, has_words
from nexgraph_engine.schema.enums import EdgeType, NodeKind
from nexgraph_engine.store.freshness import freshness
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.models import Node, StoredEdge
from nexgraph_engine.store.search import build_match_query, search

MAX_CODE_LINES = 2000
CONVERTED_LANGUAGES = ("docx", "xlsx", "pdf", "html")  # HTML index qua bản Markdown: đọc lại cùng bản để khớp dòng


def node_json(n: Node) -> dict:
    """Chuyển nút sang JSON v1 (hình dạng ghi ở roadmap, mục "Hình dạng JSON v1")."""
    return {"id": n.id, "kind": n.kind.value, "label": n.label, "qualified_name": n.qualified_name,
            "language": n.language, "file": n.file, "line_start": n.line_start, "line_end": n.line_end,
            "is_test": n.is_test, "origin": n.origin.value, "signature": n.signature, "community": None}


def edge_json(se: StoredEdge) -> dict:
    e = se.edge
    evidence = {"file": se.file, "line": e.line, "col": e.col} if e.line is not None else None
    return {"id": se.id, "source": e.source, "target": e.target, "type": e.type.value, "subtype": e.subtype,
            "confidence": e.confidence.value, "confidence_score": e.confidence_score, "origin": e.origin.value,
            "evidence": evidence}


def stats_json(store: GraphStore, root: Path, sources_dir: Path | None = None) -> dict:
    stats = store.stats()
    generic = sorted(lang for lang in stats["languages"] if lang not in FULL_SUPPORT and lang not in DOC_LANGUAGES
                     and not is_source_language(lang))
    return {**stats, "generic_languages": generic, **freshness(store, root, sources_dir)}


def get_node_json(store: GraphStore, node_id: str) -> dict:
    node = store.get_node(node_id)
    if node is None:
        raise ApiError(404, "unknown_node", f"Không có nút {node_id}")
    return node_json(node)


def parse_edge_types(names) -> set[EdgeType]:
    try:
        return {EdgeType(t) for t in names if t}
    except ValueError as exc:
        raise ApiError(400, "bad_param", f"Loại cạnh không hợp lệ: {exc}") from exc


def neighbors_json(store: GraphStore, node: str, types: set[EdgeType] | None, direction: str, depth: int,
                   limit: int) -> dict:
    try:
        hood = store.neighbors(node, types=types, direction=direction, depth=depth, limit=limit)  # type: ignore[arg-type]
    except KeyError as exc:
        raise ApiError(404, "unknown_node", f"Không có nút {node}") from exc
    return {"nodes": [node_json(n) for n in hood.nodes], "edges": [edge_json(e) for e in hood.edges],
            "truncated": hood.truncated, "total": hood.total}


def read_code(store: GraphStore, root: Path, file: str, start: int | None, end: int | None, *,
              transcript_dir: Path | None = None, source: SourcePolicy | None = None,
              sources_dir: Path | None = None, redact_documents: bool = False) -> dict:
    if is_source_path(file):
        raise ApiError(404, "file_not_found", "Nút đến từ nguồn bổ sung, không có mã nguồn")
    external = source_path(root, file, sources_dir)
    if external is not None:  # nguồn tải từ URL: ngoài dự án nên không qua .gitignore, nhưng vẫn theo mẫu loại trừ AI
        if source is not None and not source.allows(file):
            raise protected_source()
        path, source = external, None
    else:
        path = source.resolve(file) if source else safe_project_path(root, file)
    record = store.file_record(file)
    if record is None:  # chỉ phục vụ tệp đã được lập chỉ mục (không đọc .git, .nexgraph, khóa bí mật...)
        raise ApiError(404, "file_not_found", f"Tệp chưa được lập chỉ mục: {file}")
    if not path.is_file():
        raise ApiError(404, "file_not_found", f"Tệp không còn tồn tại: {file}")
    first = 1 if start is None else start
    if first < 1 or (end is not None and (end < first or end - first + 1 > MAX_CODE_LINES)):
        raise ApiError(400, "bad_param", f"start >= 1, end >= start, tối đa {MAX_CODE_LINES} dòng mỗi lần")
    cached_text = record.language in ("media", "google_workspace")
    snapshot = source.read(file, path) if source and not cached_text else None
    if cached_text:  # audio/video, lối tắt Google: phục vụ chữ đã lưu lúc index, không đọc lại tệp hay gọi gws
        cached = transcript_dir / f"{record.sha256}.txt" if transcript_dir else None
        if cached is None or not cached.is_file():
            raise ApiError(404, "no_text", f"Chưa có nội dung chữ cho {file}")
        lines = cached.read_text(encoding="utf-8").splitlines()
    elif record.language in CONVERTED_LANGUAGES:  # docx/xlsx/PDF: chuyển lại sang chữ, cùng hàm lúc index
        if snapshot is None:
            lines = doc_text(path, record.language).splitlines()
        else:
            # Bộ chuyển đổi mở tên tệp. Chỉ đưa cho nó các byte đã xác nhận từ handle.
            with TemporaryDirectory(prefix="nexgraph-ai-doc-") as tmp:
                document = Path(tmp) / f"document.{record.language}"
                document.write_bytes(snapshot)
                lines = doc_text(document, record.language).splitlines()
    else:
        lines = (snapshot if snapshot is not None else path.read_bytes()).decode("utf-8", errors="replace").splitlines()
    last = min(len(lines), end if end is not None else first + MAX_CODE_LINES - 1)
    digest = hashlib.sha256(snapshot).hexdigest() if snapshot is not None else sha256_file(path)
    # REV-21: chỉ cắt ngầm khi người đọc không truyền `end` mà tệp dài hơn giới hạn; xin dải cụ thể thì
    # trả đúng dải đó, không tính là cắt (MCP/UI đọc cả tệp mới là chỗ trước đây mất dòng mà không báo).
    truncated = end is None and last < len(lines)
    text = "\n".join(lines[first - 1:last])
    # Đường tới model: tài liệu trả bản đã che (re-review #52 Important 2). Tệp mã giữ nguyên.
    if redact_documents and record.language in DOC_LANGUAGES and record.language != "image":
        text = redact_doc_secrets(text)
    return {"file": file, "start": first, "end": last, "text": text,
            "language": language_of(file) or record.language, "stale": digest != record.sha256,
            "truncated": truncated}


def search_json(store: GraphStore, q: str, kinds, limit: int) -> list[dict]:
    if build_match_query(q) is None:
        # Câu toàn hư từ (vd "làm sao") trả cùng gợi ý thân thiện với ask/context (M5, review 23/11).
        raise ApiError(400, "bad_param", NO_MATCH_SUGGESTION if has_words(q) else "Cần ít nhất một từ để tìm kiếm")
    try:
        wanted = {NodeKind(k) for k in kinds if k} if kinds else None
    except ValueError as exc:
        raise ApiError(400, "bad_param", f"Loại nút không hợp lệ: {exc}") from exc
    hits = search(store.conn, q, kinds=wanted, limit=limit)
    return [{"node": node_json(n), "score": score} for n, score in hits]


def architecture_json(conn, parent: str | None) -> dict:
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


def evidence_json(conn, from_: str, to: str, limit: int) -> list[dict]:
    try:
        edges = evidence_between(conn, from_, to, limit=limit)
    except UnknownBlock as exc:
        raise ApiError(404, "unknown_block", f"Không có khối {exc.args[0]}") from exc
    return [{"edge": edge_json(e), "file": e.file, "line": e.edge.line} for e in edges]


def changes_json(store, root) -> dict:
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
