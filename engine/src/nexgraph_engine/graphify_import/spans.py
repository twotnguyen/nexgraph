"""Đọc lại tệp nguồn bằng tree-sitter để lấy span, chữ ký và loại nút (NG-IMP-2).

Không gọi resolver, không dựng lại đồ thị: chỉ parse cây cú pháp của tệp đã có nút trong
`graph.json`. Grammar lấy từ các gói engine đã đóng gói (`tree_sitter_python`,
`tree_sitter_typescript`), cùng bộ mà `index/generic.py` dùng cho bước trích xuất hiện có.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

_PY_SUFFIXES = {".py", ".pyi"}
_TS_SUFFIXES = {".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"}
_TS_FUNCTIONS = ("arrow_function", "function_expression", "generator_function")


@dataclass(frozen=True)
class Span:
    """Một khai báo đọc được từ tệp nguồn; `start`/`end` là dòng 1-based, tính cả hai đầu."""

    name: str
    kind: str  # "class" | "function" | "method"
    start: int
    end: int
    signature: str


def file_spans(path: Path) -> list[Span] | None:
    """Các span của một tệp; `None` khi không đọc/không parse được (không phải lỗi của lần nạp)."""
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix not in _PY_SUFFIXES and suffix not in _TS_SUFFIXES:
        return None
    try:
        source = path.read_bytes()
        tree = _parser(suffix).parse(source)
    except Exception:  # grammar thiếu, tệp hỏng, quyền đọc… đều chỉ làm bước bổ sung bị bỏ
        logger.warning("Không đọc được span của %s", path, exc_info=True)
        return None
    out: list[Span] = []
    if suffix in _PY_SUFFIXES:
        _walk_python(tree.root_node, source, out, in_class=False)
    else:
        _walk_typescript(tree.root_node, source, out, in_class=False)
    return out


def _parser(suffix: str):
    from tree_sitter import Language, Parser

    if suffix in _PY_SUFFIXES:
        import tree_sitter_python

        return Parser(Language(tree_sitter_python.language()))
    import tree_sitter_typescript

    language = (tree_sitter_typescript.language_tsx if suffix in (".tsx", ".jsx")
                else tree_sitter_typescript.language_typescript)
    return Parser(Language(language()))


def _text(source: bytes, node) -> str:
    return source[node.start_byte:node.end_byte].decode("utf-8", "replace")


def _signature(source: bytes, node, body) -> str:
    """Chữ ký = phần đầu khai báo tới trước thân (bỏ `{`, `:`, `;` cuối)."""
    end = body.start_byte if body is not None else node.end_byte
    text = " ".join(source[node.start_byte:end].decode("utf-8", "replace").split())
    return text.rstrip("{:;").strip()[:2000]


def _add(source: bytes, node, name_node, kind: str, out: list[Span], *, span_node=None) -> None:
    if name_node is None:
        return
    holder = span_node if span_node is not None else node
    out.append(Span(
        name=_text(source, name_node), kind=kind,
        start=holder.start_point[0] + 1, end=holder.end_point[0] + 1,
        signature=_signature(source, holder, node.child_by_field_name("body")),
    ))


def _walk_python(node, source: bytes, out: list[Span], *, in_class: bool) -> None:
    for child in node.children:
        kind = child.type
        if kind == "decorated_definition":
            definition = child.child_by_field_name("definition")
            if definition is not None:
                _python_definition(definition, source, out, in_class=in_class)
            continue
        if kind in ("function_definition", "class_definition"):
            _python_definition(child, source, out, in_class=in_class)
            continue
        _walk_python(child, source, out, in_class=in_class)


def _python_definition(node, source: bytes, out: list[Span], *, in_class: bool) -> None:
    if node.type == "class_definition":
        _add(source, node, node.child_by_field_name("name"), "class", out)
        _walk_python(node, source, out, in_class=True)
        return
    _add(source, node, node.child_by_field_name("name"), "method" if in_class else "function", out)
    _walk_python(node, source, out, in_class=False)  # hàm lồng trong thân hàm là function


def _walk_typescript(node, source: bytes, out: list[Span], *, in_class: bool) -> None:
    for child in node.children:
        kind = child.type
        if kind == "class_declaration":
            _add(source, child, child.child_by_field_name("name"), "class", out)
            _walk_typescript(child, source, out, in_class=True)
            continue
        if kind == "method_definition":
            _add(source, child, child.child_by_field_name("name"), "method", out)
            _walk_typescript(child, source, out, in_class=True)
            continue
        if kind in ("function_declaration", "generator_function_declaration"):
            _add(source, child, child.child_by_field_name("name"), "function", out)
            _walk_typescript(child, source, out, in_class=False)
            continue
        if kind in ("lexical_declaration", "variable_declaration"):
            for declarator in child.children:
                if declarator.type != "variable_declarator":
                    continue
                value = declarator.child_by_field_name("value")
                if value is not None and value.type in _TS_FUNCTIONS:
                    _add(source, value, declarator.child_by_field_name("name"), "function", out,
                         span_node=child)
            _walk_typescript(child, source, out, in_class=in_class)
            continue
        if kind in ("public_field_definition", "field_definition"):
            value = child.child_by_field_name("value")
            if value is not None and value.type in _TS_FUNCTIONS:
                _add(source, value, child.child_by_field_name("name"),
                     "method" if in_class else "function", out)
            _walk_typescript(child, source, out, in_class=in_class)
            continue
        _walk_typescript(child, source, out, in_class=in_class)
