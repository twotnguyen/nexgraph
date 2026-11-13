import re
import sqlite3
from pathlib import Path

import pytest

from nexgraph_engine.schema.db import (
    GRAPH_SCHEMA_VERSION,
    SchemaOutdatedError,
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
    assert conn.execute("PRAGMA user_version").fetchone()[0] == GRAPH_SCHEMA_VERSION == 4
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    conn.close()


def test_future_version_rejected(tmp_path):
    p = tmp_path / "graph.db"
    conn = open_graph_db(p)
    conn.execute(f"PRAGMA user_version = {GRAPH_SCHEMA_VERSION + 1}")
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


V1_SQL = Path(__file__).parent / "fixtures" / "graph_v1.sql"


def _make_v1(path: Path) -> None:
    conn = sqlite3.connect(path)
    conn.executescript(V1_SQL.read_text(encoding="utf-8"))
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute(
        "INSERT INTO du_an (ma_du_an, ten, co_git, phien_ban_schema, tao_luc) VALUES (?, 'p', 0, 1, 0)",
        ("0" * 36,),
    )
    conn.execute("INSERT INTO lan_lap_chi_muc (ma_du_an, loai, trang_thai, bat_dau_luc) VALUES (?, 'day_du', 'cho', 0)", ("0" * 36,))
    conn.execute(
        "INSERT INTO tep (ma_lan, duong_dan_tuong_doi, ngon_ngu, ma_bam, kich_thuoc, mtime)"
        " VALUES (1, 'a.dart', 'dart', ?, 3, 0)",
        ("a" * 64,),
    )
    for i, name in enumerate(("a.dart#file", "a.dart::f#function")):
        conn.execute(
            "INSERT INTO nut (id_nut, loai_nut, nhan, ten_day_du, ma_tep, dong_bat_dau, dong_ket_thuc, nguon_goc)"
            " VALUES (?, ?, 'x', ?, 1, 1, 2, 'ast')",
            (name, "file" if i == 0 else "function", name),
        )
    conn.execute(
        "INSERT INTO canh (loai_canh, ma_nut_nguon, ma_nut_dich, muc_tin_cay, diem_tin_cay, nguon_goc)"
        " VALUES ('DEFINES', 1, 2, 'EXTRACTED', 1.0, 'ast')"
    )
    conn.commit()
    conn.close()


def test_v1_database_is_upgraded(tmp_path):
    p = tmp_path / "graph.db"
    _make_v1(p)
    conn = open_graph_db(p)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 4
    assert conn.execute("SELECT count(*) FROM kieu_bien").fetchone()[0] == 0
    assert conn.execute("SELECT count(*) FROM moc_tep").fetchone()[0] == 0
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(lan_lap_chi_muc)")}
    assert {"thu_muc_con", "mau_bo_qua", "gom_tai_lieu", "gom_media"} <= cols
    assert conn.execute("SELECT gom_tai_lieu, gom_media FROM lan_lap_chi_muc").fetchone()[:] == (0, 0)
    assert conn.execute("SELECT count(*) FROM nut").fetchone()[0] == 2
    assert conn.execute("SELECT count(*) FROM canh").fetchone()[0] == 1
    assert conn.execute("SELECT phien_ban_schema FROM du_an").fetchone()[0] == 4
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    conn.close()
    open_graph_db(p).close()  # lần hai không làm gì


def test_read_only_v1_is_rejected(tmp_path):
    p = tmp_path / "graph.db"
    _make_v1(p)
    with pytest.raises(SchemaOutdatedError):
        open_graph_db(p, read_only=True)


def test_new_database_is_v4(tmp_path):
    conn = open_graph_db(tmp_path / "graph.db")
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 4
    tables = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"kieu_bien", "moc_tep"} <= tables


def _node(conn):
    conn.execute(
        "INSERT INTO du_an (ma_du_an, ten, co_git, phien_ban_schema, tao_luc) VALUES (?, 'p', 0, 2, 0)", ("0" * 36,)
    )
    conn.execute(
        "INSERT INTO nut (id_nut, loai_nut, nhan, ten_day_du, nguon_goc) VALUES ('.#repository', 'repository', 'r', 'r', 'ast')"
    )
    return conn.execute("SELECT ma_nut FROM nut").fetchone()[0]


def test_binding_cascade_with_node(tmp_path):
    conn = open_graph_db(tmp_path / "graph.db")
    n = _node(conn)
    conn.execute("INSERT INTO kieu_bien (ma_nut, ten, kieu) VALUES (?, '_auth', 'AuthService')", (n,))
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO kieu_bien (ma_nut, ten, kieu) VALUES (?, '_auth', 'Other')", (n,))
    conn.execute("DELETE FROM nut")
    assert conn.execute("SELECT count(*) FROM kieu_bien").fetchone()[0] == 0


def test_baseline_rejects_bad_hash_and_backslash(tmp_path):
    conn = open_graph_db(tmp_path / "graph.db")
    conn.execute("INSERT INTO moc_tep VALUES ('lib/a.dart', ?)", ("a" * 64,))
    for path, h in (("lib/b.dart", "A" * 64), ("lib/b.dart", "a" * 63), ("lib\\b.dart", "a" * 64), ("/abs.dart", "a" * 64)):
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO moc_tep VALUES (?, ?)", (path, h))


def test_migrated_matches_fresh_schema(tmp_path):
    old = tmp_path / "old.db"
    _make_v1(old)
    a = open_graph_db(old)
    b = open_graph_db(tmp_path / "new.db")

    def shape(c):
        out = {}
        for t in ("kieu_bien", "moc_tep", "lan_lap_chi_muc"):
            out[t] = [tuple(r)[1:] for r in c.execute(f"PRAGMA table_info({t})")]
        return out

    assert shape(a) == shape(b)


def test_schema_sql_packaged():
    assert "kieu_bien" in load_sql("graph")
    from importlib import resources

    assert resources.files("nexgraph_engine.schema").joinpath("migrate_1_to_2.sql").is_file()
