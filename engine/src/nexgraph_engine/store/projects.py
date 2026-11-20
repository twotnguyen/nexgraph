"""Đăng ký project đã mở (CSDL cá nhân app.db) và chọn nơi lưu đồ thị (spec §5.10)."""
from __future__ import annotations

import sqlite3
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from nexgraph_engine.schema.db import SchemaOutdatedError, SchemaVersionError, open_app_db, open_graph_db
from nexgraph_engine.store.graph_store import GraphStore

NEXGRAPH_DIR = ".nexgraph"


class ProjectPathError(ValueError):
    """Đường dẫn không phải một thư mục tồn tại."""


@dataclass(frozen=True)
class ProjectInfo:
    project_id: str
    path: Path
    name: str
    is_git: bool
    storage: Literal["in_project", "app_dir"]
    graph_db: Path
    last_opened: int


class ProjectRegistry:
    def __init__(self, app_data_dir: Path, *, read_only: bool = False) -> None:
        self.app_data_dir = Path(app_data_dir)
        self._app_db = self.app_data_dir / "app.db"
        self._read_only = read_only
        if not read_only:
            open_app_db(self._app_db).close()  # tạo sẵn

    def open_project(self, path: Path) -> ProjectInfo:
        if self._read_only:
            raise RuntimeError("Danh bạ dự án đang mở chỉ đọc")
        root = Path(path).expanduser()
        if not root.is_dir():
            raise ProjectPathError(f"Không phải thư mục: {root}")
        root = root.resolve()
        in_project_db = root / NEXGRAPH_DIR / "graph.db"

        known_id = self._id_for_path(root)
        if in_project_db.exists():
            # Index đi theo project: lấy id trong CSDL kể cả khi registry chưa biết đường dẫn này (đã đổi tên/di chuyển).
            project_id = self._read_id(in_project_db) or known_id or str(uuid.uuid4())
            graph_db, storage = in_project_db, "in_project"
        else:
            project_id = known_id or str(uuid.uuid4())
            app_db = self._app_dir_db(project_id)
            if known_id and app_db.exists():
                graph_db, storage = app_db, "app_dir"
            else:
                graph_db, storage = self._create_storage(root, project_id, in_project_db)
        is_git = (root / ".git").exists()
        conn = open_graph_db(graph_db)
        try:
            GraphStore(conn).init_project(root.name, is_git, project_id)
        finally:
            conn.close()
        return self._remember(project_id, root, storage, graph_db, is_git)

    def list_projects(self) -> list[ProjectInfo]:
        conn = open_app_db(self._app_db, read_only=True)
        try:
            visible = self._visible(conn)
            rows = conn.execute(f"SELECT * FROM du_an_da_mo WHERE {visible} ORDER BY mo_lan_cuoi DESC, rowid DESC").fetchall()
        finally:
            conn.close()
        return [self._info(r) for r in rows]

    def get(self, project_id: str) -> ProjectInfo | None:
        conn = open_app_db(self._app_db, read_only=True)
        try:
            visible = self._visible(conn)
            row = conn.execute(f"SELECT * FROM du_an_da_mo WHERE ma_du_an = ? AND {visible}", (project_id,)).fetchone()
        finally:
            conn.close()
        return self._info(row) if row else None

    def remove(self, project_id: str) -> bool:
        """Gỡ đăng ký khỏi ứng dụng, giữ đồ thị và ID để mở lại cùng đường dẫn."""
        if self._read_only:
            raise RuntimeError("Danh bạ dự án đang mở chỉ đọc")
        conn = self._conn()
        try:
            result = conn.execute("UPDATE du_an_da_mo SET da_go = 1 WHERE ma_du_an = ? AND da_go = 0", (project_id,))
            conn.commit()
            return result.rowcount == 1
        finally:
            conn.close()

    # --- nội bộ -------------------------------------------------------------------
    def _conn(self) -> sqlite3.Connection:
        return open_app_db(self._app_db, read_only=self._read_only)

    @staticmethod
    def _visible(conn: sqlite3.Connection) -> str:
        # MCP có thể mở kho AppData cũ ở chế độ chỉ đọc trước khi desktop nâng cấp.
        return "da_go = 0" if conn.execute("PRAGMA user_version").fetchone()[0] >= 2 else "1"

    def _app_dir_db(self, project_id: str) -> Path:
        return self.app_data_dir / "projects" / project_id / "graph.db"

    def _id_for_path(self, root: Path) -> str | None:
        conn = open_app_db(self._app_db, read_only=True)
        try:
            row = conn.execute("SELECT ma_du_an FROM du_an_da_mo WHERE duong_dan_tuyet_doi = ?", (str(root),)).fetchone()
        finally:
            conn.close()
        return row["ma_du_an"] if row else None

    @staticmethod
    def _read_id(graph_db: Path) -> str | None:
        try:
            conn = open_graph_db(graph_db, read_only=True)
        except SchemaOutdatedError:
            conn = sqlite3.connect(f"{graph_db.resolve().as_uri()}?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row
        except Exception:
            return None
        try:
            row = conn.execute("SELECT ma_du_an FROM du_an").fetchone()
        finally:
            conn.close()
        return row["ma_du_an"] if row else None

    def _create_storage(self, root: Path, project_id: str, in_project_db: Path) -> tuple[Path, str]:
        try:
            nexgraph_dir = in_project_db.parent
            nexgraph_dir.mkdir(exist_ok=True)
            ignore = nexgraph_dir / ".gitignore"
            if not ignore.exists():
                ignore.write_text("*\n", encoding="utf-8")
            open_graph_db(in_project_db).close()
            return in_project_db, "in_project"
        except (OSError, sqlite3.OperationalError):
            return self._app_dir_db(project_id), "app_dir"

    def _remember(self, project_id: str, root: Path, storage: str, graph_db: Path, is_git: bool) -> ProjectInfo:
        now = time.time_ns() // 1_000_000
        conn = self._conn()
        try:
            conn.execute("DELETE FROM du_an_da_mo WHERE duong_dan_tuyet_doi = ? AND ma_du_an <> ?", (str(root), project_id))
            conn.execute(
                "INSERT INTO du_an_da_mo (ma_du_an, duong_dan_tuyet_doi, ten, noi_luu, mo_lan_cuoi) VALUES (?, ?, ?, ?, ?)"
                " ON CONFLICT (ma_du_an) DO UPDATE SET duong_dan_tuyet_doi = excluded.duong_dan_tuyet_doi,"
                " ten = excluded.ten, noi_luu = excluded.noi_luu, mo_lan_cuoi = excluded.mo_lan_cuoi, da_go = 0",
                (project_id, str(root), root.name[:255] or "project",
                 "trong_du_an" if storage == "in_project" else "thu_muc_app", now),
            )
            conn.commit()
        finally:
            conn.close()
        return ProjectInfo(project_id, root, root.name, is_git, storage, graph_db, now)  # type: ignore[arg-type]

    def _info(self, r: sqlite3.Row) -> ProjectInfo:
        root = Path(r["duong_dan_tuyet_doi"])
        in_project = r["noi_luu"] == "trong_du_an"
        graph_db = root / NEXGRAPH_DIR / "graph.db" if in_project else self._app_dir_db(r["ma_du_an"])
        return ProjectInfo(r["ma_du_an"], root, r["ten"], (root / ".git").exists(),
                           "in_project" if in_project else "app_dir", graph_db, r["mo_lan_cuoi"])


class ProjectNotIndexed(RuntimeError):
    pass


def resolve_graph_db(project: Path, data_dir: Path | None) -> Path:
    """Tìm CSDL đồ thị mà app đã tạo; không tạo mới (MCP không được ghi)."""
    root = project.resolve()
    in_project = root / NEXGRAPH_DIR / "graph.db"
    if in_project.is_file():
        return in_project
    if data_dir is not None and (data_dir / "app.db").is_file():
        for info in ProjectRegistry(data_dir, read_only=True).list_projects():
            if info.path.resolve() == root and info.graph_db.is_file():
                return info.graph_db
    raise ProjectNotIndexed(f"Dự án chưa được lập chỉ mục trong NexGraph: {root}")
