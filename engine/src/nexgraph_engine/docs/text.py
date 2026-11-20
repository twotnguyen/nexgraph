"""Lấy chữ từ tệp tài liệu, chạy hoàn toàn trên máy. Không ghi đĩa: `/code` gọi lại hàm này nên số dòng luôn khớp."""
from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path

from graphify.detect import docx_to_markdown, extract_pdf_text, xlsx_to_markdown


def doc_text(path: Path, language: str) -> str:
    if language in ("markdown", "text"):
        return Path(path).read_text(encoding="utf-8", errors="replace")
    if language == "html":
        return html_to_markdown(Path(path).read_text(encoding="utf-8", errors="replace"))
    if language == "docx":
        return docx_to_markdown(Path(path))
    if language == "xlsx":
        return xlsx_to_markdown(Path(path))
    if language == "pdf":
        return extract_pdf_text(Path(path))
    raise ValueError(f"Không đọc được chữ từ ngôn ngữ {language}")


class _HtmlText(HTMLParser):
    """HTML → Markdown tối thiểu: heading thành `#`, bỏ script/style, giữ chữ (đủ cho mục tài liệu)."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.out.append("\n" + "#" * int(tag[1]) + " ")
        elif tag in ("p", "div", "li", "br", "tr", "section", "article"):
            self.out.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.skip = max(0, self.skip - 1)
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6", "p", "li"):
            self.out.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)


def html_to_markdown(html: str) -> str:
    parser = _HtmlText()
    parser.feed(html)
    return "".join(parser.out)
