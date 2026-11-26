from types import SimpleNamespace

import pytest

import graphify.transcribe as gt
from nexgraph_engine.indexing.docs import media
from nexgraph_engine.core.schema.enums import EdgeType

from test_docs_extract import docs_root, edges, run_index  # noqa: F401  (fixture dùng chung)

LOGIN = "lib/auth.py::AuthService.login#method"


@pytest.fixture
def fake_whisper(monkeypatch):
    calls = []

    class Model:
        def __init__(self, name, device, compute_type):
            calls.append((name, device, compute_type))

        def transcribe(self, path, beam_size, initial_prompt=None):
            segs = [SimpleNamespace(text=" # Buổi họp "), SimpleNamespace(text="Ta sửa `AuthService.login` hôm nay.")]
            return iter(segs), SimpleNamespace(language="vi")

    monkeypatch.setattr(gt, "_get_whisper", lambda: Model)
    monkeypatch.setattr(media, "find_spec", lambda name: object())
    return calls


def test_transcript_cached_by_sha(tmp_path, fake_whisper):
    audio = tmp_path / "proj" / "talk.mp3"
    audio.parent.mkdir()
    audio.write_bytes(b"ID3")
    out = tmp_path / "data" / "transcripts" / "p1"
    sha = "a" * 64
    first = media.transcript_for(audio, sha, out)
    second = media.transcript_for(audio, sha, out)
    assert first == second and "AuthService.login" in first
    assert len(fake_whisper) == 1
    assert (out / f"{sha}.txt").is_file()
    assert not any(p.suffix == ".txt" for p in audio.parent.iterdir())


def test_media_indexed_as_document(docs_root, tmp_path, fake_whisper):
    (docs_root / "talk.mp3").write_bytes(b"ID3")
    store = run_index(docs_root, tmp_path / "g.db", include_docs=True, include_media=True,
                      transcript_dir=tmp_path / "tr")
    assert ("talk.mp3::Buổi họp#document", LOGIN) in edges(store, EdgeType.DOCUMENTS)


def test_missing_whisper_reports_tool_error(docs_root, tmp_path, monkeypatch):
    monkeypatch.setattr(media, "find_spec", lambda name: None)
    (docs_root / "talk.mp3").write_bytes(b"ID3")
    store = run_index(docs_root, tmp_path / "g.db", include_docs=True, include_media=True,
                      transcript_dir=tmp_path / "tr")
    assert store.file_record("talk.mp3") is not None
    errs = store.conn.execute(
        "SELECT e.loai, e.chi_tiet FROM loi_phan_tich e JOIN tep t ON t.ma_tep = e.ma_tep"
        " WHERE t.duong_dan_tuong_doi = 'talk.mp3'").fetchall()
    assert [(r[0], r[1]) for r in errs] == [("extract", "Cần cài faster-whisper để chép lời")]


def test_tools_route(api):
    body = api.get("/v1/tools").json()
    assert set(body) == {"ffmpeg", "faster_whisper", "git", "gh", "yt_dlp", "gws", "psycopg"}
    assert all(isinstance(v, bool) for v in body.values())


def _index_api(api, root, body):
    import time
    pid = api.open(root)["project_id"]
    r = api.post(f"/v1/projects/{pid}/index", json=body)
    for _ in range(300):
        if api.get(f"/v1/jobs/{r.json()['job_id']}").json()["state"] in ("done", "error", "cancelled"):
            break
        time.sleep(0.05)
    return pid


def test_code_on_media_serves_transcript(api, docs_root, fake_whisper):
    (docs_root / "talk.mp3").write_bytes(b"ID3" + b"\xff" * 100)
    pid = _index_api(api, docs_root, {"include_docs": True, "include_media": True})
    body = api.get(f"/v1/projects/{pid}/code", params={"file": "talk.mp3"}).json()
    assert "AuthService.login" in body["text"] and body["language"] == "media"


def test_code_on_media_without_transcript_is_404(api, docs_root, monkeypatch):
    monkeypatch.setattr(media, "find_spec", lambda name: None)
    (docs_root / "talk.mp3").write_bytes(b"ID3" + b"\xff" * 100)
    pid = _index_api(api, docs_root, {"include_docs": True, "include_media": True})
    r = api.get(f"/v1/projects/{pid}/code", params={"file": "talk.mp3"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "no_text"


def test_media_bytes_not_loaded(docs_root, tmp_path, fake_whisper, monkeypatch):
    from pathlib import Path
    real = Path.read_bytes
    read: list[str] = []
    monkeypatch.setattr(Path, "read_bytes", lambda self: (read.append(self.name), real(self))[1])
    (docs_root / "talk.mp3").write_bytes(b"ID3")
    run_index(docs_root, tmp_path / "g.db", include_docs=True, include_media=True, transcript_dir=tmp_path / "tr")
    assert "talk.mp3" not in read


def test_transcription_cancel_mid_file(tmp_path, monkeypatch):
    import threading
    cancel = threading.Event()

    class Model:
        def __init__(self, *a, **k):
            pass

        def transcribe(self, path, beam_size, initial_prompt=None):
            def gen():
                yield SimpleNamespace(text="một")
                cancel.set()
                yield SimpleNamespace(text="hai")
            return gen(), SimpleNamespace(language="vi")

    monkeypatch.setattr(gt, "_get_whisper", lambda: Model)
    audio = tmp_path / "talk.mp3"
    audio.write_bytes(b"ID3")
    out = tmp_path / "tr"
    with pytest.raises(media.TranscriptCancelled):
        media.transcript_for(audio, "b" * 64, out, cancel=cancel)
    assert not (out / f"{'b' * 64}.txt").exists()


def test_cancel_during_transcription_stops_index(docs_root, tmp_path, monkeypatch):
    import threading
    from nexgraph_engine.pipeline.legacy_indexer import Indexer
    from nexgraph_engine.core.schema.db import open_graph_db
    from nexgraph_engine.storage.store.graph_store import GraphStore
    cancel = threading.Event()

    class Model:
        def __init__(self, *a, **k):
            pass

        def transcribe(self, path, beam_size, initial_prompt=None):
            def gen():
                cancel.set()
                yield SimpleNamespace(text="x")
            return gen(), SimpleNamespace(language="vi")

    monkeypatch.setattr(gt, "_get_whisper", lambda: Model)
    monkeypatch.setattr(media, "find_spec", lambda name: object())
    (docs_root / "a_talk.mp3").write_bytes(b"ID3")
    store = GraphStore(open_graph_db(tmp_path / "g.db"))
    store.init_project("p", has_git=False)
    r = Indexer(store, docs_root, on_progress=lambda e: None, cancel=cancel, include_docs=True, include_media=True,
                transcript_dir=tmp_path / "tr").run()
    assert r.state == "huy"
    assert not list((tmp_path / "tr").glob("*.txt"))
