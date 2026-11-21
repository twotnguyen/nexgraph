"""Đọc/ghi `<data_dir>/global.db`. Mỗi lời gọi một kết nối riêng nên dùng được từ nhiều luồng."""
from __future__ import annotations

import sqlite3
import time
from contextlib import closing
from pathlib import Path

from nexgraph_engine.errors import ApiError
from nexgraph_engine.schema.db import SchemaVersionError, open_global_db

EDGE_COLUMNS = ("du_an_nguon", "id_nut_nguon", "du_an_dich", "id_nut_dich", "loai_canh", "loai_con",
                "diem_tin_cay", "tep_bang_chung", "dong_bang_chung")


class GlobalStore:
    def __init__(self, data_dir: Path) -> None:
        self.path = Path(data_dir) / "global.db"

    def _conn(self, read_only: bool = False) -> sqlite3.Connection:
        try:
            conn = open_global_db(self.path, read_only=read_only)
        except SchemaVersionError as exc:
            raise ApiError(409, "schema_version", f"Graph chung do phiên bản NexGraph mới hơn tạo: {exc}") from exc
        conn.execute("PRAGMA busy_timeout = 5000")
        return conn

    def members(self, *, read_only: bool = False) -> list[tuple[str, int]]:
        if read_only and not self.path.is_file():  # MCP chỉ đọc khi app chưa tạo global.db: nhóm rỗng
            return []
        with closing(self._conn(read_only)) as c:
            try:
                return [(r[0], r[1]) for r in c.execute("SELECT ma_du_an, them_luc FROM du_an_chung ORDER BY them_luc, rowid")]
            except sqlite3.OperationalError:
                if read_only:  # tiến trình khác đang tạo global.db (user_version còn 0): nhóm rỗng
                    return []
                raise

    def add(self, project_id: str) -> bool:
        with closing(self._conn()) as c, c:
            cur = c.execute("INSERT OR IGNORE INTO du_an_chung VALUES (?, ?)", (project_id, time.time_ns() // 1_000_000))
            return cur.rowcount == 1

    def remove(self, project_id: str) -> bool:
        with closing(self._conn()) as c, c:
            return c.execute("DELETE FROM du_an_chung WHERE ma_du_an = ?", (project_id,)).rowcount == 1

    def replace_edges(self, rows: list[dict]) -> int:
        """Thay toàn bộ cạnh trong một giao dịch; bỏ cạnh có đầu không còn là thành viên (bị gỡ giữa chừng)."""
        with closing(self._conn()) as c, c:
            members = {r[0] for r in c.execute("SELECT ma_du_an FROM du_an_chung")}
            c.execute("DELETE FROM canh_lien_repo")
            keep = [r for r in rows if r["du_an_nguon"] in members and r["du_an_dich"] in members]
            c.executemany(
                f"INSERT OR IGNORE INTO canh_lien_repo ({', '.join(EDGE_COLUMNS)}) VALUES ({', '.join('?' * len(EDGE_COLUMNS))})",
                [tuple(r.get(k) for k in EDGE_COLUMNS) for r in keep])
            return len(keep)

    def edges(self, project_ids: list[str] | None = None, *, read_only: bool = False) -> list[dict]:
        if read_only and not self.path.is_file():
            return []
        with closing(self._conn(read_only)) as c:
            try:
                rows = [dict(r) for r in c.execute(
                    f"SELECT {', '.join(EDGE_COLUMNS)}, muc_tin_cay FROM canh_lien_repo ORDER BY ma_canh")]
            except sqlite3.OperationalError:
                if read_only:
                    return []
                raise
        if project_ids is None:
            return rows
        wanted = set(project_ids)
        return [r for r in rows if r["du_an_nguon"] in wanted and r["du_an_dich"] in wanted]
