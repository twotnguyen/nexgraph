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
    assert conn.execute("PRAGMA user_version").fetchone()[0] == GRAPH_SCHEMA_VERSION
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
    assert conn.execute("PRAGMA user_version").fetchone()[0] == GRAPH_SCHEMA_VERSION
    assert conn.execute("SELECT count(*) FROM kieu_bien").fetchone()[0] == 0
    assert conn.execute("SELECT count(*) FROM moc_tep").fetchone()[0] == 0
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(lan_lap_chi_muc)")}
    assert {"thu_muc_con", "mau_bo_qua", "gom_tai_lieu", "gom_media"} <= cols
    assert conn.execute("SELECT gom_tai_lieu, gom_media FROM lan_lap_chi_muc").fetchone()[:] == (0, 0)
    assert conn.execute("SELECT count(*) FROM nut").fetchone()[0] == 2
    assert conn.execute("SELECT count(*) FROM canh").fetchone()[0] == 1
    assert conn.execute("SELECT phien_ban_schema FROM du_an").fetchone()[0] == GRAPH_SCHEMA_VERSION
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    conn.close()
    open_graph_db(p).close()  # lần hai không làm gì


def test_read_only_v1_is_rejected(tmp_path):
    p = tmp_path / "graph.db"
    _make_v1(p)
    with pytest.raises(SchemaOutdatedError):
        open_graph_db(p, read_only=True)


def test_new_database_is_current(tmp_path):
    conn = open_graph_db(tmp_path / "graph.db")
    assert conn.execute("PRAGMA user_version").fetchone()[0] == GRAPH_SCHEMA_VERSION
    tables = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"kieu_bien", "moc_tep", "luong", "buoc_luong"} <= tables

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
        for t in ("kieu_bien", "moc_tep", "lan_lap_chi_muc", "luong", "buoc_luong"):
            out[t] = [tuple(r)[1:] for r in c.execute(f"PRAGMA table_info({t})")]
        return out

    assert shape(a) == shape(b)


def test_schema_sql_packaged():
    assert "kieu_bien" in load_sql("graph")
    from importlib import resources

    assert resources.files("nexgraph_engine.schema").joinpath("migrate_1_to_2.sql").is_file()
    assert resources.files("nexgraph_engine.schema").joinpath("migrate_4_to_5.sql").is_file()


def test_v5_has_flow_tables_and_upgrades_v4(tmp_path):
    conn = open_graph_db(tmp_path / "g.db")
    cols = {r[1] for r in conn.execute("PRAGMA table_info(buoc_luong)")}
    assert cols == {"ma_luong", "thu_tu", "ma_nut", "do_sau", "ma_nut_goi", "dong_bang_chung"}
    assert conn.execute("PRAGMA user_version").fetchone()[0] == GRAPH_SCHEMA_VERSION
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO luong (ma_nut_vao, ten, loai_vao, so_buoc, so_tep, do_sau, diem) VALUES (1,'x','khac',2,1,1,0.5)")

    # Kiểm tra nâng cấp từ v4 có sẵn dữ liệu nút
    v4_path = tmp_path / "v4.db"
    c4 = sqlite3.connect(v4_path)
    c4.executescript(_sql_v6())
    c4.execute("DROP TABLE buoc_luong")
    c4.execute("DROP TABLE luong")
    c4.execute("UPDATE du_an SET phien_ban_schema = 4")
    c4.execute("PRAGMA user_version = 4")
    c4.execute("INSERT INTO nut (id_nut, loai_nut, nhan, ten_day_du, nguon_goc) VALUES ('.#repository', 'repository', 'r', 'r', 'ast')")
    c4.commit()
    c4.close()

    c5 = open_graph_db(v4_path)
    assert c5.execute("PRAGMA user_version").fetchone()[0] == GRAPH_SCHEMA_VERSION
    assert c5.execute("SELECT nhan FROM nut WHERE id_nut = '.#repository'").fetchone()[0] == "r"
    c5_tables = {r["name"] for r in c5.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"luong", "buoc_luong"} <= c5_tables
    c5.close()


