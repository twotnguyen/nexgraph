"""E10 mục 1: ảnh cục bộ vào graph bằng tuỳ chọn `include_images`, tách khỏi audio/video.

Bản cài đóng gói không có faster-whisper nên ô "Gồm audio/video" bị khoá ⇒ `include_media` không bật
được ⇒ `.png`/`.jpg` không bao giờ vào graph dù tính năng AI mô tả ảnh (W9) có (A3b-P2 1.7).
"""
import struct
import threading
import time
import zlib

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


def _write_large_png(path, width: int = 1500, height: int = 1500) -> None:
    """PNG hợp lệ, nén mức 0 (như ảnh chụp) — đúng cỡ QA dùng cho review-64 I1 (~6,7 MB)."""
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # RGB 8-bit
    raw = b"".join(b"\x00" + b"\x7f" * (width * 3) for _ in range(height))
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
                     + chunk(b"IDAT", zlib.compress(raw, 0)) + chunk(b"IEND", b""))


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


def test_large_image_does_not_inflate_parser_batch_deadline(tmp_path):
    """review-64 I1: ảnh chỉ băm, không parse — byte ảnh không được kéo hạn lô parser.

    Đúng phép đo QA: PNG 1.500 × 1.500 (~6,7 MB) + 207 tệp `.py`, `include_images=True`,
    `index_workers(208, False, 2)`, rồi so `batch_timeout_seconds` của lô có ảnh với lô chỉ có mã.
    Trước khi sửa, lô 15 tệp mã + 1 PNG đòi 300 s (trần) thay vì 20 s như lô không ảnh.
    """
    from nexgraph_engine.index.indexer import (
        batch_timeout_seconds, extraction_batches, index_workers)

    _write_large_png(tmp_path / "photo.png")
    assert (tmp_path / "photo.png").stat().st_size > 6_000_000
    for i in range(207):
        (tmp_path / f"m{i:03d}.py").write_text("x = 1\n")

    files = list(discover(tmp_path, include_images=True))
    assert len(files) == 208
    assert index_workers(len(files), False, 2) == 2  # như phép đo QA

    batch_files = [[files[i] for i in b] for b in extraction_batches(files)]
    assert len(batch_files) == 13
    image_batch = next(b for b in batch_files if any(f.language == "image" for f in b))
    code_batch = max((b for b in batch_files if all(f.language == "python" for f in b)),
                     key=lambda b: sum(f.size for f in b))

    image = next(f for f in image_batch if f.language == "image")
    assert image.size > 6_000_000 and not image.oversized  # ảnh không bị coi là "quá lớn"
    assert len(image_batch) == 16 and sum(f.language == "python" for f in image_batch) == 15
    assert batch_timeout_seconds(image_batch) == batch_timeout_seconds(code_batch) == 20
