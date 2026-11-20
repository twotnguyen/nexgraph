"""Bộ nhớ làm việc (đánh giá câu trả lời → Bài học) và Memory neo vào node, đều trong bảng `ky_uc` (graph v7).

Bài học không chép thuật toán: các dòng `danh_gia` được đổi thành "memory doc" rồi đưa thẳng vào
`graphify.reflect.aggregate_lessons` (half-life 30 ngày, cần 2 lần xác nhận). Ghi luôn qua `writer()`,
tức khoá `graph_writer` mà index giữ suốt lúc dựng bản tạm và công bố, nên không bao giờ ghi vào bản sắp bị đè.
"""
from __future__ import annotations

import json
import re
import sqlite3
import unicodedata
from collections.abc import Callable, Iterator
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from pathlib import Path

from graphify.reflect import aggregate_lessons

from nexgraph_engine.query.source_policy import SourcePolicy, protected_source
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.publication import GraphWriteBusy, graph_writer

KINDS = ("lesson", "decision", "incident", "owner")
OUTCOMES = {"huu_ich": "useful", "ngo_cut": "dead_end", "da_sua": "corrected"}
SOURCES = ("nguoi_dung", "tro_ly", "mcp")
MAX_TEXT = 4000
MAX_ANSWER = 20_000
MAX_NODES = 50


class MemoryBusy(RuntimeError):
    """Dự án đang được lập chỉ mục hoặc cập nhật: ghi lúc này sẽ bị bản mới đè mất."""


@contextmanager
def writer(graph_db: Path) -> Iterator[sqlite3.Connection]:
    """Kết nối ghi riêng dưới khoá ghi của dự án; commit khi thân chạy xong, khoá bận thì ném MemoryBusy.
    Không bao giờ tạo CSDL mới: chưa có graph đã công bố thì ném ValueError."""
    if not graph_db.is_file():
        raise ValueError("Dự án chưa được lập chỉ mục xong")
    try:
        with graph_writer(graph_db) as path, closing(open_graph_db(path)) as conn:
            if not GraphStore(conn).has_published_graph():
                raise ValueError("Dự án chưa được lập chỉ mục xong")
            yield conn
            conn.commit()
    except GraphWriteBusy as exc:
        raise MemoryBusy("Dự án đang được lập chỉ mục hoặc cập nhật, thử lại sau khi xong") from exc


def normalize(text: str) -> str:
    """Khoá gộp trùng: NFKC, casefold, gộp khoảng trắng, bỏ dấu câu cuối câu. Giữ ký hiệu ở giữa (`> 0`, `-1`, `C++`)."""
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split()).rstrip(".!?…;,: ")


def _words(text: str) -> list[str]:
    """Từ để tìm theo `query` (khác khoá gộp trùng: ở đây bỏ hết dấu câu)."""
    return re.findall(r"\w+", unicodedata.normalize("NFKC", text).casefold())


def _clean(text: str) -> str:
    """Bỏ ký tự điều khiển (loại Cc) trừ xuống dòng và tab."""
    return "".join(ch for ch in text if ch in "\n\t" or unicodedata.category(ch) != "Cc")


def source_filter(source: SourcePolicy) -> Callable[[str], bool]:
    """Node có được đưa cho AI không, xét từ chính id (cả khi node đã mất khỏi graph)."""
    def allows(node_id: str) -> bool:
        if node_id.endswith("#directory"):
            return source.allows(node_id.removesuffix("#directory"), directory=True)
        return source.allows(node_id.split("::", 1)[0].rsplit("#", 1)[0])
    return allows


def _now(now: datetime | None) -> int:
    return int((now or datetime.now(timezone.utc)).timestamp())


def _existing(conn: sqlite3.Connection, ids: list[str]) -> dict[str, str]:
    """id → nhãn của các node còn trong graph."""
    return {r[0]: r[1] for r in conn.execute(
        "SELECT id_nut, nhan FROM nut WHERE id_nut IN (SELECT value FROM json_each(?))", (json.dumps(ids),))}


def _nodes(conn: sqlite3.Connection, node_ids: list[str]) -> list[str]:
    if len(node_ids) > MAX_NODES:
        raise ValueError(f"Tối đa {MAX_NODES} nút")
    nodes = sorted(set(node_ids))
    missing = [n for n in nodes if n not in _existing(conn, nodes)]
    if missing:
        raise ValueError(f"Không có nút {missing[0]}")
    return nodes


def _text(text: str, limit: int = MAX_TEXT) -> str:
    text = _clean(text).strip()
    if not text:
        raise ValueError("Nội dung trống")
    if len(text) > limit:
        raise ValueError(f"Nội dung dài quá {limit} ký tự")
    return text


def remember(conn: sqlite3.Connection, kind: str, text: str, node_ids: list[str], source: str,
             now: datetime | None = None) -> dict:
    """Thêm Lesson/Decision/Incident/Owner. Trùng (cùng loại, chữ chuẩn hoá, tập node) thì trả bản cũ."""
    if kind not in KINDS:
        raise ValueError(f"kind phải là một trong {', '.join(KINDS)}")
    if source not in SOURCES:
        raise ValueError(f"Nguồn không hợp lệ: {source}")
    text, nodes = _text(text), _nodes(conn, node_ids)
    key = normalize(text)
    for row in conn.execute("SELECT id, noi_dung, node_ids_json FROM ky_uc WHERE loai = ?", (kind,)):
        if normalize(row[1]) == key and sorted(json.loads(row[2])) == nodes:
            return {"id": row[0], "created": False, "node_ids": nodes}
    cur = conn.execute("INSERT INTO ky_uc (loai, noi_dung, node_ids_json, tao_luc, nguon) VALUES (?, ?, ?, ?, ?)",
                       (kind, text, json.dumps(nodes, ensure_ascii=False), _now(now), source))
    return {"id": cur.lastrowid, "created": True, "node_ids": nodes}


