"""Một danh sách đổi tên hiển thị duy nhất cho chuỗi do mã vendor sinh ra (ADR 0025 mục 3).

Báo cáo Markdown (route `/report`, resource MCP `nexgraph://report`, tệp `GRAPH_REPORT.md` xuất ra),
văn bản tool MCP từ lớp xem vendor và các trang HTML xuất ra đều dùng danh sách này. Trước đây có ba
danh sách riêng, và báo cáo trả qua route/MCP không đi qua danh sách nào, nên agent đọc được câu
"run `graphify query`", một lệnh không tồn tại trong NexGraph.

Chỉ khớp **nguyên văn câu mẫu**: không đổi id, nhãn, đường dẫn hay nội dung dự án, kể cả khi chúng có
chữ "graphify" (QA #69 finding 1). Câu thay thế không hướng người đọc tới lệnh CLI: NexGraph tự cập nhật
đồ thị khi tệp đổi.
"""
from __future__ import annotations

#: (câu mẫu của vendor, câu của NexGraph). Mỗi cặp ghi nơi vendor sinh câu.
PHRASES: tuple[tuple[str, str], ...] = (
    # graphify/report.py: mục Knowledge Gaps
    ("run `graphify query` to explore isolated nodes", "open the graph view to explore isolated nodes"),
    # graphify/report.py: mục Freshness
    ("Run `graphify update .` after code changes (no API cost).",
     "NexGraph updates the graph automatically after code changes (no API cost)."),
    # graphify/sections.py: heading không còn ở dòng đã ghi / bị dời dòng
    ("Run `graphify update .` to refresh the graph.",
     "Wait for NexGraph to refresh the graph, then try again."),
    ("run `graphify update .` to refresh the graph.",
     "wait for NexGraph to refresh the graph, then try again."),
    # graphify/export (trang HTML, wiki)
    ("Generated from graphify knowledge graph", "Generated from NexGraph knowledge graph"),
    ("This section comes from graphify community clustering.",
     "This section comes from NexGraph community clustering."),
    ("graphify callflow-html", "NexGraph callflow"),
)


def replace_phrases(text: str) -> tuple[str, int]:
    """Trả `(văn bản đã đổi, số chỗ đã đổi)`; chuỗi không khớp nguyên văn thì giữ nguyên."""
    count = 0
    for old, new in PHRASES:
        hits = text.count(old)
        if hits:
            text = text.replace(old, new)
            count += hits
    return text, count
