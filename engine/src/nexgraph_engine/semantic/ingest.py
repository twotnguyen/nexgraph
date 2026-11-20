"""Kiểm kết quả của model và ghi vào CSDL đồ thị. Caller giữ transaction (mỗi khối một transaction)."""
from __future__ import annotations

import json
import re
import time

from graphify.llm import _LABEL_FENCE_RE, _parse_label_response, _parse_llm_json
from graphify.validate import validate_extraction

from nexgraph_engine.ids import file_node_id, node_id
from nexgraph_engine.schema.enums import Confidence, EdgeType, NodeKind, Origin
from nexgraph_engine.semantic.transport import ChunkError
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.models import Edge, Node

DOCUMENTS_RELATIONS = frozenset({"references", "cites", "documents", "describes", "explains", "mentions"})
_PLACEHOLDER = re.compile(r"^(community|cluster|cụm|group|nhóm)\s*#?\d*$", re.IGNORECASE)
_SYMBOL_KINDS = ("class", "mixin", "enum", "extension", "function", "method", "test", "widget", "screen", "route",
                 "type", "variable", "table", "resource", "config_key", "module")


# --- parse + kiểm -----------------------------------------------------------------------------------
def parse_fragment(text: str) -> dict:
    """Fragment `{nodes, edges}` đã kiểm bằng `validate_extraction`; JSON hỏng hoặc thiếu trường thì ChunkError."""
    parsed = _parse_llm_json(text)
    if not parsed.get("nodes") and not parsed.get("edges") and '"nodes"' not in text:
        raise ChunkError("Model không trả JSON hợp lệ")  # _parse_llm_json trả fragment rỗng thay vì ném lỗi
    errors = validate_extraction(parsed)
    if errors:
        raise ChunkError(f"Kết quả sai định dạng: {'; '.join(errors[:3])}")
    return {"nodes": parsed["nodes"], "edges": parsed.get("edges") or []}


def parse_labels(text: str, ordinals: list[str]) -> dict[str, str]:
    try:
        names = _parse_label_response(text, [int(o) for o in ordinals])
    except ValueError as exc:
        raise ChunkError("Model không trả JSON tên cụm hợp lệ") from exc
    return {str(k): v for k, v in names.items()}


def parse_triage(text: str, numbers: list[int]) -> list[dict]:
    cleaned = _LABEL_FENCE_RE.sub("", text.strip())
    start, end = cleaned.find("{"), cleaned.rfind("}")
    try:
        data = json.loads(cleaned[start:end + 1]) if start != -1 and end > start else None
    except ValueError:
        data = None
    items = data.get("triage") if isinstance(data, dict) else None
    if not isinstance(items, list):
        raise ChunkError("Model không trả JSON triage hợp lệ")
    allowed, out, seen = set(numbers), [], set()
    for item in items:
        if not isinstance(item, dict):
            continue
        number, action = item.get("number"), item.get("action")
        if not isinstance(number, int) or number not in allowed or number in seen or not isinstance(action, str):
            continue
        priority = item.get("priority")
        seen.add(number)
        out.append({"number": number, "priority": priority if isinstance(priority, int) else len(out) + 1,
                    "action": action.strip()[:500]})
    if not out:
        raise ChunkError("Kết quả triage không có PR nào hợp lệ")
    return sorted(out, key=lambda x: (x["priority"], x["number"]))


# --- ghi ----------------------------------------------------------------------------------------------
def _confidence(raw, unverified: bool) -> tuple[Confidence, float]:
    """Kết quả AI chỉ là INFERRED hoặc AMBIGUOUS; model ghi EXTRACTED thì hạ xuống INFERRED."""
    conf = Confidence.AMBIGUOUS if unverified or str(raw.get("confidence", "")).upper() == "AMBIGUOUS" \
        else Confidence.INFERRED
    try:
        score = float(raw.get("confidence_score", 0.5))
    except (TypeError, ValueError):
        score = 0.5
    return conf, max(0.0, min(1.0, score))