def rate(conn: sqlite3.Connection, question: str, answer: str, outcome: str, node_ids: list[str],
         correction: str | None = None, source: str = "nguoi_dung", now: datetime | None = None) -> dict:
    """Lưu một lần đánh giá câu trả lời (`save-result`): `noi_dung` = JSON {question, answer, correction?}."""
    if outcome not in OUTCOMES:
        raise ValueError(f"outcome phải là một trong {', '.join(OUTCOMES)}")
    if source not in SOURCES:
        raise ValueError(f"Nguồn không hợp lệ: {source}")
    body = {"question": _text(_clean(question).strip()[:MAX_TEXT]), "answer": _clean(answer).strip()[:MAX_ANSWER]}
    if outcome == "da_sua":
        body["correction"] = _text(correction or "")
    nodes = _nodes(conn, node_ids)
    cur = conn.execute(
        "INSERT INTO ky_uc (loai, noi_dung, node_ids_json, ket_qua, tao_luc, nguon) VALUES ('danh_gia', ?, ?, ?, ?, ?)",
        (json.dumps(body, ensure_ascii=False), json.dumps(nodes, ensure_ascii=False), outcome, _now(now), source))
    return {"id": cur.lastrowid, "node_ids": nodes}


def _rating_body(noi_dung: str) -> dict:
    try:
        body = json.loads(noi_dung)
    except ValueError:
        body = None
    return body if isinstance(body, dict) else {"question": noi_dung}


def lessons(conn: sqlite3.Connection, now: datetime | None = None, allows: Callable[[str], bool] | None = None) -> dict:
    """Bài học từ mọi đánh giá, tất định với `now` cho trước. Node không còn trong graph bị bỏ (như vendor).
    `allows` (cho AI): bỏ cả đánh giá nào có node bị loại khỏi ngữ cảnh AI, để câu hỏi/cách sửa không lộ."""
    docs = []
    for ket_qua, noi_dung, nodes, ts in conn.execute(
            "SELECT ket_qua, noi_dung, node_ids_json, tao_luc FROM ky_uc WHERE loai = 'danh_gia' ORDER BY tao_luc, id"):
        if allows and not all(allows(n) for n in json.loads(nodes)):
            continue
        body = _rating_body(noi_dung)
        docs.append({"date": datetime.fromtimestamp(ts, timezone.utc).isoformat(), "outcome": OUTCOMES[ket_qua],
                     "question": str(body.get("question", "")), "correction": str(body.get("correction") or ""),
                     "source_nodes": json.loads(nodes)})
    labels = _existing(conn, sorted({n for d in docs for n in d["source_nodes"]}))
    agg = aggregate_lessons(docs, now=now, known_nodes=set(labels))
    agg.pop("_node_provenance", None)
    agg.pop("by_community", None)  # shortcut: chưa nhóm theo cộng đồng, thêm khi giao diện cần
    return {**agg, "labels": labels}


def _lesson_of(agg: dict, node_id: str) -> dict | None:
    for status in ("preferred", "tentative", "contested"):
        for entry in agg[status]:
            if entry["node"] == node_id:
                return {"status": status, **entry}
    return None


def recall(conn: sqlite3.Connection, *, query: str | None = None, node_id: str | None = None, limit: int = 20,
           now: datetime | None = None, allows: Callable[[str], bool] | None = None) -> dict:
    """Ký ức theo node và/hoặc theo từ khoá, mới trước. Node đã mất khỏi graph vẫn giữ, báo ở `missing_node_ids`.
    `allows` (cho AI): node bị loại thì báo protected_source; bỏ mọi ký ức có node bị loại."""
    if not (query and query.strip()) and not node_id:
        raise ValueError("Cần query hoặc node_id")
    if allows and node_id and not allows(node_id):
        raise protected_source()
    terms = _words(query or "")
    hits: list[tuple[int, dict]] = []
    # shortcut: quét cả bảng trong Python; đổi sang FTS khi một dự án có hàng chục nghìn ký ức.
    for row in conn.execute("SELECT id, loai, noi_dung, node_ids_json, ket_qua, tao_luc, nguon FROM ky_uc"
                            " ORDER BY tao_luc DESC, id DESC"):
        nodes = json.loads(row["node_ids_json"])
        if (node_id and node_id not in nodes) or (allows and not all(allows(n) for n in nodes)):
            continue
        item = {"id": row["id"], "kind": row["loai"], "text": row["noi_dung"], "node_ids": nodes,
                "outcome": row["ket_qua"], "created_at": row["tao_luc"], "source": row["nguon"]}
        if row["loai"] == "danh_gia":
            body = _rating_body(row["noi_dung"])
            item.update(text=str(body.get("question", "")), question=body.get("question"),
                        answer=body.get("answer"), correction=body.get("correction"))
        haystack = " ".join(_words(" ".join(str(v) for v in (item["text"], item.get("answer"), item.get("correction"), *nodes) if v)))
        score = sum(t in haystack for t in terms)
        if terms and not score:
            continue
        hits.append((score, item))
    hits.sort(key=lambda h: -h[0])  # sort ổn định: cùng điểm thì giữ thứ tự mới trước
    memories = [item for _, item in hits[:max(1, min(limit, 200))]]
    alive = _existing(conn, sorted({n for m in memories for n in m["node_ids"]} | ({node_id} if node_id else set())))
    for m in memories:
        m["missing_node_ids"] = [n for n in m["node_ids"] if n not in alive]
    out: dict = {"memories": memories}
    if node_id:
        out.update(node_id=node_id, node_exists=node_id in alive, lesson=_lesson_of(lessons(conn, now, allows), node_id))
    return out
