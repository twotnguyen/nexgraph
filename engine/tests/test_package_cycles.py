"""Không có vòng phụ thuộc giữa các package con của `nexgraph_engine` (ADR 0026 pha 4b).

Trước pha 4b có 5 vòng: index↔store, query↔store, index↔pipeline, index↔sources, flows↔query. Luật tầng
(import-linter `engine-layers`) chỉ chặn import ngược tầng; test này bắt cả vòng giữa hai package cùng tầng.
Tính cả import trễ trong hàm và import chỉ để khai kiểu.
"""
from __future__ import annotations

import ast
from pathlib import Path

PKG = Path(__file__).resolve().parents[1] / "src" / "nexgraph_engine"
# Từ pha 4c, package nằm trong thư mục tầng: so vòng giữa `analysis.query` và `analysis.flows`, không phải giữa tầng.
LAYERS = {"core", "storage", "indexing", "analysis", "interfaces"}


def _key(parts: list[str] | tuple[str, ...]) -> str | None:
    if not parts:
        return None
    head = parts[0].removesuffix(".py")
    if head in LAYERS and len(parts) > 1 and parts[1] != "__init__.py":
        return f"{head}.{parts[1].removesuffix('.py')}"
    return head


def _package_of(module: str) -> str | None:
    parts = module.split(".")
    return _key(parts[1:]) if len(parts) > 1 and parts[0] == "nexgraph_engine" else None


def _exists(key: str) -> bool:
    rel = Path(*key.split("."))
    return (PKG / rel).is_dir() or (PKG / rel.with_suffix(".py")).is_file()


def _graph() -> dict[str, set[str]]:
    deps: dict[str, set[str]] = {}
    for f in PKG.rglob("*.py"):
        rel = f.relative_to(PKG)
        src = _key(rel.parts)
        if src in LAYERS:  # __init__.py của chính thư mục tầng
            continue
        deps.setdefault(src, set())
        for node in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Import):
                targets = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
                targets = [node.module, *(f"{node.module}.{a.name}" for a in node.names)]
            else:
                continue
            for t in targets:
                pkg = _package_of(t)
                if pkg and pkg != src and pkg not in LAYERS and _exists(pkg):
                    deps[src].add(pkg)
    return deps


def _cycles(deps: dict[str, set[str]]) -> list[list[str]]:
    """Thành phần liên thông mạnh có từ hai package trở lên (Tarjan)."""
    index: dict[str, int] = {}
    low: dict[str, int] = {}
    stack: list[str] = []
    on: set[str] = set()
    out: list[list[str]] = []

    def visit(v: str) -> None:
        index[v] = low[v] = len(index)
        stack.append(v)
        on.add(v)
        for w in deps.get(v, ()):
            if w not in index:
                visit(w)
                low[v] = min(low[v], low[w])
            elif w in on:
                low[v] = min(low[v], index[w])
        if low[v] == index[v]:
            comp = []
            while True:
                w = stack.pop()
                on.discard(w)
                comp.append(w)
                if w == v:
                    break
            if len(comp) > 1:
                out.append(sorted(comp))

    for v in sorted(deps):
        if v not in index:
            visit(v)
    return out


def test_no_dependency_cycle_between_engine_packages():
    assert _cycles(_graph()) == []


def test_cycle_detector_finds_a_cycle():
    assert _cycles({"a": {"b"}, "b": {"c"}, "c": {"a"}, "d": {"a"}}) == [["a", "b", "c"]]
