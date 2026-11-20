import threading
from pathlib import Path

import pytest

from nexgraph_engine.errors import ApiError
from nexgraph_engine.index.indexer import Indexer
from nexgraph_engine.query.section import section_json
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.store.graph_store import GraphStore

SECRET = "sk-abcdefghijklmnopqrstuvwx1234"
GUIDE = f"""# Intro

Xin chào.

## Setup

Đặt khoá:
api_key = "{SECRET}"
màu \x1b[31mđỏ\x1b[0m

## Use

Chạy app.
"""


def _project(tmp_path: Path) -> Path:
    root = tmp_path / "proj"
    (root / "docs").mkdir(parents=True)
    (root / "docs" / "guide.md").write_text(GUIDE, encoding="utf-8")
    (root / "guide.html").write_text("<html><body><h1>Top</h1><p>intro</p>\n\n\n<h2>Install</h2><p>run it</p></body></html>",
                                     encoding="utf-8")
    (root / "app.py").write_text("def main():\n    return 1\n", encoding="utf-8")
    return root


def _index(root: Path, db: Path) -> GraphStore:
    store = GraphStore(open_graph_db(db))
    store.init_project(root.name, has_git=False)
    result = Indexer(store, root, on_progress=lambda e: None, cancel=threading.Event(), include_docs=True).run()
    assert result.state == "hoan_tat"
    return store


def _doc(store: GraphStore, label: str, file: str = "docs/guide.md"):
    row = store.conn.execute("SELECT n.id_nut FROM nut n JOIN tep t ON t.ma_tep = n.ma_tep"
                             " WHERE n.loai_nut = 'document' AND n.nhan = ? AND t.duong_dan_tuong_doi = ?",
                             (label, file)).fetchone()
    assert row, label
    return store.get_node(row[0])


@pytest.fixture
def indexed(tmp_path):
    root = _project(tmp_path)
    store = _index(root, tmp_path / "g.db")
    yield root, store
    store.conn.close()


def test_section_returns_heading_body(indexed):
    root, store = indexed
    node = _doc(store, "Setup")
    out = section_json(store, root, node.id)
    assert out["text"].startswith("## Setup")
    assert "## Use" not in out["text"]
    assert out["start"] == node.line_start
    assert out["node"]["id"] == node.id and out["file"] == "docs/guide.md"


def test_section_redacts_secrets(indexed):
    root, store = indexed
    out = section_json(store, root, _doc(store, "Setup").id)
    assert SECRET not in out["text"]


def test_section_strips_control_chars_and_truncates(indexed):
    root, store = indexed
    node = _doc(store, "Setup")
    assert "\x1b" not in section_json(store, root, node.id)["text"]
    short = section_json(store, root, node.id, max_chars=10)
    assert short["truncated"] is True and len(short["text"]) == 10


def test_section_stale_after_edit(indexed):
    root, store = indexed
    node = _doc(store, "Setup")
    p = root / "docs" / "guide.md"
    p.write_text(p.read_text(encoding="utf-8") + "\nthêm\n", encoding="utf-8")
    out = section_json(store, root, node.id)
    assert out["stale"] is True and out["text"]


def test_section_deleted_file_404(indexed):
    root, store = indexed
    node = _doc(store, "Setup")
    (root / "docs" / "guide.md").unlink()
    with pytest.raises(ApiError) as exc:
        section_json(store, root, node.id)
    assert exc.value.status == 404


def test_section_rejects_code_node(indexed):
    root, store = indexed
    with pytest.raises(ApiError) as exc:
        section_json(store, root, "app.py::main#function")
    assert exc.value.code == "not_section"


def test_section_unknown_node_404(indexed):
    root, store = indexed
    with pytest.raises(ApiError) as exc:
        section_json(store, root, "nope#file")
    assert exc.value.status == 404


def test_section_html_lines_match_index(indexed):
    root, store = indexed
    out = section_json(store, root, _doc(store, "Install", "guide.html").id)
    assert "run it" in out["text"]


def test_section_route(api, tmp_path):
    root = _project(tmp_path)
    p = api.open(root)
    r = api.post(f"/v1/projects/{p['project_id']}/index", json={"include_docs": True})
    assert r.status_code == 202
    import time
    for _ in range(1500):
        if api.get(f"/v1/jobs/{r.json()['job_id']}").json()["state"] in ("done", "error"):
            break
        time.sleep(0.02)
    hits = api.get(f"/v1/projects/{p['project_id']}/search", params={"q": "Setup"}).json()
    nid = next(h["node"]["id"] for h in hits if h["node"]["kind"] == "document")
    got = api.get(f"/v1/projects/{p['project_id']}/section", params={"node": nid})
    assert got.status_code == 200, got.text
    assert got.json()["text"].startswith("## Setup")
    assert api.get(f"/v1/projects/{p['project_id']}/section", params={"node": "app.py::main#function"}).status_code == 400
