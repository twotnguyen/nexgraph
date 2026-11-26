"""Ánh xạ `graph.json` của Graphify → schema `graph.db` (ADR 0023).

Một chỗ duy nhất cho bảng `relation` → loại cạnh, để bộ nạp đầy đủ (NG-IMP-1) và bộ nạp
tăng dần (NG-IMP-3) không lệch nhau. Bảng theo spike A1 §4.3; quan hệ lạ rơi vào
`REFERENCES` với `loai_con` = tên gốc để không mất thông tin.
"""
from __future__ import annotations

import re
from pathlib import Path

from nexgraph_engine.graphify_import.paths import (
    MAX_REL_PATH, has_nul, is_absolute_source, is_host_absolute, relative_posix_in_root, resolve_inside_root,
)
from nexgraph_engine.schema.enums import EdgeType, Origin

# graph.json không có nút gốc/khái niệm ngoài tệp: mọi nút thiếu `source_file` được gắn vào
# tệp tổng hợp này để thoả RB11 (chỉ repository/directory được phép không có tệp).
EXTERNAL_FILE = "__(graphify-external)"

RELATION: dict[str, tuple[EdgeType, str | None]] = {
    "contains": (EdgeType.CONTAINS, None),
    "defines": (EdgeType.DEFINES, None),
    "declares": (EdgeType.DEFINES, "declares"),
    "calls": (EdgeType.CALLS, None),
    "indirect_call": (EdgeType.CALLS, "indirect_call"),
    "method": (EdgeType.CONTAINS, "method"),
    "imports": (EdgeType.IMPORTS, None),
    "imports_from": (EdgeType.IMPORTS, "imports_from"),
    "re_exports": (EdgeType.IMPORTS, "re_exports"),
    "dynamic_import": (EdgeType.IMPORTS, "dynamic_import"),
    "exports": (EdgeType.IMPORTS, "exports"),
    "inherits": (EdgeType.INHERITS, None),
    "extends": (EdgeType.INHERITS, "extends"),
    "implements": (EdgeType.IMPLEMENTS, None),
    "mixes_in": (EdgeType.IMPLEMENTS, "mixes_in"),
    "references": (EdgeType.REFERENCES, None),
    "references_constant": (EdgeType.REFERENCES, "references_constant"),
    "uses": (EdgeType.REFERENCES, "uses"),
    "uses_config": (EdgeType.REFERENCES, "uses_config"),
    "uses_static_prop": (EdgeType.REFERENCES, "uses_static_prop"),
    "instantiates": (EdgeType.REFERENCES, "instantiates"),
    "triggers": (EdgeType.REFERENCES, "triggers"),
    "indexes": (EdgeType.REFERENCES, "indexes"),
    "requires_env": (EdgeType.REFERENCES, "requires_env"),
    "reads_from": (EdgeType.REFERENCES, "reads_from"),
    "case_of": (EdgeType.REFERENCES, "case_of"),
    "embeds": (EdgeType.REFERENCES, "embeds"),
    "listened_by": (EdgeType.REFERENCES, "listened_by"),
    "bound_to": (EdgeType.REFERENCES, "bound_to"),
    "dispatches_to": (EdgeType.REFERENCES, "dispatches_to"),
    "specializes": (EdgeType.INHERITS, "specializes"),
    "rationale_for": (EdgeType.DOCUMENTS, None),
    "cites": (EdgeType.DOCUMENTS, "cites"),
    "depends_on": (EdgeType.DEPENDS_ON, None),
    "semantically_similar_to": (EdgeType.SEMANTIC_RELATED, None),
    "composes": (EdgeType.COMPOSES, None),
    "navigates": (EdgeType.NAVIGATES_TO, None),
    "tested_by": (EdgeType.TESTED_BY, None),
}

# RB12: các loại cạnh bắt buộc có dòng bằng chứng.
NEEDS_EVIDENCE = frozenset({
    "CALLS", "IMPORTS", "INHERITS", "IMPLEMENTS", "REFERENCES",
    "USES_TYPE", "COMPOSES", "NAVIGATES_TO",
})

_LOCATION = re.compile(r"^L(\d+)(?:-\d+)?$")


def parse_location(value: object) -> int | None:
    """`"L12"`/`"L12-15"` → 12; giá trị khác → None."""
    if not isinstance(value, str):
        return None
    match = _LOCATION.match(value.strip())
    return int(match.group(1)) if match else None


def relation_to_edge(relation: str) -> tuple[EdgeType, str | None]:
    mapped = RELATION.get(relation)
    if mapped is not None:
        return mapped
    return EdgeType.REFERENCES, (relation[:50] or None)


def origin_of(raw: object) -> Origin:
    """`_origin` của Graphify (`ast`/`llm`) → `nguon_goc`; thiếu thì là suy đoán (`resolver`)."""
    if raw == "ast":
        return Origin.AST
    if raw == "llm":
        return Origin.LLM
    return Origin.RESOLVER


def normalise_rel_path(raw: object, root, *, cache: dict[str, str] | None = None) -> str:
    """Đưa `source_file` về đường dẫn tương đối kiểu POSIX (RB3: không mở đầu `/`, không `\\`).

    Đường tuyệt đối (POSIX, Windows có ổ đĩa, UNC) được resolve rồi mới đổi thành tương đối;
    chỉ nhận khi đích thật nằm trong `root`. Trả `""` khi đường dẫn thoát gốc dự án: tuyệt đối
    ở ngoài, có `..`, hoặc symlink có đích thật ra ngoài (QA #67.2, QA vòng 2.1).

    `cache` (tuỳ chọn) chỉ sống trong **một lần parse/nạp** — không dùng cache toàn cục, để
    quyết định từ chối của lần nạp trước không ảnh hưởng lần sau trong cùng tiến trình
    (QA vòng 2.3). `root` phải là đường dẫn thật (đã resolve).
    """
    if not isinstance(raw, str) or not raw.strip():
        return ""
    text = raw.strip()
    if cache is not None and text in cache:
        return cache[text]
    result = _normalise(text, root)
    if len(result) > MAX_REL_PATH:
        result = ""  # vượt giới hạn cột `tep`: từ chối thay vì để IntegrityError làm hỏng cả lần nạp
    if cache is not None:
        cache[text] = result
    return result


def _normalise(text: str, root) -> str:
    if has_nul(text):
        return ""  # QA #67 vòng 4: NUL làm `resolve()` ném ValueError, hỏng cả lần nạp
    if is_absolute_source(text):
        if not is_host_absolute(text):
            return ""  # cú pháp của nền tảng khác (Windows trên POSIX, `/…` trên Windows): không xác thực được
        try:
            candidate = Path(text).resolve()
        except (OSError, RuntimeError, ValueError):
            return ""
        return relative_posix_in_root(Path(root), candidate) or ""
    text = text.replace("\\", "/")
    while text.startswith("./"):
        text = text[2:]
    if any(part == ".." for part in text.split("/")):
        return ""
    if resolve_inside_root(Path(root), text) is None:
        return ""
    return text
