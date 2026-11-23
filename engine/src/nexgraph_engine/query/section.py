"""Đọc thân một mục tài liệu (nút `document`) như `get_section` của Graphify: đọc lại từ tệp, che secret.

Không có miễn trừ theo tên tệp: đường tới model truyền `SourcePolicy` strict nên tài liệu tên nhạy cảm bị từ chối;
đường UI (không có policy) vẫn trả bản đã che (quyết định lead, re-review #52 vòng 3).
"""
from __future__ import annotations

from pathlib import Path

from graphify.sections import _BODY_CONTROL_RE, DEFAULT_MAX_CHARS

from nexgraph_engine.docs.secrets import redact_doc_secrets
from nexgraph_engine.errors import ApiError
from nexgraph_engine.query.contracts import MAX_CODE_LINES, node_json, read_code
from nexgraph_engine.query.source_policy import SourcePolicy
from nexgraph_engine.schema.enums import NodeKind
from nexgraph_engine.store.graph_store import GraphStore


def section_json(store: GraphStore, root: Path, node_id: str, *, source: SourcePolicy | None = None,
                 transcript_dir: Path | None = None, max_chars: int = DEFAULT_MAX_CHARS,
                 sources_dir: Path | None = None) -> dict:
    node = store.get_node(node_id)
    if node is None:
        raise ApiError(404, "unknown_node", f"Không có nút {node_id}")
    if node.kind != NodeKind.DOCUMENT or not node.file or not node.line_start:
        raise ApiError(400, "not_section", f"{node.label} không phải một mục tài liệu")
    start = node.line_start
    section_end = node.line_end or start
    end = min(section_end, start + MAX_CODE_LINES - 1)
    code = read_code(store, root, node.file, start, end, transcript_dir=transcript_dir, source=source,
                     sources_dir=sources_dir)
    # Bỏ ký tự điều khiển (trừ tab) để tài liệu không chèn mã thoát terminal vào ngữ cảnh model, rồi che secret.
    text = redact_doc_secrets(_BODY_CONTROL_RE.sub("", code["text"]).rstrip())
    # Cắt vì số dòng (section dài hơn MAX_CODE_LINES) cũng là cắt: phải báo, không chỉ khi vượt max_chars (REV-21).
    truncated = len(text) > max_chars or end < section_end
    return {"node": node_json(node), "file": node.file, "start": code["start"], "end": code["end"],
            "text": text[:max_chars], "truncated": truncated, "stale": code["stale"]}
