"""Chép lời audio/video trên máy bằng faster-whisper (không đóng gói, spec F10 §4.5) và dò công cụ ngoài."""
from __future__ import annotations

import shutil
import threading
from importlib.util import find_spec
from pathlib import Path

import graphify.transcribe as gt

MISSING_WHISPER = "Cần cài faster-whisper để chép lời"


class TranscriptCancelled(Exception):
    """Người dùng huỷ job giữa lúc đang chép lời một tệp; bản dở không được lưu."""


def has_whisper() -> bool:
    return find_spec("faster_whisper") is not None


def tools_available() -> dict[str, bool]:
    return {"ffmpeg": shutil.which("ffmpeg") is not None, "faster_whisper": has_whisper(),
            "git": shutil.which("git") is not None, "gh": shutil.which("gh") is not None,
            "yt_dlp": find_spec("yt_dlp") is not None}


def transcript_for(path: Path, sha: str, out_dir: Path, *, cancel: threading.Event | None = None) -> str:
    """Bản chép lời lưu theo mã băm tệp trong thư mục dữ liệu app (không ghi vào project, không trùng tên giữa thư mục)."""
    cached = Path(out_dir) / f"{sha}.txt"
    if cached.is_file():
        return cached.read_text(encoding="utf-8")
    # Không gọi gt.transcribe(): nó cache theo tên tệp và print ra stdout.
    model = gt._get_whisper()(gt._model_name(), device="cpu", compute_type="int8")
    segments, _ = model.transcribe(str(path), beam_size=5, initial_prompt=gt._FALLBACK_PROMPT)
    lines: list[str] = []
    for seg in segments:  # segments là generator: chép lời diễn ra trong vòng lặp này, nên kiểm tra huỷ ở đây
        if cancel is not None and cancel.is_set():
            raise TranscriptCancelled(str(path))
        if seg.text.strip():
            lines.append(seg.text.strip())
    text = "\n".join(lines)
    cached.parent.mkdir(parents=True, exist_ok=True)
    cached.write_text(text, encoding="utf-8")
    return text
