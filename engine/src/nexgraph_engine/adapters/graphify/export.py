"""Cổng Graphify — Xuất đồ thị: `export`, `exporters.html`, `exporters.graphdb`.

Kiểm bởi `tests/test_graphify_gateway.py` (ADR 0026 mục A.4–A.5); thêm tên thì sửa tay `NAMES` và khối
`TYPE_CHECKING`, rồi chụp lại chữ ký. Mã engine chỉ import Graphify qua đây.

Tên được tra **mỗi lần** `from nexgraph_engine.adapters.graphify.export import X` chạy (module `__getattr__`,
không lưu lại), nên import trễ trong hàm vẫn tải module vendor lúc gọi như trước và `monkeypatch` trên
module vendor vẫn có tác dụng.
"""
from __future__ import annotations

from importlib import import_module
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from graphify import export
    from graphify.export import _git_head, to_json
    from graphify.exporters.graphdb import push_to_falkordb, push_to_neo4j
    from graphify.exporters.html import to_html

#: tên cổng → (module vendor, thuộc tính; None = chính module)
NAMES: dict[str, tuple[str, str | None]] = {
    "_git_head": ("graphify.export", "_git_head"),
    "export": ("graphify.export", None),
    "push_to_falkordb": ("graphify.exporters.graphdb", "push_to_falkordb"),
    "push_to_neo4j": ("graphify.exporters.graphdb", "push_to_neo4j"),
    "to_html": ("graphify.exporters.html", "to_html"),
    "to_json": ("graphify.export", "to_json"),
}

__all__ = ["_git_head", "export", "push_to_falkordb", "push_to_neo4j", "to_html", "to_json"]


def __getattr__(name: str) -> Any:
    try:
        module, attr = NAMES[name]
    except KeyError:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}") from None
    mod = import_module(module)
    return mod if attr is None else getattr(mod, attr)