def _schema_rows(conn):
    return sorted(tuple(r) for r in conn.execute("select type, name, tbl_name, sql from sqlite_master"))


@pytest.mark.parametrize("name, opener", [("graph", "open_graph_db"), ("app", "open_app_db")])
def test_new_db_schema_matches_plain_script(tmp_path, name, opener):
    import sqlite3
    from nexgraph_engine.schema import db
    ref = sqlite3.connect(tmp_path / "ref.db")
    ref.executescript(db.load_sql(name))
    conn = getattr(db, opener)(tmp_path / "new.db")
    assert _schema_rows(conn) == _schema_rows(ref)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == ref.execute("PRAGMA user_version").fetchone()[0]


def test_failed_schema_rolls_back_and_releases_lock(tmp_path, monkeypatch):
    import sqlite3
    from nexgraph_engine.schema import db
    good = db.load_sql
    monkeypatch.setattr(db, "load_sql", lambda name: good(name) + "\nCREATE TABLE nut (x);\n")
    with pytest.raises(sqlite3.OperationalError):
        db.open_graph_db(tmp_path / "g.db")
    monkeypatch.setattr(db, "load_sql", good)
    conn = db.open_graph_db(tmp_path / "g.db")  # không bị "database is locked", schema không dở dang
    assert conn.execute("PRAGMA user_version").fetchone()[0] == db.GRAPH_SCHEMA_VERSION


