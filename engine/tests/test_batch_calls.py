"""W2 Task 4b: lời gọi liên tệp của ngôn ngữ mức chung lấy từ extract() cả lô (Ruling Task 1 trong ledger W2)."""
import threading
from pathlib import Path

import pytest

from nexgraph_engine.pipeline.legacy_indexer import Indexer
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.store.graph_store import GraphStore

POLYGLOT = Path(__file__).parent / "fixtures" / "polyglot"


@pytest.fixture(scope="module")
def calls(tmp_path_factory):
    store = GraphStore(open_graph_db(tmp_path_factory.mktemp("g") / "g.db"))
    store.init_project("polyglot", has_git=False)
    assert Indexer(store, POLYGLOT, on_progress=lambda e: None, cancel=threading.Event()).run().state == "hoan_tat"
    rows = store.conn.execute("SELECT a.id_nut, b.id_nut FROM canh c JOIN nut a ON a.ma_nut = c.ma_nut_nguon"
                              " JOIN nut b ON b.ma_nut = c.ma_nut_dich WHERE c.loai_canh = 'CALLS'").fetchall()
    return [(s, t) for s, t in rows if s.split("::")[0] != t.split("::")[0]]


def _helper(node_id: str) -> bool:
    return node_id.split("::")[-1].split("#")[0].split(".")[-1].lower() == "helper"


@pytest.mark.parametrize("lang", ["go", "rust", "java", "kotlin", "ruby", "php", "swift", "cpp"])
def test_cross_file_call_comes_from_the_calling_function(calls, lang):
    mine = [(s, t) for s, t in calls if s.startswith(lang + "/") and t.startswith(lang + "/") and _helper(t)]
    assert any(not s.endswith("#file") for s, _ in mine), mine
    assert not any(s.endswith("#file") for s, _ in mine), mine  # không gán lời gọi cho cả tệp


def test_refresh_keeps_cross_file_calls(tmp_path):
    import shutil

    from nexgraph_engine.pipeline.legacy_refresh import refresh_project

    root = tmp_path / "rust"
    shutil.copytree(POLYGLOT / "rust", root)
    store = GraphStore(open_graph_db(tmp_path / "g.db"))
    store.init_project("rust", has_git=False)
    Indexer(store, root, on_progress=lambda e: None, cancel=threading.Event()).run()
    (root / "main.rs").write_text((root / "main.rs").read_text() + "\nfn other() {}\n")
    refresh_project(store, root)
    rows = store.conn.execute("SELECT a.id_nut, b.id_nut FROM canh c JOIN nut a ON a.ma_nut = c.ma_nut_nguon"
                              " JOIN nut b ON b.ma_nut = c.ma_nut_dich WHERE c.loai_canh = 'CALLS'").fetchall()
    assert ("main.rs::main#function", "util.rs::helper#function") in [tuple(r) for r in rows]
