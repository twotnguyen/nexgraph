"""Lấy chữ từ tệp tài liệu, chạy hoàn toàn trên máy. Không ghi đĩa: `/code` gọi lại hàm này nên số dòng luôn khớp."""
from __future__ import annotations

from pathlib import Path

from graphify.detect import docx_to_markdown, extract_pdf_text, xlsx_to_markdown


def doc_text(path: Path, language: str) -> str:
    if language in ("markdown", "text"):
        return Path(path).read_text(encoding="utf-8", errors="replace")
    if language == "docx":
        return docx_to_markdown(Path(path))
    if language == "xlsx":
        return xlsx_to_markdown(Path(path))
    if language == "pdf":
        return extract_pdf_text(Path(path))
    raise ValueError(f"Không đọc được chữ từ ngôn ngữ {language}")
