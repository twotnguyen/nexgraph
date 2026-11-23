"""Lời gọi Python qua thuộc tính của `self` (`self.x.method()`) thành cạnh CALLS.

Chỉ nối khi kiểu của `self.x` xác định tĩnh trong cùng lớp: gán `self.x = ClassName(...)` hoặc chú thích
`self.x: ClassName` / thuộc tính lớp `x: ClassName`. Mơ hồ hoặc không resolve được lớp → không có cạnh.
"""
import threading
from pathlib import Path

import pytest

from nexgraph_engine.index.indexer import Indexer
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.store.graph_store import GraphStore

FILES = {
    "app/__init__.py": "",
    "app/models.py": (
        "class Repo:\n"
        "    def save(self):\n"
        "        return 1\n\n\n"
        "class Other:\n"
        "    def save(self):\n"
        "        return 2\n"
    ),
    "app/service.py": (
        "from app.models import Repo, Other\n\n\n"
        "class Assigned:\n"
        "    def __init__(self):\n"
        "        self.repo = Repo()\n\n"
        "    def run(self):\n"
        "        self.repo.save()\n\n\n"
        "class AnnotatedSelf:\n"
        "    def __init__(self):\n"
        "        self.repo: Repo = Repo()\n\n"
        "    def run(self):\n"
        "        self.repo.save()\n\n\n"
        "class AnnotatedParam:\n"
        "    def __init__(self, repo: Repo):\n"
        "        self.repo = repo\n\n"
        "    def run(self):\n"
        "        self.repo.save()\n\n\n"
        "class ClassField:\n"
        "    repo: Repo\n\n"
        "    def run(self):\n"
        "        self.repo.save()\n\n\n"
        "class Ambiguous:\n"
        "    def __init__(self):\n"
        "        self.repo = Repo()\n\n"
        "    def reset(self):\n"
        "        self.repo = Other()\n\n"
        "    def run(self):\n"
        "        self.repo.save()\n\n\n"
        "class Unknown:\n"
        "    def __init__(self):\n"
        "        self.repo = build()\n\n"
        "    def run(self):\n"
        "        self.repo.save()\n"
    ),
}

SAVE = "app/models.py::Repo.save#method"


@pytest.fixture(scope="module")
def indexed(tmp_path_factory):
    root = tmp_path_factory.mktemp("py-self")
    for rel, text in FILES.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    store = GraphStore(open_graph_db(tmp_path_factory.mktemp("db") / "g.db"))
    store.init_project("p", has_git=False)
    assert Indexer(store, root, on_progress=lambda e: None, cancel=threading.Event()).run().state == "hoan_tat"
    calls = {(row[0], row[1]) for row in store.conn.execute(
        "SELECT a.id_nut, b.id_nut FROM canh c JOIN nut a ON a.ma_nut = c.ma_nut_nguon"
        " JOIN nut b ON b.ma_nut = c.ma_nut_dich WHERE c.loai_canh = 'CALLS'")}
    return calls


@pytest.mark.parametrize("owner", ["Assigned", "AnnotatedSelf", "AnnotatedParam", "ClassField"])
def test_self_attr_call_becomes_calls_edge(indexed, owner):
    assert (f"app/service.py::{owner}.run#method", SAVE) in indexed


@pytest.mark.parametrize("owner", ["Ambiguous", "Unknown"])
def test_ambiguous_or_unknown_self_attr_makes_no_edge(indexed, owner):
    got = {dst for src, dst in indexed
           if src.startswith(f"app/service.py::{owner}.") and dst.endswith("#method") and ".save" in dst}
    assert got == set()
