"""Thêm nguồn từ URL (W6): tải qua guard SSRF của graphify, lưu ở `<data_dir>/sources/<pid>/`, vào graph như `sources/…`."""
import http.server
import threading
import time
from functools import partial
from urllib.parse import quote

import pytest

import graphify.security as security
from nexgraph_engine.ids import file_node_id
from nexgraph_engine.index.discovery import discover

PAGE = b"""<html><head><title>Ghi chu kien truc</title></head>
<body><h1>Kien truc</h1><p>Dich vu BookService goi kho du lieu.</p></body></html>"""


def node_url(rel):
    return quote(file_node_id(rel), safe="")


def wait_job(api, job_id, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        job = api.get(f"/v1/jobs/{job_id}").json()
        if job["state"] in ("done", "error", "cancelled"):
            return job
        time.sleep(0.05)
    raise AssertionError("job không kết thúc")


@pytest.fixture
def web(tmp_path, monkeypatch):
    """Server HTTP cục bộ; guard SSRF chỉ được nới cho loopback, riêng trong test này."""
    site = tmp_path / "site"
    site.mkdir()
    (site / "page.html").write_bytes(PAGE)
    handler = partial(http.server.SimpleHTTPRequestHandler, directory=str(site))
    handler.log_message = lambda *a, **k: None
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    original = security._ip_is_blocked
    monkeypatch.setattr(security, "_ip_is_blocked", lambda ip: not ip.is_loopback and original(ip))
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


@pytest.fixture
def project(api, copy_fixture):
    root = copy_fixture("py_mini")
    pid = api.open(root)["project_id"]
    assert api.index(pid)["state"] == "done"
    return root, pid


@pytest.mark.parametrize("url", ["file:///etc/passwd", "ftp://example.com/x", "http://127.0.0.1/x",
                                 "http://169.254.169.254/latest/meta-data", "http://[::1]/x", "not a url"])
def test_blocked_urls_rejected_before_job(api, project, url):
    _, pid = project
    r = api.post(f"/v1/projects/{pid}/sources", json={"url": url})
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_url"
    assert api.get(f"/v1/projects/{pid}/sources").json() == []


def test_unknown_project_404(api):
    r = api.post("/v1/projects/00000000-0000-0000-0000-000000000000/sources", json={"url": "https://example.com"})
    assert r.status_code == 404


def test_ingest_adds_source_to_graph_and_survives_refresh(api, project, web):
    root, pid = project
    r = api.post(f"/v1/projects/{pid}/sources", json={"url": f"{web}/page.html"})
    assert r.status_code == 202, r.text
    job = wait_job(api, r.json()["job_id"])
    assert job["state"] == "done", job
    assert job["kind"] == "ingest" and job["project_id"] == pid
    rel = job["result"]["file"]
    assert rel.startswith("sources/") and rel.endswith(".md") and job["result"]["refresh"]["added"] == 1
    on_disk = api.app.state.services.data_dir / "sources" / pid / rel.removeprefix("sources/")
    assert on_disk.is_file() and not (root / "sources").exists()

    assert api.get(f"/v1/projects/{pid}/nodes/{node_url(rel)}").status_code == 200
    code = api.get(f"/v1/projects/{pid}/code", params={"file": rel}).json()
    assert "BookService" in code["text"] and code["stale"] is False
    assert api.get(f"/v1/projects/{pid}/stats").json()["stale"] is False
    assert api.get(f"/v1/projects/{pid}/report").json()["freshness"]["stale"] is False

    listed = api.get(f"/v1/projects/{pid}/sources").json()
    assert [(s["file"], s["url"]) for s in listed] == [(rel, f"{web}/page.html")]

    # Watcher refresh và index lại đầy đủ không làm mất nguồn.
    assert api.post(f"/v1/projects/{pid}/refresh").json()["removed"] == 0
    assert api.index(pid)["state"] == "done"
    assert api.get(f"/v1/projects/{pid}/nodes/{node_url(rel)}").status_code == 200

    name = rel.removeprefix("sources/")
    gone = api.delete(f"/v1/projects/{pid}/sources", params={"name": name})
    assert gone.status_code == 200 and gone.json()["refresh"]["removed"] == 1
    assert not on_disk.exists()
    assert api.get(f"/v1/projects/{pid}/nodes/{node_url(rel)}").status_code == 404
    assert api.delete(f"/v1/projects/{pid}/sources", params={"name": name}).status_code == 404
    assert api.delete(f"/v1/projects/{pid}/sources", params={"name": "../app.db"}).status_code == 404


def test_cli_refresh_keeps_sources(api, project, web, capsys):
    from nexgraph_engine.cli import _refresh
    root, pid = project
    job = wait_job(api, api.post(f"/v1/projects/{pid}/sources", json={"url": f"{web}/page.html"}).json()["job_id"])
    rel = job["result"]["file"]
    (root / "extra.py").write_text("def extra():\n    return 1\n", encoding="utf-8")
    assert _refresh(root, api.app.state.services.data_dir) == 0
    assert '"removed": 0' in capsys.readouterr().out
    assert api.get(f"/v1/projects/{pid}/nodes/{node_url(rel)}").status_code == 200


def test_fetch_failure_is_job_error(api, project, web):
    _, pid = project
    job = wait_job(api, api.post(f"/v1/projects/{pid}/sources", json={"url": f"{web}/missing.pdf"}).json()["job_id"])
    assert job["state"] == "error" and job["message"]
    assert api.get(f"/v1/projects/{pid}/sources").json() == []


def test_discover_without_sources_is_unchanged(copy_fixture, tmp_path):
    root = copy_fixture("py_mini")
    before = list(discover(root))
    assert list(discover(root, sources_dir=tmp_path / "none")) == before
    assert all(f.path is None for f in before)


def test_discover_sources_root(copy_fixture, tmp_path):
    root = copy_fixture("py_mini")
    src = tmp_path / "src"
    src.mkdir()
    (src / "note.md").write_text("# Note\n", encoding="utf-8")
    (src / "paper.pdf").write_bytes(b"%PDF-1.4")
    (src / "pic.png").write_bytes(b"\x89PNG")
    (src / "code.py").write_text("x = 1\n", encoding="utf-8")
    (src / ".hidden.md").write_text("# H\n", encoding="utf-8")
    extra = {f.rel_path: f for f in discover(root, sources_dir=src) if f.rel_path.startswith("sources/")}
    assert sorted(extra) == ["sources/note.md", "sources/paper.pdf", "sources/pic.png"]
    assert extra["sources/note.md"].language == "markdown" and not extra["sources/note.md"].is_test
    assert extra["sources/note.md"].location(root) == src / "note.md"

    # Tệp cùng tên trong chính dự án được ưu tiên.
    (root / "sources").mkdir()
    (root / "sources" / "note.md").write_text("# Mine\n", encoding="utf-8")
    mine = {f.rel_path: f for f in discover(root, include_docs=True, sources_dir=src)}["sources/note.md"]
    assert mine.path is None and mine.location(root) == root / "sources" / "note.md"
