import re
import sqlite3
from pathlib import Path

import pytest

from nexgraph_engine.schema.db import (
    SCHEMA_VERSION,
    SchemaVersionError,
    UnsupportedSqliteError,
    load_sql,
    open_app_db,
    open_graph_db,
)
from nexgraph_engine.schema.enums import Confidence, EdgeType, NodeKind, Origin

REPO_ROOT = Path(__file__).resolve().parents[2]


def _check_values(sql: str, column: str) -> set[str]:
    m = re.search(rf"{column}\s+TEXT\s+NOT NULL\s+CHECK\s*\(\s*{column}\s+IN\s*\((.*?)\)\s*\)", sql, re.S)
    assert m, f"không thấy CHECK của {column}"
    return set(re.findall(r"'([^']+)'", m.group(1)))


@pytest.mark.parametrize("enum_cls,column", [
    (NodeKind, "loai_nut"), (EdgeType, "loai_canh"), (Confidence, "muc_tin_cay"), (Origin, "nguon_goc"),
])
def test_enums_match_sql(enum_cls, column):
    assert {e.value for e in enum_cls} == _check_values(load_sql("graph"), column)


@pytest.mark.parametrize("name", ["graph", "app"])
def test_schema_files_match_design(name):
    design = REPO_ROOT / "design" / "database" / f"{name}.sql"
    if not design.exists():
        pytest.skip("không chạy trong repo đầy đủ")
    assert design.read_text(encoding="utf-8") == load_sql(name)


def test_open_is_idempotent(tmp_path):
    p = tmp_path / "graph.db"
    open_graph_db(p).close()
    conn = open_graph_db(p)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION == 1
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    conn.close()


def test_future_version_rejected(tmp_path):
    p = tmp_path / "graph.db"
    conn = open_graph_db(p)
    conn.execute("PRAGMA user_version = 99")
    conn.close()
    with pytest.raises(SchemaVersionError):
        open_graph_db(p)


def test_read_only_cannot_write(tmp_path):
    p = tmp_path / "graph.db"
    open_graph_db(p).close()
    ro = open_graph_db(p, read_only=True)
    assert ro.execute("SELECT count(*) FROM nut").fetchone()[0] == 0
    with pytest.raises(sqlite3.OperationalError):
        ro.execute("INSERT INTO du_an (ma_du_an, ten, co_git, phien_ban_schema, tao_luc) VALUES ('x', 'x', 0, 1, 0)")
    ro.close()


def test_unicode_path(tmp_path):
    p = tmp_path / "Đồ án" / "dữ liệu" / "graph.db"
    conn = open_graph_db(p)
    assert p.exists()
    conn.close()
    open_graph_db(p, read_only=True).close()


def test_app_db_opens(tmp_path):
    conn = open_app_db(tmp_path / "app.db")
    assert conn.execute("SELECT count(*) FROM du_an_da_mo").fetchone()[0] == 0
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    conn.close()


def test_old_sqlite_rejected(tmp_path, monkeypatch):
    monkeypatch.setattr(sqlite3, "sqlite_version_info", (3, 40, 0))
    with pytest.raises(UnsupportedSqliteError):
        open_graph_db(tmp_path / "graph.db")
