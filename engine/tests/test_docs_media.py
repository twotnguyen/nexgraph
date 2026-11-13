from types import SimpleNamespace

import pytest

import graphify.transcribe as gt
from nexgraph_engine.docs import media
from nexgraph_engine.schema.enums import EdgeType

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
    assert set(body) == {"ffmpeg", "faster_whisper", "git", "gh", "yt_dlp"}
    assert all(isinstance(v, bool) for v in body.values())
