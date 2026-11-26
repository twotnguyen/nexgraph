"""Cổng Graphify — Chạy CLI của Graphify: `__main__` (tiến trình con `-m graphify`), `cli`.

Sinh và kiểm bởi `tests/test_graphify_gateway.py` (ADR 0026 mục A.4–A.5). Mã engine chỉ import Graphify qua đây.

Tên được tra **mỗi lần** `from nexgraph_engine.adapters.graphify.runner import X` chạy (module `__getattr__`,
không lưu lại), nên import trễ trong hàm vẫn tải module vendor lúc gọi như trước và `monkeypatch` trên
module vendor vẫn có tác dụng.
"""
from __future__ import annotations

from importlib import import_module
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from graphify.__main__ import main
    from graphify.cli import _bash_invokes_search

#: tên cổng → (module vendor, thuộc tính; None = chính module)
NAMES: dict[str, tuple[str, str | None]] = {
    "_bash_invokes_search": ("graphify.cli", "_bash_invokes_search"),
    "main": ("graphify.__main__", "main"),
}

__all__ = ["_bash_invokes_search", "main"]


def __getattr__(name: str) -> Any:
    try:
        module, attr = NAMES[name]
    except KeyError:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}") from None
    mod = import_module(module)
    return mod if attr is None else getattr(mod, attr)
