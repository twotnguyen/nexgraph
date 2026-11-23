"""E10 mục 1: ảnh cục bộ vào graph bằng tuỳ chọn `include_images`, tách khỏi audio/video.

Bản cài đóng gói không có faster-whisper nên ô "Gồm audio/video" bị khoá ⇒ `include_media` không bật
được ⇒ `.png`/`.jpg` không bao giờ vào graph dù tính năng AI mô tả ảnh (W9) có (A3b-P2 1.7).
"""
import threading
import time

from nexgraph_engine.index.discovery import discover
from nexgraph_engine.index.indexer import Indexer
from nexgraph_engine.index.refresh import refresh_project
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.store.graph_store import GraphStore


def _tree(root):
    (root / "a.py").write_text("x = 1\n")
    (root / "docs").mkdir()
    (root / "docs" / "logo.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    (root / "talk.mp3").write_bytes(b"ID3")


def _index(root, db, **flags) -> GraphStore:
    store = GraphStore(open_graph_db(db))
    store.init_project(root.name, has_git=False)
    result = Indexer(store, root, on_progress=lambda e: None, cancel=threading.Event(), **flags).run()
    assert result.state == "hoan_tat"
    return store


def _wait(api, job_id):
    for _ in range(400):
        job = api.get(f"/v1/jobs/{job_id}").json()
        if job["state"] in ("done", "error", "cancelled"):
            return job
        time.sleep(0.05)
    raise AssertionError("job không xong")


def test_discovery_include_images_does_not_pull_audio(tmp_path):
    _tree(tmp_path)
    assert {f.rel_path for f in discover(tmp_path)} == {"a.py"}
    got = {f.rel_path: f.language for f in discover(tmp_path, include_images=True)}
    assert got == {"a.py": "python", "docs/logo.png": "image"}


def test_discovery_include_media_still_includes_images(tmp_path):
    """Tương thích: `include_media=true` cũ vẫn bao gồm ảnh như trước."""
    _tree(tmp_path)
    got = {f.rel_path: f.language for f in discover(tmp_path, include_media=True)}
    assert got["docs/logo.png"] == "image" and got["talk.mp3"] == "media"


def test_indexer_include_images_puts_files_and_flag_in_graph(tmp_path):
    _tree(tmp_path)
    store = _index(tmp_path, tmp_path / "with.db", include_images=True)
    rec = store.file_record("docs/logo.png")
    assert rec is not None and rec.language == "image"
    assert store.file_record("talk.mp3") is None  # không kéo audio/video
    assert store.last_image_flag() is True

    store = _index(tmp_path, tmp_path / "without.db")
    assert store.file_record("docs/logo.png") is None  # mặc định tắt
    assert store.last_image_flag() is False


def test_image_flag_persists_for_refresh(tmp_path):
    _tree(tmp_path)
    store = _index(tmp_path, tmp_path / "g.db", include_images=True)
    assert store.file_record("docs/logo.png") is not None
    time.sleep(1.1)
    (tmp_path / "docs" / "banner.jpg").write_bytes(b"\xff\xd8\xff")
    refresh_project(store, tmp_path)
    assert store.file_record("docs/banner.jpg") is not None

    store = _index(tmp_path, tmp_path / "off.db")
    (tmp_path / "docs" / "icon.svg").write_text("<svg/>")
    refresh_project(store, tmp_path)
    assert store.file_record("docs/icon.svg") is None


def test_index_route_accepts_include_images_and_reuses_it(api, copy_fixture):
    root = copy_fixture("docs_app")
    pid = api.open(root)["project_id"]
    r = api.post(f"/v1/projects/{pid}/index", json={})
    assert _wait(api, r.json()["job_id"])["state"] == "done"
    files_before = api.get(f"/v1/projects/{pid}/stats").json()["files"]
    assert "image" not in api.get(f"/v1/projects/{pid}/stats").json()["languages"]  # mặc định tắt
    r = api.post(f"/v1/projects/{pid}/index", json={"include_images": True})
    assert r.status_code == 202
    assert _wait(api, r.json()["job_id"])["state"] == "done"
    stats = api.get(f"/v1/projects/{pid}/stats").json()
    assert stats["files"] == files_before + 1  # docs/logo.png
    assert stats["languages"]["image"] == 1

    # "Index lại" không gửi cờ: dùng lại lựa chọn lần trước.
    r = api.post(f"/v1/projects/{pid}/index", json={})
    assert _wait(api, r.json()["job_id"])["state"] == "done"
    assert api.get(f"/v1/projects/{pid}/stats").json()["files"] == files_before + 1

    # Tắt tường minh thì ảnh ra khỏi graph.
    r = api.post(f"/v1/projects/{pid}/index", json={"include_images": False})
    assert _wait(api, r.json()["job_id"])["state"] == "done"
    assert api.get(f"/v1/projects/{pid}/stats").json()["files"] == files_before