def write_fragment(store: GraphStore, files: list[str], fragment: dict) -> tuple[int, int]:
    """Thay toàn bộ kết quả AI cũ của `files` bằng fragment này. Trả (số nút, số cạnh) đã ghi.

    Nút gắn tệp nguồn của nó; nút ghi `source_file` không thuộc khối bị bỏ (#1895 của vendor). Nút `code` trùng nhãn
    một symbol có thật thì nối vào symbol đó; không trùng thì thành `concept` chưa kiểm chứng, cạnh AMBIGUOUS
    (`llm._bind_node_evidence`).
    """
    conn = store.conn
    present = [f for f in files if conn.execute("SELECT 1 FROM tep WHERE duong_dan_tuong_doi = ?", (f,)).fetchone()]
    if present:
        marks = ",".join("?" * len(present))
        in_files = f"SELECT n.ma_nut FROM nut n JOIN tep t ON t.ma_tep = n.ma_tep WHERE t.duong_dan_tuong_doi IN ({marks})"
        conn.execute(f"DELETE FROM canh WHERE nguon_goc = 'llm' AND ma_nut_nguon IN ({in_files})", present)
        conn.execute(f"DELETE FROM nut WHERE nguon_goc = 'llm' AND ma_nut IN ({in_files})", present)
        store._node_pk.clear()  # pk cũ có thể đã bị xoá
    allowed = set(present)
    ids: dict[str, tuple[str, bool]] = {}  # id của model → (id NexGraph, chưa kiểm chứng)
    new_nodes: dict[str, Node] = {}
    edges: list[Edge] = []
    for raw in fragment["nodes"]:
        rel, label = raw.get("source_file"), str(raw.get("label") or "").strip()[:200]
        if rel not in allowed or not label:
            continue
        unverified = False
        if raw.get("file_type") == "code":
            row = conn.execute(f"SELECT id_nut FROM nut WHERE nhan = ? AND nguon_goc <> 'llm' AND loai_nut IN"
                               f" ({','.join('?' * len(_SYMBOL_KINDS))}) ORDER BY ma_nut LIMIT 1",
                               (label, *_SYMBOL_KINDS)).fetchone()
            if row:
                ids[raw["id"]] = (row[0], False)
                continue
            unverified = True
        nid = node_id(rel, label, NodeKind.CONCEPT)
        existing = conn.execute("SELECT nguon_goc FROM nut WHERE id_nut = ?", (nid,)).fetchone()
        if nid not in new_nodes and existing is None:
            doc = raw.get("rationale") if isinstance(raw.get("rationale"), str) else None
            if unverified:
                doc = "Chưa kiểm chứng: model nêu symbol này nhưng không có trong mã nguồn." + (f"\n{doc}" if doc else "")
            new_nodes[nid] = Node(id=nid, kind=NodeKind.CONCEPT, label=label, qualified_name=label, file=rel,
                                  origin=Origin.LLM, doc=doc)
            edges.append(Edge(source=file_node_id(rel), target=nid, type=EdgeType.DEFINES,
                              confidence=Confidence.INFERRED, confidence_score=1.0, origin=Origin.LLM))
        ids[raw["id"]] = (nid, unverified)
    store.add_nodes(new_nodes.values())
    for raw in fragment["edges"]:
        source, target = ids.get(raw.get("source")), ids.get(raw.get("target"))
        if source is None or target is None or source[0] == target[0]:
            continue
        relation = str(raw.get("relation") or "").strip().lower()[:50] or None
        conf, score = _confidence(raw, source[1] or target[1])
        edges.append(Edge(source=source[0], target=target[0],
                          type=EdgeType.DOCUMENTS if relation in DOCUMENTS_RELATIONS else EdgeType.SEMANTIC_RELATED,
                          subtype=relation, confidence=conf, confidence_score=score, origin=Origin.LLM))
    return len(new_nodes), len(store.insert_edges(edges))


def write_labels(store: GraphStore, meta: dict, names: dict[str, str]) -> dict[int, str]:
    """Ghi tên cụm vào `nhan_cum` (kèm chữ ký thành viên) và `khoi_kien_truc.ten`. Bỏ tên giữ chỗ hoặc tên trùng."""
    conn = store.conn
    renamed = {meta[o][0]: name.strip()[:200] for o, name in names.items() if o in meta and name.strip()}
    others = {r[1].lower() for r in conn.execute("SELECT ma_khoi, ten FROM khoi_kien_truc") if r[0] not in renamed}
    written: dict[int, str] = {}
    for ordinal, (community_id, sig) in sorted(meta.items(), key=lambda kv: int(kv[0])):
        name = renamed.get(community_id)
        if not name or _PLACEHOLDER.match(name) or name.lower() in others:
            continue
        user_named = conn.execute("SELECT 1 FROM nhan_cum WHERE chu_ky_thanh_vien = ? AND nguon = 'nguoi_dung'",
                                  (sig,)).fetchone()
        if user_named:  # tên người dùng đặt thắng tên AI
            continue
        others.add(name.lower())
        conn.execute("DELETE FROM nhan_cum WHERE chu_ky_thanh_vien = ? OR cum_id = ?", (sig, str(community_id)))
        conn.execute("INSERT INTO nhan_cum (cum_id, ten, chu_ky_thanh_vien, nguon, tao_luc) VALUES (?, ?, ?, 'llm', ?)",
                     (str(community_id), name, sig, int(time.time())))
        conn.execute("UPDATE khoi_kien_truc SET ten = ? WHERE ma_khoi = ?", (name, community_id))
        written[community_id] = name
    return written


def dedup_concepts(store: GraphStore, root) -> int:
    """Gộp nút concept do AI tạo bị trùng bằng `graphify.dedup` (chạy cục bộ, không gọi model). Trả số nút đã gộp."""
    from graphify.dedup import deduplicate_entities
    conn = store.conn
    rows = conn.execute("SELECT n.id_nut, n.nhan, t.duong_dan_tuong_doi FROM nut n JOIN tep t ON t.ma_tep = n.ma_tep"
                        " WHERE n.nguon_goc = 'llm' AND n.loai_nut = 'concept' ORDER BY n.ma_nut").fetchall()
    nodes = [{"id": r[0], "label": r[1], "source_file": r[2], "file_type": "concept"} for r in rows]
    remap: dict[str, str] = {}
    deduplicate_entities(nodes, [], communities={}, root=str(root), remap_out=remap)
    for old, survivor in remap.items():
        old_pk, new_pk = store.pk_of(old), store.pk_of(survivor)
        cols = "loai_canh, loai_con, muc_tin_cay, diem_tin_cay, nguon_goc, dong_bang_chung, cot_bang_chung"
        conn.execute(f"INSERT OR IGNORE INTO canh (ma_nut_nguon, ma_nut_dich, {cols}) SELECT ?, ma_nut_dich, {cols}"
                     " FROM canh WHERE ma_nut_nguon = ? AND ma_nut_dich <> ?", (new_pk, old_pk, new_pk))
        conn.execute(f"INSERT OR IGNORE INTO canh (ma_nut_nguon, ma_nut_dich, {cols}) SELECT ma_nut_nguon, ?, {cols}"
                     " FROM canh WHERE ma_nut_dich = ? AND ma_nut_nguon <> ?", (new_pk, old_pk, new_pk))
        conn.execute("DELETE FROM nut WHERE ma_nut = ?", (old_pk,))
    return len(remap)
