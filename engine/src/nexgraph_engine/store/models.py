from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from nexgraph_engine.schema.enums import Confidence, EdgeType, NodeKind, Origin

RunState = Literal["cho", "cau_truc", "phan_giai", "hoan_tat", "loi", "huy"]


@dataclass(frozen=True)
class Node:
    id: str
    kind: NodeKind
    label: str
    qualified_name: str
    language: str | None = None  # chỉ đọc: điền khi đọc từ CSDL (lấy từ tệp)
    file: str | None = None
    line_start: int | None = None
    line_end: int | None = None
    is_test: bool = False
    origin: Origin = Origin.AST
    signature: str | None = None
    doc: str | None = None


@dataclass(frozen=True)
class Edge:
    source: str
    target: str
    type: EdgeType
    subtype: str | None = None
    confidence: Confidence = Confidence.EXTRACTED
    confidence_score: float = 1.0
    origin: Origin = Origin.AST
    line: int | None = None
    col: int | None = None


@dataclass(frozen=True)
class StoredEdge:
    id: int
    edge: Edge
    file: str | None  # tệp bằng chứng = tệp của nút nguồn


@dataclass(frozen=True)
class UnresolvedRef:
    source: str
    name: str
    type: EdgeType
    line: int
    col: int


@dataclass(frozen=True)
class FileRec:
    rel_path: str
    language: str
    size: int
    mtime: int
    sha256: str
    is_test: bool = False


@dataclass(frozen=True)
class Neighborhood:
    nodes: list[Node]
    edges: list[StoredEdge]
    truncated: bool
