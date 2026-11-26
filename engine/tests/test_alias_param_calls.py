"""MIN-41b N1: tham số trùng tên bí danh mô-đun nhưng nhận chính bí danh ở lời gọi thì không bị coi là che.

`export/run.py::_write(..., gx, ...)` nhận `graphify.export` từ `export_graph` và gọi `gx.to_*()`;
trước #44 các cạnh CALLS đúng này bị bỏ (review-41 N1). Test này khoá hồi quy cho quy tắc
`_alias_passed_params` của resolver.
"""
import threading

import pytest

from nexgraph_engine.pipeline.legacy_indexer import Indexer
from nexgraph_engine.core.schema.db import open_graph_db
from nexgraph_engine.storage.store.graph_store import GraphStore

FILES = {
    "gxlib/__init__.py": "",
    "gxlib/export.py": "".join(
        f"def to_{name}(target):\n    return target\n\n\n"
        for name in ("canvas", "cypher", "graphml", "obsidian", "svg")
    ),
    "app/__init__.py": "",
    "app/run.py": (
        "def _write(store, fmt, target, project_name, gx, lang='en'):\n"
        "    gx.to_canvas(target)\n"
        "    gx.to_cypher(target)\n"
        "    gx.to_graphml(target)\n"
        "    gx.to_obsidian(target)\n"
        "    gx.to_svg(target)\n\n\n"
        "def export_graph(store, fmt, target):\n"
        "    from gxlib import export as gx\n"
        "    _write(store, fmt, target, 'p', gx)\n"
    ),
}

WRITE = "app/run.py::_write#function"


@pytest.fixture(scope="module")
def calls(tmp_path_factory) -> set[tuple[str, str]]:
    root = tmp_path_factory.mktemp("alias-param")
    for rel, text in FILES.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    store = GraphStore(open_graph_db(tmp_path_factory.mktemp("db") / "g.db"))
    store.init_project("p", has_git=False)
    assert Indexer(store, root, on_progress=lambda e: None, cancel=threading.Event()).run().state == "hoan_tat"
    return {(row[0], row[1]) for row in store.conn.execute(
        "SELECT a.id_nut, b.id_nut FROM canh c JOIN nut a ON a.ma_nut = c.ma_nut_nguon"
        " JOIN nut b ON b.ma_nut = c.ma_nut_dich WHERE c.loai_canh = 'CALLS'")}


@pytest.mark.parametrize("name", ["canvas", "cypher", "graphml", "obsidian", "svg"])
def test_alias_passed_as_parameter_keeps_module_calls(calls, name):
    assert (WRITE, f"gxlib/export.py::to_{name}#function") in calls


def test_alias_shadowed_by_local_variable_still_makes_no_edge(tmp_path):
    """Mặt còn lại của N1: biến cục bộ che bí danh thì KHÔNG được tạo cạnh (M1 review-34)."""
    root = tmp_path / "shadow"
    for rel, text in {
        "app/__init__.py": "",
        "app/models.py": "class User:\n    def name(self):\n        return ''\n",
        "tests/__init__.py": "",
        "tests/test_shadow.py": (
            "import app.models as models\n\n\n"
            "class Fake:\n"
            "    def User(self):\n"
            "        return None\n\n\n"
            "def test_shadowed_module_name():\n"
            "    models = Fake()\n"
            "    models.User()\n"
        ),
    }.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    store = GraphStore(open_graph_db(tmp_path / "g.db"))
    store.init_project("p", has_git=False)
    assert Indexer(store, root, on_progress=lambda e: None, cancel=threading.Event()).run().state == "hoan_tat"
    edges = {(row[0], row[1], row[2]) for row in store.conn.execute(
        "SELECT a.id_nut, c.loai_canh, b.id_nut FROM canh c JOIN nut a ON a.ma_nut = c.ma_nut_nguon"
        " JOIN nut b ON b.ma_nut = c.ma_nut_dich WHERE c.loai_canh IN ('CALLS', 'TESTED_BY')")}
    assert not [e for e in edges if e[2] == "app/models.py::User#class"]
    assert not [e for e in edges if e[1] == "TESTED_BY"]
