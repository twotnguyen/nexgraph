"""Bản tiếng Việt cho báo cáo Markdown do Graphify sinh khi xuất `.md`.

`graphify/report.py::generate` viết chuỗi tiếng Anh cố định; đó là mã vendored nên lớp NexGraph hậu xử
lý từng dòng theo bảng dưới, cùng cách `export/callflow_i18n.py` làm với HTML callflow (A3b-P1 F4).
Câu hỏi gợi ý/lý do đã được dịch trước khi gọi `generate` bằng `report/i18n.py`; ở đây chỉ còn tiêu đề
mục và các câu khung. Dòng không khớp mẫu nào được giữ nguyên; dữ liệu (tên nút/tệp/nhãn cụm) không đổi.
"""
from __future__ import annotations

import re
from collections.abc import Callable

_SUMMARY = re.compile(
    r"^- (?P<n>\d+) nodes · (?P<e>\d+) edges · (?P<c>\d+) communities"
    r"(?: \((?P<shown>\d+) shown, (?P<thin>\d+) thin omitted\))?$")


def _summary(match: re.Match[str]) -> str:
    line = f"- {match['n']} nút · {match['e']} cạnh · {match['c']} cộng đồng"
    if match["thin"] is not None:
        line += f" (hiện {match['shown']}, bỏ qua {match['thin']} mỏng)"
    return line


def _isolated_note(match: re.Match[str]) -> str:
    reason = ("có thể thiếu cạnh hoặc thiếu tài liệu" if match["reason"].endswith("undocumented components")
              else "có thể thiếu cạnh")
    return (f"  Các nút này có ≤1 kết nối - {reason}. (Chỉ đếm ký hiệu; tổng {match['raw']} nút có ≤1 kết nối"
            " khi tính cả nút tệp, khái niệm và ghi chú.)")


