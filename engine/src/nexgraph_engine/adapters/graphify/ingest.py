"""Cổng Graphify — Nạp nguồn ngoài mã: `ingest`, `*_introspect`, `*_ingest`, `google_workspace`, `transcribe`.

Kiểm bởi `tests/adapters/test_graphify_gateway.py` (ADR 0026 mục A.4–A.5); thêm tên thì sửa tay `NAMES` và khối
`TYPE_CHECKING`, rồi chụp lại chữ ký. Mã engine chỉ import Graphify qua đây.

Tên được tra **mỗi lần** `from nexgraph_engine.adapters.graphify.ingest import X` chạy (module `__getattr__`,
không lưu lại), nên import trễ trong hàm vẫn tải module vendor lúc gọi như trước và `monkeypatch` trên
module vendor vẫn có tác dụng.
"""
from __future__ import annotations

from importlib import import_module
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from graphify.cargo_introspect import introspect_cargo
    from graphify.google_workspace import convert_google_workspace_file
    from graphify.ingest import ingest
    from graphify.manifest_ingest import extract_package_manifest
    from graphify.mcp_ingest import extract_mcp_config
    from graphify.pg_introspect import introspect_postgres
    from graphify.scip_ingest import ingest_scip_json
    from graphify import transcribe

#: tên cổng → (module vendor, thuộc tính; None = chính module)
NAMES: dict[str, tuple[str, str | None]] = {
    "convert_google_workspace_file": ("graphify.google_workspace", "convert_google_workspace_file"),
    "extract_mcp_config": ("graphify.mcp_ingest", "extract_mcp_config"),
    "extract_package_manifest": ("graphify.manifest_ingest", "extract_package_manifest"),
    "ingest": ("graphify.ingest", "ingest"),
    "ingest_scip_json": ("graphify.scip_ingest", "ingest_scip_json"),
    "introspect_cargo": ("graphify.cargo_introspect", "introspect_cargo"),
    "introspect_postgres": ("graphify.pg_introspect", "introspect_postgres"),
    "transcribe": ("graphify.transcribe", None),
}

__all__ = ["convert_google_workspace_file", "extract_mcp_config", "extract_package_manifest", "ingest", "ingest_scip_json", "introspect_cargo", "introspect_postgres", "transcribe"]


def __getattr__(name: str) -> Any:
    try:
        module, attr = NAMES[name]
    except KeyError:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}") from None
    mod = import_module(module)
    return mod if attr is None else getattr(mod, attr)
