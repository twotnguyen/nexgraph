import json
import shutil
import time

from nexgraph_engine.pipeline.legacy_refresh import refresh_project
from nexgraph_engine.analysis.query.paths import impact_of
from nexgraph_engine.core.schema.enums import EdgeType

from test_docs_extract import FIX, _make_office, docs_root, edges, run_index  # noqa: F401  (fixture dùng chung)

LOGIN = "lib/auth.py::AuthService.login#method"
HELPER = "lib/auth.py::helper#function"


def test_documents_edge_to_method(docs_root, tmp_path):
    store = run_index(docs_root, tmp_path / "g.db", include_docs=True)
    assert edges(store, EdgeType.DOCUMENTS)[("README.md::Docs app#document", LOGIN)] == 0.8


def test_bare_mention_unique_function(docs_root, tmp_path):
    store = run_index(docs_root, tmp_path / "g.db", include_docs=True)
    assert edges(store, EdgeType.DOCUMENTS)[("README.md::Cài đặt#document", HELPER)] == 0.5


def test_ambiguous_mention_no_edge(docs_root, tmp_path):
    (docs_root / "lib" / "other.py").write_text("def helper(x):\n    return x\n")
    store = run_index(docs_root, tmp_path / "g.db", include_docs=True)
    assert not [k for k in edges(store, EdgeType.DOCUMENTS) if k[1].endswith("::helper#function")]


def test_short_name_ignored(docs_root, tmp_path):
    (docs_root / "lib" / "ids.py").write_text("def id(x):\n    return x\n")
    store = run_index(docs_root, tmp_path / "g.db", include_docs=True)
    assert not [k for k in edges(store, EdgeType.DOCUMENTS) if k[1] == "lib/ids.py::id#function"]


def test_impact_ignores_documents(docs_root, tmp_path):
    store = run_index(docs_root, tmp_path / "g.db", include_docs=True)
    assert edges(store, EdgeType.DOCUMENTS)
    assert "#document" not in json.dumps(impact_of(store, LOGIN), ensure_ascii=False)


def test_search_finds_heading(api, docs_root):
    pid = api.open(docs_root)["project_id"]
    r = api.post(f"/v1/projects/{pid}/index", json={"include_docs": True})
    for _ in range(300):
        if api.get(f"/v1/jobs/{r.json()['job_id']}").json()["state"] in ("done", "error"):
            break
        time.sleep(0.05)
    hits = api.get(f"/v1/projects/{pid}/search", params={"q": "Cách dùng"}).json()
    assert any(h["node"]["kind"] == "document" for h in hits)


def test_code_endpoint_converts_docx(api, docs_root):
    _make_office(docs_root)
    pid = api.open(docs_root)["project_id"]
    r = api.post(f"/v1/projects/{pid}/index", json={"include_docs": True})
    for _ in range(300):
        if api.get(f"/v1/jobs/{r.json()['job_id']}").json()["state"] in ("done", "error"):
            break
        time.sleep(0.05)
    body = api.get(f"/v1/projects/{pid}/code", params={"file": "guide.docx"}).json()
    assert "Hướng dẫn" in body["text"] and "PK" not in body["text"][:4]
    assert body["language"] == "docx"


def test_refresh_updates_headings(docs_root, tmp_path):
    store = run_index(docs_root, tmp_path / "g.db", include_docs=True)
    time.sleep(1.1)
    readme = docs_root / "README.md"
    readme.write_text(readme.read_text(encoding="utf-8").replace("## Cách dùng", "## Triển khai"), encoding="utf-8")
    refresh_project(store, docs_root)
    ids = {n.id for n in store.all_nodes()}
    assert "README.md::Triển khai#document" in ids and "README.md::Cách dùng#document" not in ids
    assert ("README.md::Docs app#document", LOGIN) in edges(store, EdgeType.DOCUMENTS)
