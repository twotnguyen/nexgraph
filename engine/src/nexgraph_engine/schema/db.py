"""Mở CSDL SQLite của NexGraph (đồ thị theo project và cá nhân theo ứng dụng)."""
import sqlite3
from importlib import resources
from pathlib import Path
from typing import Literal

GRAPH_SCHEMA_VERSION = 5
APP_SCHEMA_VERSION = 1
MIN_SQLITE = (3, 43, 0)  # FTS5 contentless_delete


class SchemaVersionError(RuntimeError):
    """CSDL do phiên bản NexGraph mới hơn tạo ra."""


class SchemaOutdatedError(RuntimeError):
    """CSDL cũ hơn ứng dụng và đang mở chỉ đọc nên không nâng cấp được."""


class UnsupportedSqliteError(RuntimeError):
    """SQLite của Python đang chạy quá cũ."""


def load_sql(name: Literal["graph", "app"]) -> str:
    return resources.files("nexgraph_engine.schema").joinpath(f"{name}.sql").read_text(encoding="utf-8")


def _migrate(conn: sqlite3.Connection, version: int, target: int) -> None:
    """Nâng cấp từng bậc trong một giao dịch: migrate_{v}_to_{v+1}.sql."""
    conn.isolation_level = None
    conn.execute("BEGIN IMMEDIATE")
    try:
        for v in range(version, target):
            script = resources.files("nexgraph_engine.schema").joinpath(f"migrate_{v}_to_{v + 1}.sql")
            for stmt in _split_statements(script.read_text(encoding="utf-8")):
                conn.execute(stmt)
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.isolation_level = ""


def _split_statements(sql: str) -> list[str]:
    out, buf = [], ""
    for line in sql.splitlines(keepends=True):
        if line.lstrip().startswith("--"):
            continue
        buf += line
        if sqlite3.complete_statement(buf):
            out.append(buf.strip())
            buf = ""
    return out


def _open(
    path: Path, sql_name: Literal["graph", "app"], *, read_only: bool, wal: bool, current: int
) -> sqlite3.Connection:
    if sqlite3.sqlite_version_info < MIN_SQLITE:
        raise UnsupportedSqliteError(
            f"SQLite {sqlite3.sqlite_version} quá cũ, cần >= {'.'.join(map(str, MIN_SQLITE))}"
        )
    if read_only:
        conn = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    if read_only:
        # Một truy vấn HTTP/MCP có thể đọc nhiều bảng khi graph mới được công bố.
        conn.execute("BEGIN")
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if version > current:
        conn.close()
        raise SchemaVersionError(f"CSDL phiên bản {version}, ứng dụng chỉ hỗ trợ đến {current}")
    if 0 < version < current:
        if read_only:
            conn.close()
            raise SchemaOutdatedError(f"CSDL phiên bản {version} cũ hơn {current}. Mở dự án bằng ứng dụng để nâng cấp")
        _migrate(conn, version, current)
    if version == 0 and not read_only:
        conn.executescript(load_sql(sql_name))
    if wal and not read_only:
        conn.execute("PRAGMA journal_mode = WAL")
    return conn


def open_graph_db(path: Path, *, read_only: bool = False) -> sqlite3.Connection:
    return _open(path, "graph", read_only=read_only, wal=True, current=GRAPH_SCHEMA_VERSION)


def open_app_db(path: Path, *, read_only: bool = False) -> sqlite3.Connection:
    return _open(path, "app", read_only=read_only, wal=True, current=APP_SCHEMA_VERSION)
