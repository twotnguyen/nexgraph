"""Hợp đồng cổng Graphify (ADR 0026 mục A.4–A.5).

- Mọi tên engine dùng từ Graphify đi qua `nexgraph_engine.adapters.graphify.<nhóm>` và còn tồn tại trong vendor
  với đúng loại/chữ ký đã chụp (`fixtures/graphify_gateway_signatures.json`). Nâng hoặc backport vendor mà đổi
  chữ ký thì test này đỏ: xem lại nơi gọi rồi chụp lại bằng `UPDATE_GRAPHIFY_GATEWAY=1 pytest <tệp này>`.
- Ngoài cổng, không tệp nào của `nexgraph_engine` import `graphify`, kể cả import động (`importlib.import_module`,
  `__import__`, `find_spec` với tên chuỗi). Luật import-linter `graphify-gateway` chỉ thấy import tĩnh.
- Hằng đơn giản (chuỗi, số, tập, regex) được chụp cả giá trị, dataclass được chụp danh sách trường: vendor đổi
  `_PR_JSON_FIELDS` hay `_LLM_JSON_MAX_BYTES` cũng làm test đỏ.
- Cổng tra tên lúc import nên `monkeypatch` trên module vendor vẫn có tác dụng như trước khi có cổng.
"""
from __future__ import annotations

import ast
import dataclasses
import importlib
import inspect
import json
import os
import re
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
        if dataclasses.is_dataclass(obj):
            return "dataclass(" + ", ".join(f.name for f in dataclasses.fields(obj)) + ")"
        return "class"
    if callable(obj):
        try:
            return "def" + str(inspect.signature(obj))
        except (TypeError, ValueError):
            return "callable"
    if isinstance(obj, re.Pattern):
        return f"re:{obj.pattern!r}"
    if isinstance(obj, (str, int, float, bool)):
        return f"{type(obj).__name__}:{obj!r}"
    if isinstance(obj, (set, frozenset)):
        same = all(isinstance(x, str) for x in obj) or all(isinstance(x, int) for x in obj)
        return f"{type(obj).__name__}:{sorted(obj) if same else sorted(map(repr, obj))}"
    if isinstance(obj, (list, tuple)) and all(isinstance(x, (str, int, float, bool)) for x in obj):
        return f"{type(obj).__name__}:{list(obj)!r}"
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


DYNAMIC = {"import_module", "__import__", "find_spec"}


def _graphify_imports(tree: ast.AST) -> list[int]:
    """Dòng có import graphify: câu import tĩnh, hoặc import_module/__import__/find_spec với tên chuỗi."""
    lines = []
    for node in ast.walk(tree):
        mods: list[str] = []
        if isinstance(node, ast.Import):
            mods = [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            mods = [node.module]
        elif isinstance(node, ast.Call) and node.args and isinstance(node.args[0], ast.Constant) \
                and isinstance(node.args[0].value, str):
            fn = node.func
            name = fn.attr if isinstance(fn, ast.Attribute) else fn.id if isinstance(fn, ast.Name) else ""
            if name in DYNAMIC:
                mods = [node.args[0].value]
        if any(m == "graphify" or m.startswith("graphify.") for m in mods):
            lines.append(node.lineno)
    return lines


def test_no_graphify_import_outside_gateway():
    hits = []
    for f in PKG.rglob("*.py"):
        if f.is_relative_to(GATE):
            continue
        hits += [f"{f.relative_to(PKG)}:{n}" for n in _graphify_imports(ast.parse(f.read_text(encoding="utf-8")))]
    assert hits == []


def test_import_detector_sees_dynamic_imports():
    src = "import importlib\nimportlib.import_module('graphify.cluster')\n__import__('graphify')\nimport_module('os')\n"
    assert _graphify_imports(ast.parse(src)) == [2, 3]


def test_gateway_resolves_late_so_vendor_monkeypatch_still_applies(monkeypatch):
    import graphify.benchmark

    def fake(*_a, **_k):
        return {"fake": True}

    monkeypatch.setattr(graphify.benchmark, "run_benchmark", fake)
    from nexgraph_engine.adapters.graphify.analysis import run_benchmark

    assert run_benchmark is fake
    module_gate = _gate("export")
    assert module_gate.export is importlib.import_module("graphify.export")
