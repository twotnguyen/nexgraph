"""Lời gọi liên tệp của ngôn ngữ mức chung bằng extract() cả lô của graphify (W2, Ruling Task 1).

Node vẫn trích từng tệp (id NexGraph ổn định, index tăng dần); bước này chỉ thêm cạnh CALLS mà resolver của
graphify nối được giữa hai tệp, ánh xạ hai đầu theo (đường dẫn tương đối, dòng, tên).
"""
from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path

from nexgraph_engine.adapters.graphify.extract import extract

from nexgraph_engine.index.generic import _cache_root, _line
from nexgraph_engine.schema.enums import Confidence, EdgeType, Origin
from nexgraph_engine.store.models import Edge, Node


def _short(label: str) -> str:
    name = label.removesuffix("()").lstrip(".")
    return name.replace("::", ".").rsplit(".", 1)[-1]


def batch_cross_file_calls(root: Path, files: list[str], nodes: Iterable[Node]) -> list[Edge]:
    if len(files) < 2:
        return []
    root = Path(root).resolve()
    index: dict[tuple[str, int, str], str] = {}
    for n in nodes:
        if n.file:
            index.setdefault((n.file, n.line_start, _short(n.label)), n.id)
    result = extract([root / f for f in files], cache_root=_cache_root(), root=root, parallel=False)

    def ours(g: dict) -> str | None:
        sf, line = g.get("source_file"), _line(g.get("source_location"))
        if not sf or line is None:
            return None
        try:
            rel = Path(sf).resolve().relative_to(root).as_posix() if Path(sf).is_absolute() else Path(sf).as_posix()
        except ValueError:
            return None
        return index.get((rel, line, _short(g.get("label", ""))))

    mapped = {g["id"]: ours(g) for g in result["nodes"]}
    out: list[Edge] = []
    for e in result["edges"]:
        if e["relation"] != "calls":
            continue
        src, dst = mapped.get(e["source"]), mapped.get(e["target"])
        if not src or not dst or src.split("::")[0] == dst.split("::")[0]:
            continue
        inferred = e.get("confidence") == "INFERRED"
        out.append(Edge(source=src, target=dst, type=EdgeType.CALLS, origin=Origin.RESOLVER,
                        confidence=Confidence.INFERRED if inferred else Confidence.EXTRACTED,
                        confidence_score=0.8 if inferred else 1.0, line=_line(e.get("source_location")),
                        col=0))  # cùng cột với cạnh của resolver để chỉ mục uq_canh chặn bản trùng
    return out