# Thứ tự quan trọng: tiêu đề có số liệu đứng trước tiêu đề cố định.
_RULES: list[tuple[re.Pattern[str], str | Callable[[re.Match[str]], str]]] = [
    (re.compile(r"^# Graph Report - (?P<root>.*?)  \((?P<date>[\d-]+)\)$"),
     r"# Báo cáo đồ thị - \g<root>  (\g<date>)"),
    (re.compile(r"^## Corpus Check$"), "## Kiểm tra kho mã"),
    (re.compile(r"^## Summary$"), "## Tóm tắt"),
    (re.compile(r"^## Community Hubs \(Navigation\)$"), "## Cụm cộng đồng (điều hướng)"),
    (re.compile(r"^## God Nodes \(most connected - your core abstractions\)$"),
     "## Nút trung tâm (kết nối nhiều nhất - trừu tượng cốt lõi)"),
    (re.compile(r"^## Surprising Connections \(you probably didn't know these\)$"),
     "## Kết nối bất ngờ (có thể bạn chưa biết)"),
    (re.compile(r"^## Import Cycles$"), "## Chu trình import"),
    (re.compile(r"^## Hyperedges \(group relationships\)$"), "## Siêu cạnh (quan hệ nhóm)"),
    (re.compile(r"^## Communities \((?P<n>\d+) total, (?P<thin>\d+) thin omitted\)$"),
     r"## Cộng đồng (tổng \g<n>, bỏ qua \g<thin> mỏng)"),
    (re.compile(r'^### Community (?P<cid>\d+) - "(?P<label>.*)"$'), r'### Cộng đồng \g<cid> - "\g<label>"'),
    (re.compile(r"^## Ambiguous Edges - Review These$"), "## Cạnh AMBIGUOUS - cần xem lại"),
    (re.compile(r"^## Knowledge Gaps$"), "## Lỗ hổng kiến thức"),
    (re.compile(r"^## Suggested Questions$"), "## Câu hỏi gợi ý"),
    (re.compile(r"^### Low-confidence Hints$"), "### Gợi ý độ tin cậy thấp"),
    (re.compile(r"^## Graph Freshness$"), "## Độ mới của đồ thị"),
    (re.compile(r"^- Verdict: corpus is large enough that graph structure adds value\.$"),
     "- Kết luận: kho mã đủ lớn để cấu trúc đồ thị mang lại giá trị."),
    (re.compile(r"^- (?P<n>\d+) files$"), r"- \g<n> tệp"),
    (re.compile(r"^(?P<i>\d+)\. `(?P<label>.+)` - (?P<n>\d+) edges$"), r"\g<i>. `\g<label>` - \g<n> cạnh"),
    (_SUMMARY, _summary),
    (re.compile(r"^Cohesion: (?P<s>[\d.]+)$"), r"Độ gắn kết: \g<s>"),
    (re.compile(r"^Nodes \((?P<n>\d+)\): (?P<rest>.+)$"), r"Nút (\g<n>): \g<rest>"),
    (re.compile(r"^- (?P<n>\d+)-file cycle: (?P<rest>.+)$"), r"- Chu trình \g<n> tệp: \g<rest>"),
    (re.compile(r"^- \*\*(?P<n>\d+) isolated node\(s\):\*\* (?P<rest>.+)$"), r"- **\g<n> nút cô lập:** \g<rest>"),
    (re.compile(r"^  These have ≤1 connection - (?P<reason>possible missing edges or undocumented components"
                r"|possible missing edges)\. \(Counts symbols only; (?P<raw>\d+) node\(s\) total have ≤1"
                r" connection when file, concept and rationale nodes are included\.\)$"), _isolated_note),
    (re.compile(r"^- \*\*(?P<n>\d+) thin communities \(<(?P<k>\d+) nodes\) omitted from report\*\* — run"
                r" `graphify query` to explore isolated nodes\.$"),
     r"- **Bỏ qua \g<n> cộng đồng mỏng (<\g<k> nút) khỏi báo cáo** — chạy `graphify query` để xem các nút cô lập."),
    (re.compile(r"^- \*\*High ambiguity: (?P<pct>\d+)% of edges are AMBIGUOUS\.\*\* Review the Ambiguous Edges"
                r" section above\.$"),
     r"- **Độ mơ hồ cao: \g<pct>% cạnh là AMBIGUOUS.** Xem lại mục Cạnh AMBIGUOUS ở trên."),
    (re.compile(r"^- None detected - all connections are within the same source files\.$"),
     "- Không phát hiện - mọi kết nối nằm trong cùng tệp nguồn."),
    (re.compile(r"^- None detected\.$"), "- Không phát hiện."),
    (re.compile(r"^_Questions this graph is uniquely positioned to answer:_$"),
     "_Những câu hỏi mà đồ thị này có lợi thế trả lời:_"),
    (re.compile(r"^_AMBIGUOUS edges — the extractor was unsure\. Verify before acting on these\._$"),
     "_Cạnh AMBIGUOUS — bộ trích xuất không chắc chắn. Kiểm chứng trước khi dùng._"),
]

# Cụm chuỗi cố định nằm giữa dòng có số liệu (không tách được bằng cả dòng).
_FRAGMENTS: tuple[tuple[str, str], ...] = (
    ("- Extraction: ", "- Trích xuất: "),
    (" edges (avg confidence: ", " cạnh (độ tin cậy trung bình: "),
    (" · relation: ", " · quan hệ: "),
    ("- Built from commit: ", "- Xây từ commit: "),
    ("- Run `git rev-parse HEAD` and compare to check if the graph is stale.",
     "- Chạy `git rev-parse HEAD` và so sánh để biết đồ thị có cũ không."),
    ("- Run `graphify update .` after code changes (no API cost).",
     "- Chạy `graphify update .` sau khi sửa mã (không tốn phí API)."),
)


def _translate_line(line: str) -> str:
    for pattern, replacement in _RULES:
        if pattern.match(line):
            return pattern.sub(replacement, line)  # type: ignore[arg-type]
    for english, vietnamese in _FRAGMENTS:
        if english in line:
            line = line.replace(english, vietnamese)
    return line


def localize_markdown(md: str, lang: str) -> str:
    """Dịch báo cáo Markdown sang tiếng Việt khi `lang="vi"`; ngôn ngữ khác trả nguyên bản."""
    if lang != "vi":
        return md
    return "\n".join(_translate_line(line) for line in md.splitlines()) + ("\n" if md.endswith("\n") else "")
