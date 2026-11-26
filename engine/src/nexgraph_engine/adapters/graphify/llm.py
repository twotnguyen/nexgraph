"""Cổng Graphify — Trích xuất ngữ nghĩa bằng LLM: `llm`, `dedup`, `validate`.

Kiểm bởi `tests/adapters/test_graphify_gateway.py` (ADR 0026 mục A.4–A.5); thêm tên thì sửa tay `NAMES` và khối
`TYPE_CHECKING`, rồi chụp lại chữ ký. Mã engine chỉ import Graphify qua đây.

Tên được tra **mỗi lần** `from nexgraph_engine.adapters.graphify.llm import X` chạy (module `__getattr__`,
không lưu lại), nên import trễ trong hàm vẫn tải module vendor lúc gọi như trước và `monkeypatch` trên
module vendor vẫn có tác dụng.
"""
from __future__ import annotations

from importlib import import_module
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from graphify.dedup import deduplicate_entities
    from graphify.llm import _FILE_CHAR_CAP, _IMAGE_MEDIA_TYPES, _IMAGE_TOKEN_ESTIMATE, _LABEL_FENCE_RE, _LLM_JSON_MAX_BYTES, _MAX_IMAGE_BYTES, _estimate_prompt_tokens, _extraction_system, _openai_max_tokens_kwarg, _parse_label_response, _parse_llm_json, _resolve_temperature, _wrap_untrusted, provider_base_url_ok
    from graphify.validate import validate_extraction

#: tên cổng → (module vendor, thuộc tính; None = chính module)
NAMES: dict[str, tuple[str, str | None]] = {
    "_FILE_CHAR_CAP": ("graphify.llm", "_FILE_CHAR_CAP"),
    "_IMAGE_MEDIA_TYPES": ("graphify.llm", "_IMAGE_MEDIA_TYPES"),
    "_IMAGE_TOKEN_ESTIMATE": ("graphify.llm", "_IMAGE_TOKEN_ESTIMATE"),
    "_LABEL_FENCE_RE": ("graphify.llm", "_LABEL_FENCE_RE"),
    "_LLM_JSON_MAX_BYTES": ("graphify.llm", "_LLM_JSON_MAX_BYTES"),
    "_MAX_IMAGE_BYTES": ("graphify.llm", "_MAX_IMAGE_BYTES"),
    "_estimate_prompt_tokens": ("graphify.llm", "_estimate_prompt_tokens"),
    "_extraction_system": ("graphify.llm", "_extraction_system"),
    "_openai_max_tokens_kwarg": ("graphify.llm", "_openai_max_tokens_kwarg"),
    "_parse_label_response": ("graphify.llm", "_parse_label_response"),
    "_parse_llm_json": ("graphify.llm", "_parse_llm_json"),
    "_resolve_temperature": ("graphify.llm", "_resolve_temperature"),
    "_wrap_untrusted": ("graphify.llm", "_wrap_untrusted"),
    "deduplicate_entities": ("graphify.dedup", "deduplicate_entities"),
    "provider_base_url_ok": ("graphify.llm", "provider_base_url_ok"),
    "validate_extraction": ("graphify.validate", "validate_extraction"),
}

__all__ = ["_FILE_CHAR_CAP", "_IMAGE_MEDIA_TYPES", "_IMAGE_TOKEN_ESTIMATE", "_LABEL_FENCE_RE", "_LLM_JSON_MAX_BYTES", "_MAX_IMAGE_BYTES", "_estimate_prompt_tokens", "_extraction_system", "_openai_max_tokens_kwarg", "_parse_label_response", "_parse_llm_json", "_resolve_temperature", "_wrap_untrusted", "deduplicate_entities", "provider_base_url_ok", "validate_extraction"]


def __getattr__(name: str) -> Any:
    try:
        module, attr = NAMES[name]
    except KeyError:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}") from None
    mod = import_module(module)
    return mod if attr is None else getattr(mod, attr)
