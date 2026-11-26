"""Cổng Graphify — Phân tích và báo cáo: `analyze`, `report`, `benchmark`, `wiki`, `callflow_html`.

Kiểm bởi `tests/adapters/test_graphify_gateway.py` (ADR 0026 mục A.4–A.5); thêm tên thì sửa tay `NAMES` và khối
`TYPE_CHECKING`, rồi chụp lại chữ ký. Mã engine chỉ import Graphify qua đây.

Tên được tra **mỗi lần** `from nexgraph_engine.adapters.graphify.analysis import X` chạy (module `__getattr__`,
không lưu lại), nên import trễ trong hàm vẫn tải module vendor lúc gọi như trước và `monkeypatch` trên
module vendor vẫn có tác dụng.
"""
from __future__ import annotations

from importlib import import_module
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from graphify.analyze import god_nodes, suggest_questions, surprising_connections
    from graphify.benchmark import run_benchmark
    from graphify.callflow_html import should_include_edge, write_callflow_html
    from graphify.report import generate
    from graphify.wiki import to_wiki

#: tên cổng → (module vendor, thuộc tính; None = chính module)
NAMES: dict[str, tuple[str, str | None]] = {
    "generate": ("graphify.report", "generate"),
    "god_nodes": ("graphify.analyze", "god_nodes"),
    "run_benchmark": ("graphify.benchmark", "run_benchmark"),
    "should_include_edge": ("graphify.callflow_html", "should_include_edge"),
    "suggest_questions": ("graphify.analyze", "suggest_questions"),
    "surprising_connections": ("graphify.analyze", "surprising_connections"),
    "to_wiki": ("graphify.wiki", "to_wiki"),
    "write_callflow_html": ("graphify.callflow_html", "write_callflow_html"),
}

__all__ = ["generate", "god_nodes", "run_benchmark", "should_include_edge", "suggest_questions", "surprising_connections", "to_wiki", "write_callflow_html"]


def __getattr__(name: str) -> Any:
    try:
        module, attr = NAMES[name]
    except KeyError:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}") from None
    mod = import_module(module)
    return mod if attr is None else getattr(mod, attr)
