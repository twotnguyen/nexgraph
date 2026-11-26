"""Cổng Graphify — Trích xuất AST và phát hiện tệp: `extract`, `detect`, `rcfile`, `extractors`.

Kiểm bởi `tests/test_graphify_gateway.py` (ADR 0026 mục A.4–A.5); thêm tên thì sửa tay `NAMES` và khối
`TYPE_CHECKING`, rồi chụp lại chữ ký. Mã engine chỉ import Graphify qua đây.

Tên được tra **mỗi lần** `from nexgraph_engine.adapters.graphify.extract import X` chạy (module `__getattr__`,
không lưu lại), nên import trễ trong hàm vẫn tải module vendor lúc gọi như trước và `monkeypatch` trên
module vendor vẫn có tác dụng.
"""
from __future__ import annotations

from importlib import import_module
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from graphify.detect import DOC_EXTENSIONS, _AMBIGUOUS_SENSITIVE_DIRS, _CREDENTIAL_STORE_DIRS, _is_sensitive, docx_to_markdown, extract_pdf_text, xlsx_to_markdown
    from graphify.extract import _file_node_id, _get_extractor, _safe_extract_with_xaml_root, extract
    from graphify.extractors.json_config import _CONFIG_JSON_NAMES
    from graphify.extractors.markdown import extract_markdown
    from graphify.rcfile import activate_language_overrides

#: tên cổng → (module vendor, thuộc tính; None = chính module)
NAMES: dict[str, tuple[str, str | None]] = {
    "DOC_EXTENSIONS": ("graphify.detect", "DOC_EXTENSIONS"),
    "_AMBIGUOUS_SENSITIVE_DIRS": ("graphify.detect", "_AMBIGUOUS_SENSITIVE_DIRS"),
    "_CONFIG_JSON_NAMES": ("graphify.extractors.json_config", "_CONFIG_JSON_NAMES"),
    "_CREDENTIAL_STORE_DIRS": ("graphify.detect", "_CREDENTIAL_STORE_DIRS"),
    "_file_node_id": ("graphify.extract", "_file_node_id"),
    "_get_extractor": ("graphify.extract", "_get_extractor"),
    "_is_sensitive": ("graphify.detect", "_is_sensitive"),
    "_safe_extract_with_xaml_root": ("graphify.extract", "_safe_extract_with_xaml_root"),
    "activate_language_overrides": ("graphify.rcfile", "activate_language_overrides"),
    "docx_to_markdown": ("graphify.detect", "docx_to_markdown"),
    "extract": ("graphify.extract", "extract"),
    "extract_markdown": ("graphify.extractors.markdown", "extract_markdown"),
    "extract_pdf_text": ("graphify.detect", "extract_pdf_text"),
    "xlsx_to_markdown": ("graphify.detect", "xlsx_to_markdown"),
}

__all__ = ["DOC_EXTENSIONS", "_AMBIGUOUS_SENSITIVE_DIRS", "_CONFIG_JSON_NAMES", "_CREDENTIAL_STORE_DIRS", "_file_node_id", "_get_extractor", "_is_sensitive", "_safe_extract_with_xaml_root", "activate_language_overrides", "docx_to_markdown", "extract", "extract_markdown", "extract_pdf_text", "xlsx_to_markdown"]


def __getattr__(name: str) -> Any:
    try:
        module, attr = NAMES[name]
    except KeyError:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}") from None
    mod = import_module(module)
    return mod if attr is None else getattr(mod, attr)
