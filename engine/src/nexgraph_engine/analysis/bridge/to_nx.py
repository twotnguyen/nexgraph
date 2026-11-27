"""Dựng `networkx` theo định dạng thuộc tính của Graphify từ CSDL SQLite (spec F10 §4.1).

Dùng để gọi lại hàm export/analyze/report của bản vendor `graphify/`. SQLite vẫn là nguồn sự thật:
đồ thị này dựng mới cho mỗi lần gọi, có giới hạn số node, không lưu lại.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import networkx as nx

from nexgraph_engine.indexing.graphify_import.mapping import EXTERNAL_FILE
from nexgraph_engine.indexing.index.discovery import (DOC_LANGUAGE_BY_EXT, DOC_LANGUAGES, GOOGLE_WORKSPACE_EXTS,
                                                      IMAGE_EXTS, MEDIA_EXTS)
from nexgraph_engine.storage.store.graph_store import GraphStore

EXPORT_NODE_LIMIT = 5000
OTHER_COMMUNITY = -1


_DOC_EXTS = frozenset({*DOC_LANGUAGE_BY_EXT, *IMAGE_EXTS, *MEDIA_EXTS, *GOOGLE_WORKSPACE_EXTS})


def _file_type(kind: str, language: str | None, path: str | None) -> str:
    """`file_type` như Graphify ghi: vendor phân biệt các giá trị này (`suggest_questions` bỏ node `rationale`
    khỏi danh sách cô lập và coi `document` là có lớp tài liệu; `query` hạ điểm `document` ×0,3).

    Bộ nạp gộp `rationale` (docstring, chú thích trong tệp code) vào loại nút `document`; tách lại theo tệp chứa nút.
    Bộ nạp ghi ngôn ngữ tài liệu theo đuôi (`md`), bộ trích xuất cũ theo tên (`markdown`), nên xét cả hai.
    """
    if kind == "concept":
        return "concept"
    if language in DOC_LANGUAGES or Path(path or "").suffix.lower() in _DOC_EXTS:
        return "document"
    return "rationale" if kind == "document" else "code"


def _location(kind: str, line: int | None) -> str:
    """Graphify ghi node tệp ở `L1`; `query`/`resolve` dựa vào đó để nhận node tệp khi tên trùng."""
    if line:
        return f"L{line}"
    return "L1" if kind == "file" else ""

RELATION = {
    "CALLS": "calls", "IMPORTS": "imports_from", "INHERITS": "inherits", "IMPLEMENTS": "implements",
    "DEFINES": "contains", "CONTAINS": "contains", "REFERENCES": "references", "USES_TYPE": "uses",
    "TESTED_BY": "tested_by", "DOCUMENTS": "references", "DEPENDS_ON": "depends_on",
    "SEMANTIC_RELATED": "semantically_similar_to", "COMPOSES": "uses", "NAVIGATES_TO": "calls",
}
_SKIP_KINDS = ("repository", "directory")


@dataclass(frozen=True)
class Scope:
    kind: Literal["all", "community", "node"] = "all"
    value: str | None = None
    limit: int = EXPORT_NODE_LIMIT


@dataclass
class BridgeGraph:
    G: nx.Graph
    communities: dict[int, list[str]] = field(default_factory=dict)
    labels: dict[int, str] = field(default_factory=dict)
    cohesion: dict[int, float] = field(default_factory=dict)
    truncated: bool = False


def _candidate_pks(store: GraphStore, scope: Scope) -> list[int]:
    conn = store.conn
    skip = f"loai_nut NOT IN ({','.join('?' * len(_SKIP_KINDS))})"
    if scope.kind == "all":
        return [r[0] for r in conn.execute(f"SELECT ma_nut FROM nut WHERE {skip}", _SKIP_KINDS)]
    if scope.kind == "community":
        if not scope.value or not scope.value.startswith("com:"):
            raise KeyError(scope.value)
        raw = scope.value[4:]
        if not raw.isascii() or not raw.isdecimal() or len(raw) > 19:
            raise KeyError(scope.value)
        community = int(raw)
        if community > 2**63 - 1 or not conn.execute(
                "SELECT 1 FROM khoi_kien_truc WHERE ma_khoi = ?", (community,)).fetchone():
            raise KeyError(scope.value)
        return [r[0] for r in conn.execute(f"SELECT ma_nut FROM nut WHERE ma_khoi = ? AND {skip}",
                                           (community, *_SKIP_KINDS))]
    hood = store.neighbors(scope.value or "", depth=2, limit=max(scope.limit, 1))  # KeyError khi nút lạ
    ids = [n.id for n in hood.nodes if n.kind.value not in _SKIP_KINDS]
    if not ids:
        return []
    marks = ",".join("?" * len(ids))
    return [r[0] for r in conn.execute(f"SELECT ma_nut FROM nut WHERE id_nut IN ({marks})", ids)]


def _top_by_degree(store: GraphStore, pks: list[int], limit: int) -> list[int]:
    degree = {pk: 0 for pk in pks}
    for a, b in store.conn.execute("SELECT ma_nut_nguon, ma_nut_dich FROM canh"):
        if a in degree:
            degree[a] += 1
        if b in degree:
            degree[b] += 1
    return sorted(pks, key=lambda pk: (-degree[pk], pk))[:limit]


def build_nx(store: GraphStore, scope: Scope = Scope(), keep_file: Callable[[str], bool] | None = None) -> BridgeGraph:
    """`keep_file`: bỏ nút của tệp bị chặn với AI (resource MCP); cộng đồng có nút bị bỏ mất nhãn để tên không lộ."""
    conn = store.conn
    pks = _candidate_pks(store, scope)
    truncated = len(pks) > scope.limit
    if truncated:
        pks = _top_by_degree(store, pks, scope.limit)
    keep = set(pks)

    blocks = {r["ma_khoi"]: r for r in conn.execute("SELECT ma_khoi, ten, do_gan_ket FROM khoi_kien_truc")}
    G = nx.Graph()
    pk_to_id: dict[int, str] = {}
    communities: dict[int, list[str]] = {}
    rows = conn.execute(
        "SELECT n.ma_nut, n.id_nut, n.loai_nut, n.nhan, n.dong_bat_dau, n.la_kiem_thu, n.ma_khoi,"
        " t.duong_dan_tuong_doi AS tep, t.ngon_ngu FROM nut n LEFT JOIN tep t ON t.ma_tep = n.ma_tep")
    hidden_communities: set[int] = set()
    for r in rows:
        if r["ma_nut"] not in keep:
            continue
        cid = r["ma_khoi"] if r["ma_khoi"] in blocks else OTHER_COMMUNITY
        if keep_file is not None and r["tep"] and not keep_file(r["tep"]):
            hidden_communities.add(cid)
            continue
        # Node ngoài dự án của Graphify nằm dưới tệp giả trong `graph.db`; Graphify ghi chúng không có tệp.
        G.add_node(r["id_nut"], id=r["id_nut"], label=r["nhan"],
                   source_file="" if r["tep"] == EXTERNAL_FILE else r["tep"] or "",
                   source_location=_location(r["loai_nut"], r["dong_bat_dau"]),
                   file_type=_file_type(r["loai_nut"], r["ngon_ngu"], r["tep"]),
                   community=cid, kind=r["loai_nut"], is_test=bool(r["la_kiem_thu"]))
        pk_to_id[r["ma_nut"]] = r["id_nut"]
        communities.setdefault(cid, []).append(r["id_nut"])

    for r in conn.execute(
            "SELECT c.ma_nut_nguon, c.ma_nut_dich, c.loai_canh, c.muc_tin_cay, c.diem_tin_cay, c.dong_bang_chung,"
            " t.duong_dan_tuong_doi AS tep FROM canh c JOIN nut ns ON ns.ma_nut = c.ma_nut_nguon"
            " LEFT JOIN tep t ON t.ma_tep = ns.ma_tep"):
        a, b = pk_to_id.get(r["ma_nut_nguon"]), pk_to_id.get(r["ma_nut_dich"])
        if a is None or b is None or a == b:
            continue
        data = G.get_edge_data(a, b)
        if data is None:  # hàm Graphify nhận nx.Graph đơn cạnh: gộp đa cạnh, giữ loại trong `types` (spec F10 §4.6)
            G.add_edge(a, b, source=a, target=b, relation=RELATION[r["loai_canh"]], confidence=r["muc_tin_cay"],
                       confidence_score=r["diem_tin_cay"], source_file=r["tep"] or "",
                       source_location=f"L{r['dong_bang_chung']}" if r["dong_bang_chung"] else "",
                       weight=1.0, types=[r["loai_canh"]])
        else:
            data["weight"] += 1
            if r["loai_canh"] not in data["types"]:
                data["types"] = sorted([*data["types"], r["loai_canh"]])

    labels = {cid: blocks[cid]["ten"] if cid not in hidden_communities else f"Cộng đồng {cid}"
              for cid in communities if cid in blocks}
    cohesion = {cid: float(blocks[cid]["do_gan_ket"] or 0.0) for cid in communities if cid in blocks}
    if OTHER_COMMUNITY in communities:
        labels[OTHER_COMMUNITY] = "Khác"
        cohesion[OTHER_COMMUNITY] = 0.0
    return BridgeGraph(G=G, communities=communities, labels=labels, cohesion=cohesion, truncated=truncated)


def write_graph_json(bg: BridgeGraph, path: Path, *, project_name: str | None = None,
                     built_at_commit: str | None = None) -> None:
    """Ghi graph.json kiểu Graphify; `project_name`/`built_at_commit` để callflow không lấy tên thư mục tạm.

    `to_json` của bản vendor chỉ nhận commit (đọc từ thư mục đích — với tệp tạm thì ra `None`); tên dự án
    phải thêm ở tầng NexGraph vì `load_graph` của callflow đọc khoá `project_name` cấp đầu (A3b-P1 F1).
    """
    import json

    from nexgraph_engine.adapters.graphify.export import to_json
    to_json(bg.G, bg.communities, str(path), force=True, community_labels=bg.labels,
            built_at_commit=built_at_commit)
    if project_name:
        data = json.loads(path.read_text(encoding="utf-8"))
        data["project_name"] = project_name
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
