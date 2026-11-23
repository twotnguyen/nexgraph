"""`TESTED_BY` của Python khi test gọi lớp/hàm qua tên mô-đun: `import pkg.mod`, `import pkg.mod as m`,
`from pkg import mod` rồi `mod.Class(...)` / `mod.func(...)`."""
import threading
from pathlib import Path

import pytest

from nexgraph_engine.index.indexer import Indexer
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.store.graph_store import GraphStore

FILES = {
    "app/__init__.py": "",
    "app/models.py": (
        "class User:\n"
        "    def name(self):\n"
        "        return ''\n\n\n"
        "def load():\n"
        "    return User()\n"
    ),
    "tests/test_plain.py": "import app.models\n\n\ndef test_user():\n    app.models.User()\n",
    "tests/test_alias.py": "import app.models as models\n\n\ndef test_user():\n    models.User()\n",
    "tests/test_from.py": "from app import models\n\n\ndef test_user():\n    models.User()\n",
    "tests/test_func.py": "import app.models as m\n\n\ndef test_load():\n    m.load()\n",
    "tests/test_outside.py": "import requests\n\n\ndef test_outside():\n    requests.Session()\n",
}

USER = "app/models.py::User#class"
LOAD = "app/models.py::load#function"


@pytest.fixture(scope="module")
def tested_by(tmp_path_factory):
    root = tmp_path_factory.mktemp("py-module")
    for rel, text in FILES.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    store = GraphStore(open_graph_db(tmp_path_factory.mktemp("db") / "g.db"))
    store.init_project("p", has_git=False)
    assert Indexer(store, root, on_progress=lambda e: None, cancel=threading.Event()).run().state == "hoan_tat"
    return {(row[0], row[1]) for row in store.conn.execute(
        "SELECT a.id_nut, b.id_nut FROM canh c JOIN nut a ON a.ma_nut = c.ma_nut_nguon"
        " JOIN nut b ON b.ma_nut = c.ma_nut_dich WHERE c.loai_canh = 'TESTED_BY'")}


@pytest.mark.parametrize("test_file", ["tests/test_plain.py", "tests/test_alias.py", "tests/test_from.py"])
def test_module_class_call_creates_tested_by(tested_by, test_file):
    assert (USER, f"{test_file}::test_user#function") in tested_by


def test_module_function_call_creates_tested_by(tested_by):
    assert (LOAD, "tests/test_func.py::test_load#function") in tested_by


def test_module_outside_project_makes_no_edge(tested_by):
    assert not [pair for pair in tested_by if pair[1].startswith("tests/test_outside.py")]


SHADOW_FILES = {
    "app/__init__.py": "",
    "app/models.py": "class User:\n    def name(self):\n        return ''\n",
    "tests/test_shadow.py": (
        "import app.models as models\n\n\n"
        "class Fake:\n"
        "    def User(self):\n"
        "        return None\n\n\n"
        "def test_shadowed_module_name():\n"
        "    models = Fake()\n"
        "    models.User()\n"
    ),
    "tests/test_param_shadow.py": (
        "import app.models as models\n\n\n"
        "def test_param_shadow(models):\n"
        "    models.User()\n"
    ),
}


def test_shadowed_module_alias_creates_no_call_or_tested_by_edge(tmp_path):
    """Minor #34 M1: tên mô-đun bị biến cục bộ/tham số che thì không được suy ra CALLS/TESTED_BY."""
    root = tmp_path / "shadow"
    for rel, text in SHADOW_FILES.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    store = GraphStore(open_graph_db(tmp_path / "shadow.db"))
    store.init_project("p", has_git=False)
    assert Indexer(store, root, on_progress=lambda e: None, cancel=threading.Event()).run().state == "hoan_tat"
    shadow_tests = ("tests/test_shadow.py", "tests/test_param_shadow.py")
    calls = {(row[0], row[1]) for row in store.conn.execute(
        "SELECT a.id_nut, b.id_nut FROM canh c JOIN nut a ON a.ma_nut = c.ma_nut_nguon"
        " JOIN nut b ON b.ma_nut = c.ma_nut_dich WHERE c.loai_canh = 'CALLS'")}
    assert not [pair for pair in calls if pair[0].startswith(shadow_tests) and pair[1] == USER]
    tested = {(row[0], row[1]) for row in store.conn.execute(
        "SELECT a.id_nut, b.id_nut FROM canh c JOIN nut a ON a.ma_nut = c.ma_nut_nguon"
        " JOIN nut b ON b.ma_nut = c.ma_nut_dich WHERE c.loai_canh = 'TESTED_BY'")}
    assert not [pair for pair in tested if pair[1].startswith(shadow_tests) and pair[0] == USER]