def test_concurrent_first_open_creates_schema_once(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from nexgraph_engine.schema.db import APP_SCHEMA_VERSION, open_app_db
    path = tmp_path / "app.db"
    with ThreadPoolExecutor(8) as pool:
        versions = list(pool.map(lambda _: open_app_db(path).execute("PRAGMA user_version").fetchone()[0], range(8)))
    assert versions == [APP_SCHEMA_VERSION] * 8


def _sql_v6() -> str:
    """graph.sql cắt trước mốc v7, để dựng CSDL đời cũ cho test nâng cấp."""
    sql = load_sql("graph")
    return sql[:sql.index("-- v7")].replace("PRAGMA user_version = 7;", "PRAGMA user_version = 6;")


NEW_KINDS = ", 'type', 'variable', 'table', 'resource', 'config_key'"


def _seed_file(c) -> None:
    c.execute("INSERT INTO du_an (ma_du_an, ten, co_git, phien_ban_schema, tao_luc) VALUES (?, 'p', 0, 5, 0)", ("0" * 36,))
    c.execute("INSERT INTO lan_lap_chi_muc (ma_du_an, loai, trang_thai, bat_dau_luc) VALUES (?, 'day_du', 'cho', 0)", ("0" * 36,))
    c.execute("INSERT INTO tep (ma_lan, duong_dan_tuong_doi, ngon_ngu, ma_bam, kich_thuoc, mtime)"
              " VALUES (1, 'a.rs', 'rust', ?, 3, 0)", ("a" * 64,))


def _add_node(c, nid: str, kind: str) -> None:
    c.execute("INSERT INTO nut (id_nut, loai_nut, nhan, ten_day_du, ma_tep, dong_bat_dau, dong_ket_thuc, nguon_goc)"
              " VALUES (?, ?, 'x', 'x', 1, 1, 2, 'ast')", (nid, kind))


def test_v6_node_kinds_and_upgrades_v5(tmp_path):
    # W2: loại nút cho ngôn ngữ mới; nâng v5 → v6 nới CHECK mà giữ dữ liệu và khoá ngoại.
    fresh = open_graph_db(tmp_path / "g.db")
    assert fresh.execute("PRAGMA user_version").fetchone()[0] == GRAPH_SCHEMA_VERSION
    _seed_file(fresh)
    _add_node(fresh, "a.rs::A#variable", "variable")

    v5_path = tmp_path / "v5.db"
    c5 = sqlite3.connect(v5_path)
    sql = _sql_v6()
    assert NEW_KINDS in sql
    c5.executescript(sql.replace(NEW_KINDS, "").replace("PRAGMA user_version = 6;", "PRAGMA user_version = 5;"))
    _seed_file(c5)
    _add_node(c5, "a.rs::f#function", "function")
    with pytest.raises(sqlite3.IntegrityError):
        _add_node(c5, "a.rs::t#table", "table")
    c5.commit()
    c5.close()

    c6 = open_graph_db(v5_path)
    assert c6.execute("PRAGMA user_version").fetchone()[0] == GRAPH_SCHEMA_VERSION
    assert c6.execute("SELECT phien_ban_schema FROM du_an").fetchone()[0] == GRAPH_SCHEMA_VERSION
    _add_node(c6, "a.rs::t#table", "table")
    assert c6.execute("SELECT count(*) FROM nut").fetchone()[0] == 2
    assert c6.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert c6.execute("PRAGMA foreign_key_check").fetchall() == []
    nut_sql = lambda c: c.execute("SELECT sql FROM sqlite_master WHERE name = 'nut'").fetchone()[0]
    assert nut_sql(c6) == nut_sql(fresh)


def test_v5_run_table_gets_config_column(tmp_path):
    path = tmp_path / "v5.db"
    c5 = sqlite3.connect(path)
    sql = _sql_v6().replace(NEW_KINDS, "").replace("PRAGMA user_version = 6;", "PRAGMA user_version = 5;")
    line = next(l for l in sql.splitlines() if l.strip().startswith("gom_cau_hinh"))
    c5.executescript(sql.replace(line + "\n", ""))
    c5.close()
    cols = [r[1] for r in open_graph_db(path).execute("PRAGMA table_info(lan_lap_chi_muc)")]
    assert cols[-1] == "gom_cau_hinh"


V7_TABLES = {"nhan_cum", "ky_uc", "bo_nho_dem_ngu_nghia"}


def test_v7_semantic_and_memory_tables(tmp_path):
    # W9/W10: nhãn cụm do AI đặt, ký ức (đánh giá câu trả lời + memory tay), cache ngữ nghĩa.
    c = open_graph_db(tmp_path / "g.db")
    assert c.execute("PRAGMA user_version").fetchone()[0] == GRAPH_SCHEMA_VERSION == 7
    tables = {r["name"] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert V7_TABLES <= tables
    c.execute("INSERT INTO nhan_cum VALUES ('3', 'Thanh toán', ?, 'llm', 0)", ("a" * 64,))
    c.execute("INSERT INTO ky_uc (loai, noi_dung, node_ids_json, ket_qua, tao_luc, nguon)"
              " VALUES ('danh_gia', 'q/a', '[\"a.py::f#function\"]', 'huu_ich', 0, 'nguoi_dung')")
    c.execute("INSERT INTO ky_uc (loai, noi_dung, tao_luc, nguon) VALUES ('lesson', 'Đừng sửa cache', 0, 'mcp')")
    c.execute("INSERT INTO bo_nho_dem_ngu_nghia VALUES (?, '{}', 0)", ("b" * 64,))
    for bad in (
        "INSERT INTO nhan_cum VALUES ('4', '  ', '" + "a" * 64 + "', 'llm', 0)",
        "INSERT INTO ky_uc (loai, noi_dung, tao_luc, nguon) VALUES ('danh_gia', 'x', 0, 'nguoi_dung')",  # thiếu ket_qua
        "INSERT INTO ky_uc (loai, noi_dung, ket_qua, tao_luc, nguon) VALUES ('lesson', 'x', 'huu_ich', 0, 'mcp')",
        "INSERT INTO ky_uc (loai, noi_dung, node_ids_json, tao_luc, nguon) VALUES ('lesson', 'x', '{', 0, 'mcp')",
        "INSERT INTO bo_nho_dem_ngu_nghia VALUES ('ngan', '{}', 0)",
    ):
        with pytest.raises(sqlite3.IntegrityError):
            c.execute(bad)


def test_v6_upgrades_to_v7_keeping_data(tmp_path):
    path = tmp_path / "v6.db"
    c6 = sqlite3.connect(path)
    sql = load_sql("graph")
    cut = sql.index("-- v7")
    c6.executescript(sql[:cut].replace("PRAGMA user_version = 7;", "PRAGMA user_version = 6;"))
    _seed_file(c6)
    _add_node(c6, "a.rs::f#function", "function")
    c6.commit()
    c6.close()
    c7 = open_graph_db(path)
    assert c7.execute("PRAGMA user_version").fetchone()[0] == 7
    assert c7.execute("SELECT phien_ban_schema FROM du_an").fetchone()[0] == 7
    assert c7.execute("SELECT count(*) FROM nut").fetchone()[0] == 1
    ref = open_graph_db(tmp_path / "fresh.db")
    sql_of = lambda c: sorted(r[0] for r in c.execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL"))
    assert sql_of(c7) == sql_of(ref)


def test_app_v3_ai_per_project_and_upgrades_v2(tmp_path):
    from nexgraph_engine.schema.db import APP_SCHEMA_VERSION
    c = open_app_db(tmp_path / "app.db")
    assert c.execute("PRAGMA user_version").fetchone()[0] == APP_SCHEMA_VERSION == 3
    pid = "1" * 36
    c.execute("INSERT INTO du_an_da_mo VALUES (?, '/p', 'p', 'thu_muc_app', 0, 0)", (pid,))
    c.execute("INSERT INTO ai_theo_du_an (ma_du_an, bat, kieu_ket_noi, ten_model) VALUES (?, 1, 'direct', 'gpt')", (pid,))
    with pytest.raises(sqlite3.IntegrityError):
        c.execute("UPDATE ai_theo_du_an SET kieu_ket_noi = 'khac'")
    assert c.execute("SELECT bat FROM ai_theo_du_an").fetchone()[0] == 1
    c.execute("DELETE FROM du_an_da_mo")
    assert c.execute("SELECT count(*) FROM ai_theo_du_an").fetchone()[0] == 0  # xoá dự án thì xoá cấu hình AI

    path = tmp_path / "v2.db"
    c2 = sqlite3.connect(path)
    sql = load_sql("app")
    c2.executescript(sql[:sql.index("-- v3")].replace("PRAGMA user_version = 3;", "PRAGMA user_version = 2;"))
    c2.execute("INSERT INTO du_an_da_mo VALUES (?, '/q', 'q', 'thu_muc_app', 0, 0)", (pid,))
    c2.commit()
    c2.close()
    c3 = open_app_db(path)
    assert c3.execute("PRAGMA user_version").fetchone()[0] == 3
    assert c3.execute("SELECT count(*) FROM du_an_da_mo").fetchone()[0] == 1
    assert c3.execute("SELECT count(*) FROM ai_theo_du_an").fetchone()[0] == 0


def test_global_db_created_at_v1_and_matches_script(tmp_path):
    from nexgraph_engine.schema.db import GLOBAL_SCHEMA_VERSION, open_global_db
    conn = open_global_db(tmp_path / "global.db")
    assert conn.execute("PRAGMA user_version").fetchone()[0] == GLOBAL_SCHEMA_VERSION == 1
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    ref = sqlite3.connect(tmp_path / "ref.db")
    ref.executescript(load_sql("global"))
    assert _schema_rows(conn) == _schema_rows(ref)
    conn.close()
    open_global_db(tmp_path / "global.db").close()  # mở lại không tạo lại schema


def test_global_db_newer_version_rejected(tmp_path):
    from nexgraph_engine.schema.db import GLOBAL_SCHEMA_VERSION, open_global_db
    conn = open_global_db(tmp_path / "global.db")
    conn.execute(f"PRAGMA user_version = {GLOBAL_SCHEMA_VERSION + 1}")
    conn.close()
    with pytest.raises(SchemaVersionError):
        open_global_db(tmp_path / "global.db")
