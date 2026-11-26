"""Cổng Graphify — Kiểm URL, che bí mật, làm sạch nhãn: `security`.

Kiểm bởi `tests/adapters/test_graphify_gateway.py` (ADR 0026 mục A.4–A.5); thêm tên thì sửa tay `NAMES` và khối
`TYPE_CHECKING`, rồi chụp lại chữ ký. Mã engine chỉ import Graphify qua đây.

Tên được tra **mỗi lần** `from nexgraph_engine.adapters.graphify.security import X` chạy (module `__getattr__`,
không lưu lại), nên import trễ trong hàm vẫn tải module vendor lúc gọi như trước và `monkeypatch` trên
module vendor vẫn có tác dụng.
"""
from __future__ import annotations

from importlib import import_module
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from graphify.security import _CGN_NETWORK, _ip_is_blocked, redact_secrets, sanitize_label, validate_url

#: tên cổng → (module vendor, thuộc tính; None = chính module)
NAMES: dict[str, tuple[str, str | None]] = {
    "_CGN_NETWORK": ("graphify.security", "_CGN_NETWORK"),
    "_ip_is_blocked": ("graphify.security", "_ip_is_blocked"),
    "redact_secrets": ("graphify.security", "redact_secrets"),
    "sanitize_label": ("graphify.security", "sanitize_label"),
    "validate_url": ("graphify.security", "validate_url"),
}

__all__ = ["_CGN_NETWORK", "_ip_is_blocked", "redact_secrets", "sanitize_label", "validate_url"]


def __getattr__(name: str) -> Any:
    try:
        module, attr = NAMES[name]
    except KeyError:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}") from None
    mod = import_module(module)
    return mod if attr is None else getattr(mod, attr)
