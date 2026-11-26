"""Hồi quy cho các phát hiện của review cuối W2."""
import shutil
import threading
import time
from pathlib import Path

from nexgraph_engine.pipeline.legacy_indexer import Indexer, index_workers
from nexgraph_engine.core.schema.db import open_graph_db
from nexgraph_engine.storage.store.graph_store import GraphStore

POLYGLOT = Path(__file__).parents[1] / "fixtures" / "polyglot"


def _index(root: Path, db: Path) -> GraphStore:
    store = GraphStore(open_graph_db(db))
    store.init_project(root.name, has_git=False)
    assert Indexer(store, root, on_progress=lambda e: None, cancel=threading.Event()).run().state == "hoan_tat"
    return store


def _edges(store, type_):
    return [tuple(r) for r in store.conn.execute(
        "SELECT a.id_nut, b.id_nut FROM canh c JOIN nut a ON a.ma_nut = c.ma_nut_nguon"
        " JOIN nut b ON b.ma_nut = c.ma_nut_dich WHERE c.loai_canh = ?", (type_,))]


def test_batch_and_resolver_do_not_duplicate_calls(tmp_path):
    store = _index(POLYGLOT, tmp_path / "g.db")
    calls = _edges(store, "CALLS")
    assert calls.count(("go/main.go::main#function", "go/util.go::Helper#function")) == 1


def test_heritage_outside_type_body_is_kept(tmp_path):
    (tmp_path / "a.rs").write_text("pub trait Marker {}\n")
    (tmp_path / "b.rs").write_text("pub struct P;\n\npub trait Local {}\n\nimpl Local for P {}\nimpl Marker for P {}\n")
    store = _index(tmp_path, tmp_path / "g.db")
    impl = _edges(store, "IMPLEMENTS")
    assert ("b.rs::P#class", "b.rs::Local#type") in impl  # RB22: cạnh ngoài khoảng dòng của P
    assert ("b.rs::P#class", "a.rs::Marker#type") in impl  # resolver nối tới nút loại `type`
    errs = store.conn.execute("SELECT count(*) FROM loi_phan_tich").fetchone()[0]
    assert errs == 0


def test_enum_members_are_qualified_by_parent(tmp_path):
    from nexgraph_engine.indexing.index.generic import extract_generic
    (tmp_path / "e.rs").write_text("enum Status { Ok, Fail }\nenum Outcome { Ok }\n")
    ids = {n.id for n in extract_generic(tmp_path, "e.rs", "rust", is_test=False).nodes}
    assert not any("@" in i for i in ids), ids


def test_requested_workers_respect_media_and_small_projects():
    assert index_workers(5000, include_media=True, requested=8) == 1
    assert index_workers(10, include_media=False, requested=8) == 1
    assert index_workers(5000, include_media=False, requested=3) == 3


def test_refresh_skips_batch_when_no_generic_file_changed(tmp_path, monkeypatch):
    from nexgraph_engine.indexing.index import batch_calls
    from nexgraph_engine.pipeline.legacy_refresh import refresh_project
    root = tmp_path / "p"
    shutil.copytree(POLYGLOT / "rust", root)
    (root / "x.py").write_text("def f():\n    return 1\n")
    store = _index(root, tmp_path / "g.db")
    calls = []
    real = batch_calls.batch_cross_file_calls
    monkeypatch.setattr("nexgraph_engine.pipeline.legacy_indexer.batch_cross_file_calls",
                        lambda *a, **k: calls.append(1) or real(*a, **k))
    time.sleep(1.1)
    (root / "x.py").write_text("def f():\n    return 2\n")
    refresh_project(store, root)
    assert calls == []
    (root / "main.rs").write_text((root / "main.rs").read_text() + "\nfn more() {}\n")
    refresh_project(store, root)
    assert calls == [1]


def test_config_files_are_not_relevant_changes():
    from nexgraph_engine.analysis.changes.gitdiff import _relevant
    assert not _relevant("pubspec.yaml") and not _relevant("package.json") and not _relevant(".github/workflows/ci.yml")
    assert _relevant("lib/a.dart") and _relevant("src/a.rs")
