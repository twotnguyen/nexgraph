"""Hợp đồng cổng Graphify (ADR 0026 mục A.4–A.5).

- Mọi tên engine dùng từ Graphify đi qua `nexgraph_engine.adapters.graphify.<nhóm>` và còn tồn tại trong vendor
  với đúng loại/chữ ký đã chụp (`fixtures/graphify_gateway_signatures.json`). Nâng hoặc backport vendor mà đổi
  chữ ký thì test này đỏ: xem lại nơi gọi rồi chụp lại bằng `UPDATE_GRAPHIFY_GATEWAY=1 pytest <tệp này>`.
- Ngoài cổng, không tệp nào của `nexgraph_engine` import `graphify` (luật import-linter `graphify-gateway`
  kiểm cùng điều này nhưng còn ở chế độ báo cáo; test này chạy trong job bắt buộc `engine`).
- Cổng tra tên lúc import nên `monkeypatch` trên module vendor vẫn có tác dụng như trước khi có cổng.
"""
from __future__ import annotations

import ast
import importlib
import inspect
import json
import os
from pathlib import Path

import pytest

ENGINE = Path(__file__).resolve().parents[1]
PKG = ENGINE / "src" / "nexgraph_engine"
GATE = PKG / "adapters" / "graphify"
SNAPSHOT = Path(__file__).parent / "fixtures" / "graphify_gateway_signatures.json"
GROUPS = sorted(p.stem for p in GATE.glob("*.py") if p.name != "__init__.py")


def _gate(group: str):
    return importlib.import_module(f"nexgraph_engine.adapters.graphify.{group}")


def _kind(obj: object, attr: str | None) -> str:
    if attr is None:
        return "module"
    if inspect.isclass(obj):
        return "class"
    if callable(obj):
        try:
            return "def" + str(inspect.signature(obj))
        except (TypeError, ValueError):
            return "callable"
    return type(obj).__name__


def _current() -> dict[str, str]:
    out = {}
    for group in GROUPS:
        gate = _gate(group)
        for name, (_module, attr) in gate.NAMES.items():
            out[f"{group}.{name}"] = _kind(getattr(gate, name), attr)
    return dict(sorted(out.items()))


def test_groups_match_adr_capabilities():
    assert GROUPS == ["analysis", "export", "extract", "ingest", "llm", "runner", "security", "serve"]


def test_every_gateway_name_exists_with_recorded_signature():
    current = _current()
    if os.environ.get("UPDATE_GRAPHIFY_GATEWAY") == "1":
        SNAPSHOT.write_text(json.dumps(current, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    assert current == json.loads(SNAPSHOT.read_text(encoding="utf-8"))


@pytest.mark.parametrize("group", GROUPS)
def test_gateway_targets_only_graphify_and_exports_match(group):
    gate = _gate(group)
    assert gate.NAMES and all(m == "graphify" or m.startswith("graphify.") for m, _ in gate.NAMES.values())
    assert sorted(gate.__all__) == sorted(gate.NAMES)
    # Khối TYPE_CHECKING (cho IDE/kiểu) phải khai báo đúng các tên trong bảng.
    tree = ast.parse((GATE / f"{group}.py").read_text(encoding="utf-8"))
    typed = {
        alias.asname or alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.If) and isinstance(node.test, ast.Name) and node.test.id == "TYPE_CHECKING"
        for stmt in node.body if isinstance(stmt, ast.ImportFrom)
        for alias in stmt.names
    }
    assert typed == set(gate.NAMES)


def test_unknown_name_raises_attribute_error():
    with pytest.raises(AttributeError):
        _gate("serve").khong_co_ten_nay  # noqa: B018
    with pytest.raises(ImportError):
        exec("from nexgraph_engine.adapters.graphify.serve import khong_co_ten_nay", {})


def test_no_graphify_import_outside_gateway():
    hits = []
    for f in PKG.rglob("*.py"):
        if f.is_relative_to(GATE):
            continue
        for node in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
            mods = [a.name for a in node.names] if isinstance(node, ast.Import) else (
                [node.module] if isinstance(node, ast.ImportFrom) and node.module and node.level == 0 else [])
            if any(m == "graphify" or m.startswith("graphify.") for m in mods):
                hits.append(f"{f.relative_to(PKG)}:{node.lineno}")
    assert hits == []


def test_gateway_resolves_late_so_vendor_monkeypatch_still_applies(monkeypatch):
    import graphify.benchmark

    def fake(*_a, **_k):
        return {"fake": True}

    monkeypatch.setattr(graphify.benchmark, "run_benchmark", fake)
    from nexgraph_engine.adapters.graphify.analysis import run_benchmark

    assert run_benchmark is fake
    module_gate = _gate("export")
    assert module_gate.export is importlib.import_module("graphify.export")
