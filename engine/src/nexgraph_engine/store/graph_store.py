"""Ghi và đọc đồ thị của một project trong SQLite. Nơi duy nhất dịch giữa mã tiếng Anh và cột tiếng Việt."""
from __future__ import annotations

import sqlite3
import time
import uuid
from collections.abc import Iterable, Iterator
from typing import Literal

from nexgraph_engine.index.keywords import search_keywords
from nexgraph_engine.schema.db import SCHEMA_VERSION
from nexgraph_engine.schema.enums import Confidence, EdgeType, NodeKind, Origin
from nexgraph_engine.store.models import (
    Edge, FileRec, Neighborhood, Node, RunState, StoredEdge, UnresolvedRef,
)

_CHUNK = 400
_END_STATES = ("hoan_tat", "loi", "huy")


def _chunks(items: list[int], size: int = _CHUNK) -> Iterator[list[int]]:
    for i in range(0, len(items), size):
        yield items[i:i + size]


class GraphStore:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn
        self._file_pk: dict[str, int] = {}
        self._node_pk: dict[str, int] = {}

    # --- dự án và lần lập chỉ mục ---------------------------------------------------
    def init_project(self, name: str, has_git: bool, project_id: str | None = None) -> str:
        row = self.conn.execute("SELECT ma_du_an FROM du_an").fetchone()
        if row:
            return row["ma_du_an"]
        pid = project_id or str(uuid.uuid4())
        self.conn.execute(
            "INSERT INTO du_an (ma_du_an, ten, co_git, phien_ban_schema, tao_luc) VALUES (?, ?, ?, ?, ?)",
            (pid, name[:255] or "project", int(has_git), SCHEMA_VERSION, int(time.time())),
        )
        self.conn.commit()
        return pid

    def project_id(self) -> str | None:
        row = self.conn.execute("SELECT ma_du_an FROM du_an").fetchone()
        return row["ma_du_an"] if row else None

    def begin_run(self, files_total: int = 0, commit_sha: str | None = None) -> int:
        pid = self.project_id()
        cur = self.conn.execute(
            "INSERT INTO lan_lap_chi_muc (ma_du_an, loai, trang_thai, bat_dau_luc, so_tep_tong, commit_sha)"
            " VALUES (?, 'day_du', 'cho', ?, ?, ?)",
            (pid, int(time.time()), files_total, commit_sha),
        )
        self.conn.commit()
        return int(cur.lastrowid)

    def set_run_state(self, run_id: int, state: RunState, *, files_done: int | None = None,
                      files_total: int | None = None, error: str | None = None) -> None:
        sets, args = ["trang_thai = ?"], [state]
        if files_total is not None:
            sets.append("so_tep_tong = ?"); args.append(files_total)
        if files_done is not None:
            sets.append("so_tep_xu_ly = ?"); args.append(files_done)
        if state in _END_STATES:
            sets.append("ket_thuc_luc = ?"); args.append(int(time.time()))
        if state == "loi":
            sets.append("thong_bao_loi = ?"); args.append(error or "lỗi không rõ")
        self.conn.execute(f"UPDATE lan_lap_chi_muc SET {', '.join(sets)} WHERE ma_lan = ?", (*args, run_id))
        self.conn.commit()

    def abort_stale_runs(self) -> int:
        """Đánh dấu lỗi các lần còn ở trạng thái đang chạy (engine từng thoát giữa chừng), để không chặn RB19."""
        cur = self.conn.execute(
            "UPDATE lan_lap_chi_muc SET trang_thai = 'loi', ket_thuc_luc = max(bat_dau_luc, ?),"
            " thong_bao_loi = 'Bị gián đoạn: engine thoát trước khi lập chỉ mục xong'"
            " WHERE trang_thai IN ('cho', 'cau_truc', 'phan_giai')", (int(time.time()),))
        self.conn.commit()
        return cur.rowcount

    def last_completed_run(self) -> tuple[int, str | None] | None:
        row = self.conn.execute(
            "SELECT ket_thuc_luc, commit_sha FROM lan_lap_chi_muc WHERE trang_thai = 'hoan_tat'"
            " ORDER BY ma_lan DESC LIMIT 1").fetchone()
        return (row["ket_thuc_luc"], row["commit_sha"]) if row else None

    def commit(self) -> None:
        self.conn.commit()

    def clear_graph(self) -> None:
        for table in ("canh", "nut", "tep", "khoi_kien_truc"):
            self.conn.execute(f"DELETE FROM {table}")
        self.conn.commit()
        self._file_pk.clear()
        self._node_pk.clear()

    # --- ghi --------------------------------------------------------------------------
    def add_file(self, run_id: int, rec: FileRec) -> int:
        cur = self.conn.execute(
            "INSERT INTO tep (duong_dan_tuong_doi, ngon_ngu, kich_thuoc, mtime, ma_bam, la_kiem_thu, ma_lan)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (rec.rel_path, rec.language, rec.size, rec.mtime, rec.sha256, int(rec.is_test), run_id),
        )
        self._file_pk[rec.rel_path] = int(cur.lastrowid)
        return int(cur.lastrowid)

    def add_file_error(self, rel_path: str, kind: str, detail: str | None) -> None:
        self.conn.execute(
            "INSERT INTO loi_phan_tich (ma_tep, loai, chi_tiet) VALUES (?, ?, ?)"
            " ON CONFLICT (ma_tep, loai) DO UPDATE SET chi_tiet = excluded.chi_tiet",
            (self._file(rel_path), kind, detail),
        )

    def add_nodes(self, nodes: Iterable[Node]) -> None:
        for n in nodes:
            cur = self.conn.execute(
                "INSERT INTO nut (id_nut, loai_nut, nhan, ten_day_du, dong_bat_dau, dong_ket_thuc, la_kiem_thu,"
                " nguon_goc, chu_ky, tai_lieu, ma_tep) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (n.id, n.kind.value, n.label[:255] or "?", n.qualified_name[:1024] or "?", n.line_start,
                 n.line_end, int(n.is_test), n.origin.value, (n.signature or None) and n.signature[:2000],
                 n.doc, self._file(n.file) if n.file else None),
            )
            self._node_pk[n.id] = int(cur.lastrowid)
            if n.kind != NodeKind.REPOSITORY:  # nút gốc không phải thứ để tìm
                self.conn.execute(
                    "INSERT INTO nut_fts (rowid, nhan, ten_day_du, chu_ky, tai_lieu, tu_khoa) VALUES (?, ?, ?, ?, ?, ?)",
                    (cur.lastrowid, n.label[:255], n.qualified_name[:1024], n.signature and n.signature[:2000], n.doc,
                     search_keywords(n.label[:255], n.qualified_name[:1024])))

    def add_edges(self, edges: Iterable[Edge]) -> int:
        added = 0
        for e in edges:
            try:
                self.conn.execute(
                    "INSERT INTO canh (ma_nut_nguon, ma_nut_dich, loai_canh, loai_con, muc_tin_cay, diem_tin_cay,"
                    " nguon_goc, dong_bang_chung, cot_bang_chung) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (self._pk(e.source), self._pk(e.target), e.type.value, e.subtype, e.confidence.value,
                     e.confidence_score, e.origin.value, e.line, e.col),
                )
                added += 1
            except sqlite3.IntegrityError as exc:
                if "UNIQUE constraint failed" not in str(exc):  # chỉ bỏ qua cạnh trùng hoàn toàn (RB16)
                    raise
        return added

    def add_unresolved(self, refs: Iterable[UnresolvedRef]) -> None:
        for r in refs:
            self.conn.execute(
                "INSERT INTO tham_chieu_chua_phan_giai (ma_nut_nguon, ten_tham_chieu, loai_tham_chieu, dong, cot)"
                " VALUES (?, ?, ?, ?, ?) ON CONFLICT (ma_nut_nguon, ten_tham_chieu, loai_tham_chieu, dong, cot)"
                " DO NOTHING",
                (self._pk(r.source), r.name[:500], r.type.value, r.line, r.col),
            )

    def pending_refs(self) -> list[tuple[int, UnresolvedRef]]:
        rows = self.conn.execute(
            "SELECT t.ma_tc, n.id_nut, t.ten_tham_chieu, t.loai_tham_chieu, t.dong, t.cot"
            " FROM tham_chieu_chua_phan_giai t JOIN nut n ON n.ma_nut = t.ma_nut_nguon"
            " WHERE t.trang_thai = 'cho' ORDER BY t.ma_tc").fetchall()
        return [(r["ma_tc"], UnresolvedRef(source=r["id_nut"], name=r["ten_tham_chieu"],
                                           type=EdgeType(r["loai_tham_chieu"]), line=r["dong"], col=r["cot"]))
                for r in rows]

    def delete_refs(self, ref_ids: list[int]) -> None:
        for chunk in _chunks(ref_ids):
            self.conn.execute(f"DELETE FROM tham_chieu_chua_phan_giai WHERE ma_tc IN ({','.join('?' * len(chunk))})", chunk)

    def fail_pending_refs(self) -> int:
        cur = self.conn.execute("UPDATE tham_chieu_chua_phan_giai SET trang_thai = 'that_bai' WHERE trang_thai = 'cho'")
        return cur.rowcount

    # --- đọc --------------------------------------------------------------------------
    def get_node(self, node_id: str) -> Node | None:
        row = self.conn.execute(self._NODE_SQL + " WHERE n.id_nut = ?", (node_id,)).fetchone()
        return self._node(row) if row else None

    def all_nodes(self, kinds: set[NodeKind] | None = None) -> Iterator[Node]:
        sql, args = self._NODE_SQL, []
        if kinds:
            sql += f" WHERE n.loai_nut IN ({','.join('?' * len(kinds))})"
            args = [k.value for k in kinds]
        for row in self.conn.execute(sql + " ORDER BY n.ma_nut", args):
            yield self._node(row)

    def file_record(self, rel_path: str) -> FileRec | None:
        r = self.conn.execute(
            "SELECT * FROM tep WHERE duong_dan_tuong_doi = ?", (rel_path,)).fetchone()
        if not r:
            return None
        return FileRec(rel_path=r["duong_dan_tuong_doi"], language=r["ngon_ngu"], size=r["kich_thuoc"],
                       mtime=r["mtime"], sha256=r["ma_bam"], is_test=bool(r["la_kiem_thu"]))

    def neighbors(self, node_id: str, *, types: set[EdgeType] | None = None,
                  direction: Literal["in", "out", "both"] = "both", depth: int = 1,
                  limit: int = 500) -> Neighborhood:
        start = self._pk(node_id)  # KeyError nếu không có
        included: list[int] = [start]
        seen = {start}
        edge_rows: dict[int, sqlite3.Row] = {}
        truncated = False
        frontier = [start]
        for _ in range(depth):
            nxt: list[int] = []
            for chunk in _chunks(frontier):
                for row in self._edge_rows(chunk, types, direction):
                    for pk in (row["ma_nut_nguon"], row["ma_nut_dich"]):
                        if pk in seen:
                            continue
                        if len(seen) >= limit:
                            truncated = True
                            continue
                        seen.add(pk)
                        included.append(pk)
                        nxt.append(pk)
                    edge_rows[row["ma_canh"]] = row
            frontier = nxt
            if not frontier:
                break
        nodes = self._nodes_by_pk(included)
        edges = [
            StoredEdge(id=r["ma_canh"], file=r["ev_file"], edge=Edge(
                source=r["src_id"], target=r["dst_id"], type=EdgeType(r["loai_canh"]), subtype=r["loai_con"],
                confidence=Confidence(r["muc_tin_cay"]), confidence_score=r["diem_tin_cay"],
                origin=Origin(r["nguon_goc"]), line=r["dong_bang_chung"], col=r["cot_bang_chung"]))
            for _, r in sorted(edge_rows.items())
            if r["ma_nut_nguon"] in seen and r["ma_nut_dich"] in seen
        ]
        return Neighborhood(nodes=nodes, edges=edges, truncated=truncated)

    def stats(self) -> dict:
        q = self.conn.execute
        return {
            "files": q("SELECT count(*) FROM tep").fetchone()[0],
            "nodes_by_kind": {r[0]: r[1] for r in q("SELECT loai_nut, count(*) FROM nut GROUP BY loai_nut")},
            "edges_by_type": {r[0]: r[1] for r in q("SELECT loai_canh, count(*) FROM canh GROUP BY loai_canh")},
            "languages": {r[0]: r[1] for r in q("SELECT ngon_ngu, count(*) FROM tep GROUP BY ngon_ngu")},
            "unresolved": q("SELECT count(*) FROM tham_chieu_chua_phan_giai").fetchone()[0],
        }

    # --- nội bộ -----------------------------------------------------------------------
    _NODE_SQL = (
        "SELECT n.*, t.duong_dan_tuong_doi AS file, t.ngon_ngu AS language"
        " FROM nut n LEFT JOIN tep t ON t.ma_tep = n.ma_tep"
    )

    def _file(self, rel_path: str) -> int:
        pk = self._file_pk.get(rel_path)
        if pk is None:
            row = self.conn.execute("SELECT ma_tep FROM tep WHERE duong_dan_tuong_doi = ?", (rel_path,)).fetchone()
            if not row:
                raise KeyError(f"tệp chưa được thêm: {rel_path}")
            pk = self._file_pk[rel_path] = row["ma_tep"]
        return pk

    def _pk(self, node_id: str) -> int:
        pk = self._node_pk.get(node_id)
        if pk is None:
            row = self.conn.execute("SELECT ma_nut FROM nut WHERE id_nut = ?", (node_id,)).fetchone()
            if not row:
                raise KeyError(node_id)
            pk = self._node_pk[node_id] = row["ma_nut"]
        return pk

    def _edge_rows(self, pks: list[int], types: set[EdgeType] | None, direction: str) -> list[sqlite3.Row]:
        marks = ",".join("?" * len(pks))
        if direction == "out":
            where, args = f"c.ma_nut_nguon IN ({marks})", list(pks)
        elif direction == "in":
            where, args = f"c.ma_nut_dich IN ({marks})", list(pks)
        else:
            where, args = f"(c.ma_nut_nguon IN ({marks}) OR c.ma_nut_dich IN ({marks}))", [*pks, *pks]
        if types:
            where += f" AND c.loai_canh IN ({','.join('?' * len(types))})"
            args += [t.value for t in types]
        return self.conn.execute(
            "SELECT c.*, ns.id_nut AS src_id, nd.id_nut AS dst_id, ts.duong_dan_tuong_doi AS ev_file"
            " FROM canh c JOIN nut ns ON ns.ma_nut = c.ma_nut_nguon JOIN nut nd ON nd.ma_nut = c.ma_nut_dich"
            f" LEFT JOIN tep ts ON ts.ma_tep = ns.ma_tep WHERE {where} ORDER BY c.ma_canh", args).fetchall()

    def _nodes_by_pk(self, pks: list[int]) -> list[Node]:
        by_pk: dict[int, Node] = {}
        for chunk in _chunks(pks):
            rows = self.conn.execute(
                f"{self._NODE_SQL} WHERE n.ma_nut IN ({','.join('?' * len(chunk))})", chunk).fetchall()
            by_pk.update({r["ma_nut"]: self._node(r) for r in rows})
        return [by_pk[pk] for pk in pks]

    @staticmethod
    def _node(r: sqlite3.Row) -> Node:
        return Node(id=r["id_nut"], kind=NodeKind(r["loai_nut"]), label=r["nhan"], qualified_name=r["ten_day_du"],
                    language=r["language"], file=r["file"], line_start=r["dong_bat_dau"], line_end=r["dong_ket_thuc"],
                    is_test=bool(r["la_kiem_thu"]), origin=Origin(r["nguon_goc"]), signature=r["chu_ky"],
                    doc=r["tai_lieu"])

    row_to_node = _node  # dùng cho store/search.py (hàng có thêm cột `file`, `language`)
