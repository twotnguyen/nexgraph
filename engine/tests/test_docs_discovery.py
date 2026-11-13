import time

from nexgraph_engine.index.discovery import discover
from nexgraph_engine.index.refresh import refresh_project


def _tree(root):
    (root / "a.py").write_text("x = 1\n")
    (root / "README.md").write_text("# Title\n")
    (root / "notes.txt").write_text("notes\n")
    (root / "guide.docx").write_bytes(b"PK")
    (root / "sheet.xlsx").write_bytes(b"PK")
    (root / "spec.pdf").write_bytes(b"%PDF-1.4\n")
    (root / "talk.mp3").write_bytes(b"ID3")
    (root / "tests").mkdir()
    (root / "tests" / "README.md").write_text("# T\n")


def test_docs_off_by_default(tmp_path):
    _tree(tmp_path)
    assert [f.rel_path for f in discover(tmp_path)] == ["a.py"]


def test_include_docs_languages(tmp_path):
    _tree(tmp_path)
    got = {f.rel_path: f for f in discover(tmp_path, include_docs=True)}
    assert {p: f.language for p, f in got.items() if p != "a.py"} == {
        "README.md": "markdown", "notes.txt": "text", "guide.docx": "docx", "sheet.xlsx": "xlsx",
        "spec.pdf": "pdf", "tests/README.md": "markdown"}
    assert got["tests/README.md"].is_test is False


def test_include_media_needs_flag(tmp_path):
    _tree(tmp_path)
    got = {f.rel_path: f.language for f in discover(tmp_path, include_docs=True, include_media=True)}
    assert got["talk.mp3"] == "media"


def test_large_doc_is_oversized(tmp_path):
    (tmp_path / "big.pdf").write_bytes(b"%PDF" + b"0" * 2000)
    [f] = discover(tmp_path, max_file_bytes=1000, include_docs=True)
    assert f.oversized is True


def test_doc_flags_persist_for_refresh(tmp_path, index_project, monkeypatch):
    (tmp_path / "a.py").write_text("x = 1\n")
    (tmp_path / "README.md").write_text("# Title\n")
    import nexgraph_engine.index.indexer as ix
    real = ix.Indexer.__init__
    flags = {"include_docs": True}
    monkeypatch.setattr(ix.Indexer, "__init__", lambda self, *a, **k: real(self, *a, **flags, **k))
    store, _, _ = index_project(tmp_path)
    assert store.last_doc_flags() == (True, False)
    assert store.file_record("README.md") is not None
    time.sleep(1.1)
    (tmp_path / "README.md").write_text("# Title 2\n")
    refresh_project(store, tmp_path)
    assert store.file_record("README.md") is not None

    flags["include_docs"] = False
    store2, _, _ = index_project(tmp_path)
    assert store2.last_doc_flags() == (False, False)
    (tmp_path / "NEW.md").write_text("# New\n")
    refresh_project(store2, tmp_path)
    assert store2.file_record("NEW.md") is None and store2.file_record("README.md") is None


def test_index_route_accepts_doc_flags(api, copy_fixture):
    root = copy_fixture("py_mini")
    (root / "README.md").write_text("# Mini\n")
    pid = api.open(root)["project_id"]
    r = api.post(f"/v1/projects/{pid}/index", json={"include_docs": True})
    assert r.status_code == 202
    for _ in range(300):
        job = api.get(f"/v1/jobs/{r.json()['job_id']}").json()
        if job["state"] in ("done", "error"):
            break
        time.sleep(0.05)
    assert job["state"] == "done"
    assert api.get(f"/v1/projects/{pid}/stats").json()["files"] == 4


def test_reindex_without_flags_keeps_last_doc_flags(api, copy_fixture):
    root = copy_fixture("py_mini")
    (root / "README.md").write_text("# Mini\n")
    pid = api.open(root)["project_id"]

    def index(body):
        r = api.post(f"/v1/projects/{pid}/index", json=body)
        for _ in range(300):
            if api.get(f"/v1/jobs/{r.json()['job_id']}").json()["state"] in ("done", "error"):
                break
            time.sleep(0.05)
        return api.get(f"/v1/projects/{pid}/stats").json()["files"]

    assert index({"include_docs": True}) == 4
    assert index({}) == 4                      # nút "Index lại" không gửi cờ: giữ tuỳ chọn lần trước
    assert index({"include_docs": False}) == 3  # hộp thoại gửi cờ tường minh
