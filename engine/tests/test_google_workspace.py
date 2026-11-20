"""Lối tắt Google Workspace (.gdoc/.gsheet/.gslides): chỉ đọc khi bật "Tài liệu" và có `gws`; `gws` được giả trong test."""
import json
import time
from pathlib import Path
from urllib.parse import quote

import pytest

import graphify.google_workspace as gw
from nexgraph_engine.docs import media
from nexgraph_engine.ids import file_node_id
from nexgraph_engine.index.discovery import discover


@pytest.fixture
def drive(tmp_path):
    root = tmp_path / "drive"
    root.mkdir()
    (root / "app.py").write_text("def main():\n    return 1\n", encoding="utf-8")
    (root / "plan.gdoc").write_text(json.dumps({"doc_id": "abc123", "url": "https://docs.google.com/document/d/abc123/edit"}),
                                    encoding="utf-8")
    return root


@pytest.fixture
def fake_gws(monkeypatch):
    calls = []

    def export(file_id, mime_type, output: Path, resource_key=None):
        calls.append((file_id, mime_type))
        output.write_text("# Kế hoạch\n\nNội dung từ Drive.\n\n## Mốc\n\nTuần 3.\n", encoding="utf-8")

    monkeypatch.setattr(media, "has_gws", lambda: True)
    monkeypatch.setattr(gw, "_run_gws_export", export)
    return calls


def languages(root, **kw):
    return {f.rel_path: f.language for f in discover(root, **kw)}


def test_shortcut_needs_docs_and_gws(drive, monkeypatch):
    monkeypatch.setattr(media, "has_gws", lambda: False)
    assert "plan.gdoc" not in languages(drive, include_docs=True)
    monkeypatch.setattr(media, "has_gws", lambda: True)
    assert "plan.gdoc" not in languages(drive)
    assert languages(drive, include_docs=True)["plan.gdoc"] == "google_workspace"


def test_index_exports_and_code_reads_cache(api, drive, fake_gws):
    pid = api.open(drive)["project_id"]
    job_id = api.post(f"/v1/projects/{pid}/index", json={"include_docs": True}).json()["job_id"]
    for _ in range(300):
        job = api.get(f"/v1/jobs/{job_id}").json()
        if job["state"] in ("done", "error", "cancelled"):
            break
        time.sleep(0.05)
    assert job["state"] == "done", job
    assert fake_gws == [("abc123", "text/markdown")]
    assert api.get(f"/v1/projects/{pid}/nodes/{quote(file_node_id('plan.gdoc'), safe='')}").status_code == 200
    hits = api.get(f"/v1/projects/{pid}/search", params={"q": "Mốc"}).json()
    assert any(h["node"]["file"] == "plan.gdoc" and h["node"]["kind"] == "document" for h in hits)
    code = api.get(f"/v1/projects/{pid}/code", params={"file": "plan.gdoc"}).json()
    assert "Nội dung từ Drive." in code["text"]
    # Refresh không gọi lại gws khi tệp không đổi; /code đọc từ cache.
    assert api.post(f"/v1/projects/{pid}/refresh").json()["status"] == "ok"
    assert len(fake_gws) == 1


def test_export_failure_is_file_error(api, drive, monkeypatch):
    monkeypatch.setattr(media, "has_gws", lambda: True)

    def fail(*a, **k):
        raise RuntimeError("gws export failed for abc123: not logged in")

    monkeypatch.setattr(gw, "_run_gws_export", fail)
    pid = api.open(drive)["project_id"]
    job_id = api.post(f"/v1/projects/{pid}/index", json={"include_docs": True}).json()["job_id"]
    for _ in range(300):
        if api.get(f"/v1/jobs/{job_id}").json()["state"] in ("done", "error", "cancelled"):
            break
        time.sleep(0.05)
    stats = api.get(f"/v1/projects/{pid}/stats").json()
    assert stats["nodes_by_kind"]["file"] == 2
