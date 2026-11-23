import sqlite3
import subprocess
import sys
import time
from contextlib import closing

import pytest

from nexgraph_engine.schema.db import GRAPH_SCHEMA_VERSION, open_graph_db
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.publication import backup_graph, graph_writer, publish_stage, stage_graph

PROJECT_ID = "00000000-0000-0000-0000-000000000001"


@pytest.fixture
def graph(tmp_path):
    path = tmp_path / "graph.db"
    with closing(open_graph_db(path)) as conn:
        GraphStore(conn).init_project("active", False, PROJECT_ID)
    return path


def test_publish_preserves_path_and_existing_read_snapshot(graph):
    with closing(sqlite3.connect(f"{graph.as_uri()}?mode=ro", uri=True)) as reader:
        reader.execute("BEGIN")
        assert reader.execute("SELECT ten FROM du_an").fetchone()[0] == "active"
        with stage_graph(graph) as (live_path, stage):
            stage.execute("UPDATE du_an SET ten = 'next'")
            stage.commit()
            assert live_path == graph.resolve()
            with closing(open_graph_db(live_path)) as live:
                assert live.execute("SELECT ten FROM du_an").fetchone()[0] == "active"
                backup_graph(stage, live)
                assert live.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert reader.execute("SELECT ten FROM du_an").fetchone()[0] == "active"
    with closing(open_graph_db(graph, read_only=True)) as reopened:
        assert tuple(reopened.execute("SELECT ma_du_an, ten FROM du_an").fetchone()) == (PROJECT_ID, "next")
    assert not graph.with_name(".graph.db.index-stage").exists()


def test_publication_timeout_leaves_live_snapshot_untouched(graph):
    with stage_graph(graph) as (live_path, stage), closing(open_graph_db(live_path)) as live:
        stage.execute("UPDATE du_an SET ten = 'next'")
        stage.commit()
        with closing(open_graph_db(graph)) as other:
            other.execute("BEGIN IMMEDIATE")
            started = time.monotonic()
            with pytest.raises(sqlite3.OperationalError, match="Quá thời gian"):
                backup_graph(stage, live, timeout=0.1)
            assert time.monotonic() - started < 2
            other.rollback()
        assert live.execute("SELECT ten FROM du_an").fetchone()[0] == "active"


def test_old_schema_migrates_only_in_staging(graph):
    with closing(sqlite3.connect(graph)) as live:
        live.executescript("DROP TABLE buoc_luong; DROP TABLE luong; DROP TABLE nhan_cum; DROP TABLE ky_uc;"
                           " DROP TABLE bo_nho_dem_ngu_nghia; PRAGMA user_version = 4;")
        with stage_graph(graph) as (_live_path, stage):
            assert stage.execute("PRAGMA user_version").fetchone()[0] == GRAPH_SCHEMA_VERSION
            assert stage.execute("SELECT count(*) FROM luong").fetchone()[0] == 0
            assert stage.execute("SELECT ten FROM du_an").fetchone()[0] == "active"
        assert live.execute("PRAGMA user_version").fetchone()[0] == 4


def test_writer_lease_protects_existing_stage_across_processes(graph):
    scratch = graph.with_name(".graph.db.index-stage")
    scratch.write_text("abandoned stage")
    script = """
import sys
from pathlib import Path
from nexgraph_engine.store.publication import GraphWriteBusy, stage_graph

try:
    with stage_graph(Path(sys.argv[1])):
        pass
except GraphWriteBusy:
    sys.exit(0)
sys.exit(1)
"""
    with graph_writer(graph):
        probe = subprocess.run([sys.executable, "-c", script, str(graph)], stdin=subprocess.DEVNULL,
                               capture_output=True, text=True, timeout=8)
        assert probe.returncode == 0, probe.stderr
        assert scratch.read_text() == "abandoned stage"
    with stage_graph(graph) as (_live_path, stage):
        assert stage.execute("SELECT ten FROM du_an").fetchone()[0] == "active"
    assert not scratch.exists()


def test_publish_truncates_wal_of_live_graph(graph):
    """F7: publish ghi cả CSDL vào WAL của bản thật — xong phải cắt WAL, không giữ thêm một bản CSDL trên đĩa."""
    wal = graph.with_name(graph.name + "-wal")
    with closing(sqlite3.connect(graph)) as bystander:  # còn kết nối mở nên WAL không tự bị xoá khi publish đóng
        bystander.execute("SELECT count(*) FROM sqlite_master").fetchone()
        with stage_graph(graph) as (live_path, stage):
            stage.execute("UPDATE du_an SET ten = 'next'")
            stage.commit()
            publish_stage(stage, live_path)
        assert wal.exists() and wal.stat().st_size == 0
