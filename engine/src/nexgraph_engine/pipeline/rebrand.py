"""NG-PIPE-4 — đổi tên hiển thị trong các tệp pipeline ghi ra đĩa (ADR 0025 mục 3).

Chỉ sửa **chuỗi do mẫu của vendor sinh ra** (tiêu đề trang, câu hướng dẫn, phụ đề báo cáo).
Không đụng dữ liệu của dự án đang được phân tích: đường dẫn `engine/src/graphify/cli.py`, tên hàm
`_graphify_version()`, `graphify-out`, `.graphify_analysis.json` và id `graphify-theme` của trang
đều phải giữ nguyên — đổi chúng là sửa nội dung/khoá nội bộ, không phải nhãn hiển thị.

#69 (MCP) chưa merge nên chưa có `rebrand_text` dùng chung; hàm ở đây là bản nhỏ, gộp lại khi #69 vào.
"""
from __future__ import annotations

import re
from pathlib import Path

EXPORTED = ("GRAPH_REPORT.md", "graph.html", "GRAPH_TREE.html")
CALLFLOW_GLOB = "*-callflow.html"

#: Câu/chữ mẫu của vendor → câu của NexGraph. Khớp nguyên văn nên không sửa nhầm dữ liệu dự án.
PHRASES = (
    ("Generated from graphify knowledge graph", "Generated from NexGraph knowledge graph"),
    ("This section comes from graphify community clustering.",
     "This section comes from NexGraph community clustering."),
    ("graphify callflow-html", "NexGraph callflow"),
    ("run `graphify query` to explore isolated nodes", "open the graph view to explore isolated nodes"),
    ("Run `graphify update .` after code changes (no API cost).",
     "Run `nexgraph refresh` after code changes (no API cost)."),
)

#: Tiêu đề trang là chữ của mẫu; chỉ đổi trong `<title>` và không đổi khi dính `/`, `\\`, `-`, `_`.
TITLE = re.compile(r"<title>(.*?)</title>", re.S)
DISPLAY_WORD = re.compile(r"(?<![\w/\\-])[Gg]raphify(?![\w/\\-])")


def rebrand_text(text: str) -> tuple[str, int]:
    """Trả `(văn bản đã đổi, số chỗ đã đổi)`; đường dẫn/id/dữ liệu dự án không khớp nên giữ nguyên."""
    count = 0
    for old, new in PHRASES:
        hits = text.count(old)
        if hits:
            text = text.replace(old, new)
            count += hits

    def _title(match: re.Match[str]) -> str:
        nonlocal count
        inner, hits = DISPLAY_WORD.subn("NexGraph", match.group(1))
        count += hits
        return f"<title>{inner}</title>"

    return TITLE.sub(_title, text), count


def rebrand_exported(out_dir: Path) -> dict[str, int]:
    """Đổi tên hiển thị trong báo cáo + 3 trang HTML đã xuất; trả số chỗ đổi theo tên tệp."""
    out = Path(out_dir)
    targets = [out / name for name in EXPORTED] + sorted(out.glob(CALLFLOW_GLOB))
    counts: dict[str, int] = {}
    for path in targets:
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        new, hits = rebrand_text(text)
        if hits:
            try:
                path.write_text(new, encoding="utf-8")
            except OSError:
                continue
        counts[path.name] = hits
    return counts
