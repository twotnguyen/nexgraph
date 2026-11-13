"""Dựng nút `document` (mỗi heading một nút) và tham chiếu `DOCUMENTS` (nhắc tên symbol trong `code span`).

Dùng lại bộ đọc Markdown của Graphify; chữ từ docx/xlsx/PDF/bản chép lời được coi như Markdown.
"""
from __future__ import annotations

import re
import tempfile
from pathlib import Path

from graphify.extractors.markdown import extract_markdown

from nexgraph_engine.dart.extractor import FileExtraction
from nexgraph_engine.ids import node_id
from nexgraph_engine.schema.enums import EdgeType, NodeKind, Origin
from nexgraph_engine.store.models import Edge, Node, UnresolvedRef

MIN_MENTION = 3  # `id`, `db`… quá chung, nối vào symbol chỉ ra cạnh sai


def _line(loc: str | None) -> int:
    m = re.match(r"L(\d+)", loc or "")
    return int(m.group(1)) if m else 1


def extract_document(rel_path: str, text: str, *, file_id: str) -> FileExtraction:
    if not text.strip():
        return FileExtraction()
    with tempfile.TemporaryDirectory(prefix="nexgraph-doc-") as tmp:
        md = Path(tmp) / "doc.md"
        md.write_text(text, encoding="utf-8")
        result = extract_markdown(md)
    if result.get("error"):
        return FileExtraction(errors=[("extract", f"Không đọc được tài liệu: {result['error']}")])

    total = len(text.splitlines()) or 1
    page = next((n["id"] for n in result["nodes"] if n.get("node_kind") == "page"), None)
    heads = sorted((n for n in result["nodes"] if n.get("node_kind") == "heading"),
                   key=lambda n: _line(n.get("source_location")))
    ids: dict[str, str] = {page: file_id} if page else {}
    nodes: list[Node] = []
    used: set[str] = set()
    for i, h in enumerate(heads):
        start = _line(h.get("source_location"))
        end = _line(heads[i + 1].get("source_location")) - 1 if i + 1 < len(heads) else total
        label = h["label"].strip()[:200] or f"Mục dòng {start}"
        nid = node_id(rel_path, label, NodeKind.DOCUMENT)
        if nid in used:  # hai heading cùng chữ: cùng quy ước `@dòng` với code
            nid = node_id(rel_path, f"{label}@{start}", NodeKind.DOCUMENT)
        used.add(nid)
        ids[h["id"]] = nid
        nodes.append(Node(id=nid, kind=NodeKind.DOCUMENT, label=label, qualified_name=label, file=rel_path,
                          line_start=start, line_end=max(start, end), origin=Origin.AST))

    edges = [Edge(source=ids[e["source"]], target=ids[e["target"]], type=EdgeType.DEFINES)
             for e in result["edges"]
             if e["relation"] == "contains" and e["source"] in ids and e["target"] in ids]
    refs: list[UnresolvedRef] = []
    for rc in result.get("raw_calls") or []:
        name = re.sub(r"\(\)$", "", (rc.get("context") or rc.get("callee") or "").strip())
        source = ids.get(rc.get("caller_nid"), file_id)
        if len(re.split(r"\.|::", name)[-1]) < MIN_MENTION:
            continue
        refs.append(UnresolvedRef(source=source, name=name, type=EdgeType.DOCUMENTS,
                                  line=_line(rc.get("source_location")), col=0))
    return FileExtraction(nodes=nodes, edges=edges, refs=refs)
