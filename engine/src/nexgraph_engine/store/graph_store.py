"""Ghi và đọc đồ thị của một project trong SQLite. Nơi duy nhất dịch giữa mã tiếng Anh và cột tiếng Việt."""
from __future__ import annotations

import json
import sqlite3
import time
import uuid
from collections.abc import Iterable, Iterator
from typing import Literal

from nexgraph_engine.index.keywords import search_keywords
from nexgraph_engine.schema.db import GRAPH_SCHEMA_VERSION
from nexgraph_engine.schema.enums import Confidence, EdgeType, NodeKind, Origin
from nexgraph_engine.store.models import (
    Edge, FileRec, Neighborhood, Node, RunState, StoredEdge, UnresolvedRef,
)

_CHUNK = 400
_END_STATES = ("hoan_tat", "loi", "huy")


def _chunks(items: list, size: int = _CHUNK) -> Iterator[list]:
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
            (pid, name[:255] or "project", int(has_git), GRAPH_SCHEMA_VERSION, int(time.time())),
        )
        self.conn.commit()
        return pid

    def project_id(self) -> str | None:
        row = self.conn.execute("SELECT ma_du_an FROM du_an").fetchone()
        return row["ma_du_an"] if row else None

    def begin_run(self, files_total: int = 0, commit_sha: str | None = None, *,
                  kind: Literal["day_du", "tang_dan"] = "day_du", subdir: str | None = None,
                  exclude: list[str] | None = None, include_docs: bool = False, include_media: bool = False) -> int:
        pid = self.project_id()
        cur = self.conn.execute(
            "INSERT INTO lan_lap_chi_muc (ma_du_an, loai, trang_thai, bat_dau_luc, so_tep_tong, commit_sha, thu_muc_con,"
            " mau_bo_qua, gom_tai_lieu, gom_media) VALUES (?, ?, 'cho', ?, ?, ?, ?, ?, ?, ?)",
            (pid, kind, int(time.time()), files_total, commit_sha, subdir, json.dumps(exclude) if exclude else None,
             int(include_docs), int(include_media)),
        )
        self.conn.commit()
        return int(cur.lastrowid)

    def last_scope(self) -> str | None:
        """Thư mục con của lần lập chỉ mục đầy đủ gần nhất (đã xong hoặc đang chạy); None = cả project."""
        row = self.conn.execute(
            "SELECT thu_muc_con FROM lan_lap_chi_muc WHERE loai = 'day_du'"
            " AND trang_thai IN ('cho', 'cau_truc', 'phan_giai', 'hoan_tat') ORDER BY ma_lan DESC LIMIT 1").fetchone()
        return row["thu_muc_con"] if row else None

    def last_exclude(self) -> list[str]:
        """Mẫu bỏ qua của lần lập chỉ mục đầy đủ gần nhất; refresh tăng dần dùng lại để không thêm tệp đã loại."""
        row = self.conn.execute(
            "SELECT mau_bo_qua FROM lan_lap_chi_muc WHERE loai = 'day_du'"
            " AND trang_thai IN ('cho', 'cau_truc', 'phan_giai', 'hoan_tat') ORDER BY ma_lan DESC LIMIT 1").fetchone()
        return json.loads(row["mau_bo_qua"]) if row and row["mau_bo_qua"] else []

    def last_doc_flags(self) -> tuple[bool, bool]:
        """(gồm tài liệu, gồm media) của lần lập chỉ mục đầy đủ gần nhất; refresh dùng lại như mẫu bỏ qua."""
        row = self.conn.execute(
            "SELECT gom_tai_lieu, gom_media FROM lan_lap_chi_muc WHERE loai = 'day_du'"
            " AND trang_thai IN ('cho', 'cau_truc', 'phan_giai', 'hoan_tat') ORDER BY ma_lan DESC LIMIT 1").fetchone()
        return (bool(row["gom_tai_lieu"]), bool(row["gom_media"])) if row else (False, False)

    # --- kiểu biến và mốc tệp (lược đồ v2) -------------------------------------------------
    def add_bindings(self, bindings: dict[str, dict[str, str]]) -> None:
        for node_id, names in bindings.items():
            pk = self._pk(node_id)
            for name, typ in names.items():
                if not name or not typ:
                    continue
                self.conn.execute(
                    "INSERT INTO kieu_bien (ma_nut, ten, kieu) VALUES (?, ?, ?)"
                    " ON CONFLICT (ma_nut, ten) DO UPDATE SET kieu = excluded.kieu",
                    (pk, name[:255], typ[:255]))

    def bindings(self) -> dict[str, dict[str, str]]:
        out: dict[str, dict[str, str]] = {}
        for r in self.conn.execute("SELECT n.id_nut, k.ten, k.kieu FROM kieu_bien k JOIN nut n ON n.ma_nut = k.ma_nut"):
            out.setdefault(r["id_nut"], {})[r["ten"]] = r["kieu"]
        return out

    def delete_bindings_of_file(self, rel_path: str) -> None:
        self.conn.execute(
            "DELETE FROM kieu_bien WHERE ma_nut IN (SELECT n.ma_nut FROM nut n JOIN tep t ON t.ma_tep = n.ma_tep"
            " WHERE t.duong_dan_tuong_doi = ?)", (rel_path,))

    def snapshot_baseline(self) -> None:
        self.conn.execute("DELETE FROM moc_tep")
        self.conn.execute("INSERT INTO moc_tep (duong_dan_tuong_doi, ma_bam) SELECT duong_dan_tuong_doi, ma_bam FROM tep")

    def baseline(self) -> dict[str, str]:
        return {r[0]: r[1] for r in self.conn.execute("SELECT duong_dan_tuong_doi, ma_bam FROM moc_tep")}

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
                self._node_values(n))
            self._node_pk[n.id] = int(cur.lastrowid)
            self._index_fts(int(cur.lastrowid), n)

    def _node_values(self, n: Node) -> tuple:
        return (n.id, n.kind.value, n.label[:255] or "?", n.qualified_name[:1024] or "?", n.line_start,
                n.line_end, int(n.is_test), n.origin.value, (n.signature or None) and n.signature[:2000],
                n.doc, self._file(n.file) if n.file else None)

    def _index_fts(self, pk: int, n: Node) -> None:
        if n.kind != NodeKind.REPOSITORY:  # nút gốc không phải thứ để tìm
            self.conn.execute(
                "INSERT INTO nut_fts (rowid, nhan, ten_day_du, chu_ky, tai_lieu, tu_khoa) VALUES (?, ?, ?, ?, ?, ?)",
                (pk, n.label[:255], n.qualified_name[:1024], n.signature and n.signature[:2000], n.doc,
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

    def clear_communities(self) -> None:
        self.conn.execute("UPDATE nut SET ma_khoi = NULL")
        self.conn.execute("DELETE FROM khoi_kien_truc")

    def add_community(self, name: str, cohesion: float, files: list[str]) -> int:
        cur = self.conn.execute("INSERT INTO khoi_kien_truc (ten, do_gan_ket) VALUES (?, ?)",
                                (name[:200] or "Cụm", max(0.0, min(1.0, cohesion))))
        block_id = int(cur.lastrowid)
        for chunk in _chunks(list(files)):
            self.conn.execute(
                "UPDATE nut SET ma_khoi = ? WHERE ma_tep IN (SELECT ma_tep FROM tep WHERE duong_dan_tuong_doi IN"
                f" ({','.join('?' * len(chunk))}))", [block_id, *chunk])
        return block_id

    def communities(self) -> list[dict]:
        out = []
        for k in self.conn.execute("SELECT ma_khoi, ten, do_gan_ket FROM khoi_kien_truc ORDER BY ma_khoi"):
            files = [r[0] for r in self.conn.execute(
                "SELECT t.duong_dan_tuong_doi FROM nut n JOIN tep t ON t.ma_tep = n.ma_tep"
                " WHERE n.ma_khoi = ? AND n.loai_nut = 'file' ORDER BY t.duong_dan_tuong_doi", (k["ma_khoi"],))]
            out.append({"id": k["ma_khoi"], "name": k["ten"], "cohesion": k["do_gan_ket"], "files": files})
        return out

    def file_community(self, rel_path: str) -> int | None:
        row = self.conn.execute(
            "SELECT n.ma_khoi FROM nut n JOIN tep t ON t.ma_tep = n.ma_tep"
            " WHERE t.duong_dan_tuong_doi = ? AND n.loai_nut = 'file'", (rel_path,)).fetchone()
        return row["ma_khoi"] if row else None

    # --- cập nhật tăng dần (kế hoạch con 4) -------------------------------------------------
    def file_records(self) -> dict[str, FileRec]:
        return {r["duong_dan_tuong_doi"]: FileRec(r["duong_dan_tuong_doi"], r["ngon_ngu"], r["kich_thuoc"], r["mtime"],
                                                  r["ma_bam"], bool(r["la_kiem_thu"]))
                for r in self.conn.execute("SELECT * FROM tep")}

    def touch_file(self, rec: FileRec) -> None:
        """Nội dung không đổi (cùng mã băm) nhưng kích thước/mtime khác: chỉ làm mới dấu vết để lần sau khỏi băm lại."""
        self.conn.execute("UPDATE tep SET kich_thuoc = ?, mtime = ? WHERE duong_dan_tuong_doi = ?",
                          (rec.size, rec.mtime, rec.rel_path))

    def file_graph_signature(self) -> tuple[int, int]:
        """(số cặp tệp có cạnh IMPORTS/CALLS, tổng số cạnh): dùng để biết khi nào cần chia lại cộng đồng."""
        row = self.conn.execute(
            "SELECT count(DISTINCT ns.ma_tep || '>' || nd.ma_tep), count(*) FROM canh c"
            " JOIN nut ns ON ns.ma_nut = c.ma_nut_nguon JOIN nut nd ON nd.ma_nut = c.ma_nut_dich"
            " WHERE c.loai_canh IN ('IMPORTS', 'CALLS') AND ns.ma_tep <> nd.ma_tep").fetchone()
        return (row[0], row[1])

    def node_ids_of_file(self, rel_path: str) -> dict[str, int]:
        return {r["id_nut"]: r["ma_nut"] for r in self.conn.execute(
            "SELECT n.id_nut, n.ma_nut FROM nut n JOIN tep t ON t.ma_tep = n.ma_tep"
            " WHERE t.duong_dan_tuong_doi = ?", (rel_path,))}

    def replace_file(self, run_id: int, rec: FileRec, nodes: list[Node], edges: list[Edge],
                     refs: list[UnresolvedRef], bindings: dict[str, dict[str, str]],
                     errors: list[tuple[str, str]]) -> None:
        """Thay nội dung một tệp đã có tại chỗ: nút còn giữ nguyên `id_nut` (cạnh đi vào còn nguyên)."""
        c = self.conn
        c.execute("UPDATE tep SET ngon_ngu = ?, kich_thuoc = ?, mtime = ?, ma_bam = ?, la_kiem_thu = ?, ma_lan = ?"
                  " WHERE duong_dan_tuong_doi = ?",
                  (rec.language, rec.size, rec.mtime, rec.sha256, int(rec.is_test), run_id, rec.rel_path))
        file_pk = self._file(rec.rel_path)
        old = self.node_ids_of_file(rec.rel_path)
        for chunk in _chunks(list(old.values())):
            marks = ",".join("?" * len(chunk))
            c.execute(f"DELETE FROM canh WHERE ma_nut_nguon IN ({marks})", chunk)
            c.execute(f"DELETE FROM tham_chieu_chua_phan_giai WHERE ma_nut_nguon IN ({marks})", chunk)
            c.execute(f"DELETE FROM kieu_bien WHERE ma_nut IN ({marks})", chunk)
        c.execute("DELETE FROM loi_phan_tich WHERE ma_tep = ?", (file_pk,))
        new_ids = {n.id for n in nodes}
        gone = [pk for nid, pk in old.items() if nid not in new_ids]
        for chunk in _chunks(gone):
            c.execute(f"DELETE FROM nut WHERE ma_nut IN ({','.join('?' * len(chunk))})", chunk)
        for nid in old:
            if nid not in new_ids:
                self._node_pk.pop(nid, None)
        for n in nodes:
            pk = old.get(n.id)
            if pk is None:
                self.add_nodes([n])
                continue
            v = self._node_values(n)
            c.execute("UPDATE nut SET loai_nut = ?, nhan = ?, ten_day_du = ?, dong_bat_dau = ?, dong_ket_thuc = ?,"
                      " la_kiem_thu = ?, nguon_goc = ?, chu_ky = ?, tai_lieu = ?, ma_tep = ? WHERE ma_nut = ?",
                      (*v[1:], pk))
            c.execute("DELETE FROM nut_fts WHERE rowid = ?", (pk,))
            self._index_fts(pk, n)
        self.add_edges(edges)
        self.add_unresolved(refs)
        self.add_bindings(bindings)
        for kind, detail in errors:
            self.add_file_error(rec.rel_path, kind, detail)

    def remove_file(self, rel_path: str) -> None:
        """Xoá tệp cùng nút, cạnh, tham chiếu, kiểu biến, lỗi của nó (khoá ngoại ON DELETE CASCADE)."""
        for nid in self.node_ids_of_file(rel_path):
            self._node_pk.pop(nid, None)
        self.conn.execute("DELETE FROM tep WHERE duong_dan_tuong_doi = ?", (rel_path,))
        self._file_pk.pop(rel_path, None)

    def remove_node(self, node_id: str) -> None:
        self.conn.execute("DELETE FROM nut WHERE id_nut = ?", (node_id,))
        self._node_pk.pop(node_id, None)

    def has_outgoing(self, node_id: str, type_: EdgeType) -> bool:
        return self.conn.execute(
            "SELECT 1 FROM canh c JOIN nut n ON n.ma_nut = c.ma_nut_nguon WHERE n.id_nut = ? AND c.loai_canh = ?"
            " LIMIT 1", (node_id, type_.value)).fetchone() is not None

    def requeue_failed_refs(self, tails: Iterable[str] | None = None, *, imports: bool = False) -> int:
        """Đưa tham chiếu thất bại về hàng đợi để phân giải lại khi có ký hiệu mới."""
        if tails is None:
            cur = self.conn.execute("UPDATE tham_chieu_chua_phan_giai SET trang_thai = 'cho' WHERE trang_thai = 'that_bai'")
            return cur.rowcount
        total = 0
        tails_list = list(tails)
        expr = "substr(ten_tham_chieu, length(rtrim(ten_tham_chieu, replace(ten_tham_chieu, '.', ''))) + 1)"
        for chunk in _chunks(tails_list, 400):
            if not chunk:
                continue
            placeholders = ",".join("?" for _ in chunk)
            cur = self.conn.execute(
                f"UPDATE tham_chieu_chua_phan_giai SET trang_thai = 'cho' WHERE trang_thai = 'that_bai' AND {expr} IN ({placeholders})",
                chunk,
            )
            total += cur.rowcount
        if imports:
            cur = self.conn.execute(
                "UPDATE tham_chieu_chua_phan_giai SET trang_thai = 'cho' WHERE trang_thai = 'that_bai' AND loai_tham_chieu = 'IMPORTS'"
            )
            total += cur.rowcount
        return total

    def import_edges(self) -> list[tuple[str, str, str | None]]:
        """(tệp nguồn, tệp đích, loai_con) của các cạnh IMPORTS đã phân giải giữa hai nút tệp."""
        return [(r[0], r[1], r[2]) for r in self.conn.execute(
            "SELECT ts.duong_dan_tuong_doi, td.duong_dan_tuong_doi, c.loai_con FROM canh c"
            " JOIN nut ns ON ns.ma_nut = c.ma_nut_nguon JOIN nut nd ON nd.ma_nut = c.ma_nut_dich"
            " JOIN tep ts ON ts.ma_tep = ns.ma_tep JOIN tep td ON td.ma_tep = nd.ma_tep"
            " WHERE c.loai_canh = 'IMPORTS' AND ns.loai_nut = 'file' AND nd.loai_nut = 'file'")]

    _DEP_TYPES = "('CONTAINS', 'DEFINES', 'TESTED_BY')"

    def files_with_edges_into(self, node_pks: list[int]) -> set[str]:
        """Tệp có cạnh phụ thuộc (không phải CONTAINS/DEFINES/TESTED_BY) tới một trong các nút."""
        out: set[str] = set()
        for chunk in _chunks(node_pks):
            for r in self.conn.execute(
                    "SELECT DISTINCT t.duong_dan_tuong_doi FROM canh c JOIN nut ns ON ns.ma_nut = c.ma_nut_nguon"
                    " JOIN tep t ON t.ma_tep = ns.ma_tep"
                    f" WHERE c.ma_nut_dich IN ({','.join('?' * len(chunk))}) AND c.loai_canh NOT IN {self._DEP_TYPES}",
                    chunk):
                out.add(r[0])
        return out

    def files_with_edges_to_names(self, names: list[str], kinds: list[str]) -> set[str]:
        """Tệp có cạnh phụ thuộc tới nút loại `kinds` có `ten_day_du` thuộc `names` (nguồn gốc của mơ hồ mới)."""
        out: set[str] = set()
        kind_marks = ",".join("?" * len(kinds))
        for chunk in _chunks(names):  # type: ignore[arg-type]
            for r in self.conn.execute(
                    "SELECT DISTINCT t.duong_dan_tuong_doi FROM canh c JOIN nut ns ON ns.ma_nut = c.ma_nut_nguon"
                    " JOIN tep t ON t.ma_tep = ns.ma_tep JOIN nut nd ON nd.ma_nut = c.ma_nut_dich"
                    f" WHERE nd.ten_day_du IN ({','.join('?' * len(chunk))}) AND nd.loai_nut IN ({kind_marks})"
                    f" AND c.loai_canh NOT IN {self._DEP_TYPES}", [*chunk, *kinds]):
                out.add(r[0])
        return out

    def has_export_edges(self, rel_path: str) -> bool:
        return self.conn.execute(
            "SELECT 1 FROM canh c JOIN nut n ON n.ma_nut = c.ma_nut_nguon JOIN tep t ON t.ma_tep = n.ma_tep"
            " WHERE t.duong_dan_tuong_doi = ? AND c.loai_canh = 'IMPORTS' AND c.loai_con IN ('export', 'part')"
            " LIMIT 1", (rel_path,)).fetchone() is not None

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
            self._stored_edge(r)
            for _, r in sorted(edge_rows.items())
            if r["ma_nut_nguon"] in seen and r["ma_nut_dich"] in seen
        ]
        total: int | None = None
        if depth == 1:
            type_cond = ""
            params: list = []
            if types:
                ph = ",".join("?" for _ in types)
                type_cond = f" AND loai_canh IN ({ph})"
                params.extend([t.value for t in types])

            if direction == "out":
                sql = f"SELECT count(DISTINCT ma_nut_dich) FROM canh WHERE ma_nut_nguon = ?{type_cond} AND ma_nut_dich != ?"
                total = self.conn.execute(sql, [start, *params, start]).fetchone()[0]
            elif direction == "in":
                sql = f"SELECT count(DISTINCT ma_nut_nguon) FROM canh WHERE ma_nut_dich = ?{type_cond} AND ma_nut_nguon != ?"
                total = self.conn.execute(sql, [start, *params, start]).fetchone()[0]
            else:
                sql = (
                    f"SELECT count(DISTINCT CASE WHEN ma_nut_nguon = ? THEN ma_nut_dich ELSE ma_nut_nguon END)"
                    f" FROM canh WHERE (ma_nut_nguon = ? OR ma_nut_dich = ?){type_cond}"
                    f" AND CASE WHEN ma_nut_nguon = ? THEN ma_nut_dich ELSE ma_nut_nguon END != ?"
                )
                total = self.conn.execute(sql, [start, start, start, *params, start, start]).fetchone()[0]

        return Neighborhood(nodes=nodes, edges=edges, truncated=truncated, total=total)

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
    def _stored_edge(r: sqlite3.Row) -> StoredEdge:
        """Hàng gồm cột của `canh` kèm `src_id`, `dst_id`, `ev_file` (xem `_edge_rows`)."""
        return StoredEdge(id=r["ma_canh"], file=r["ev_file"], edge=Edge(
            source=r["src_id"], target=r["dst_id"], type=EdgeType(r["loai_canh"]), subtype=r["loai_con"],
            confidence=Confidence(r["muc_tin_cay"]), confidence_score=r["diem_tin_cay"],
            origin=Origin(r["nguon_goc"]), line=r["dong_bang_chung"], col=r["cot_bang_chung"]))

    row_to_edge = _stored_edge

    @staticmethod
    def _node(r: sqlite3.Row) -> Node:
        return Node(id=r["id_nut"], kind=NodeKind(r["loai_nut"]), label=r["nhan"], qualified_name=r["ten_day_du"],
                    language=r["language"], file=r["file"], line_start=r["dong_bat_dau"], line_end=r["dong_ket_thuc"],
                    is_test=bool(r["la_kiem_thu"]), origin=Origin(r["nguon_goc"]), signature=r["chu_ky"],
                    doc=r["tai_lieu"])

    row_to_node = _node  # dùng cho store/search.py (hàng có thêm cột `file`, `language`)
