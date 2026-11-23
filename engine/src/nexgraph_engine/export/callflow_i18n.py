"""Bản tiếng Việt cho HTML callflow do Graphify sinh.

`graphify/callflow_html.py` là mã vendored: `pick_text(lang, zh, en)` trả `zh` khi `lang` bắt đầu
bằng "zh", còn lại trả `en` — nên trước đây `lang=vi` chỉ đổi `<html lang>` mà thân tệp vẫn tiếng
Anh (MIN-47-eng, review-47 Minor 4, rereview-45 Minor 1). Không sửa mã vendored: lớp NexGraph hậu
xử lý HTML theo bảng khoá dưới đây, cùng cách #44 dịch câu hỏi/lý do của báo cáo.

Chuỗi không khớp mẫu nào được giữ nguyên (bản Graphify mới không làm vỡ lần xuất); nhãn do dữ liệu
sinh ra (tên cụm, tên tệp, tên nút) không bị đổi.
"""
from __future__ import annotations

import re
from collections.abc import Callable

# Quan hệ trong sơ đồ Mermaid và trong tóm tắt của phần "Ghi chú thiết kế".
_RELATIONS = {
    "calls": "gọi", "uses": "dùng", "imports": "nhập", "imports_from": "nhập", "method": "phương thức",
    "contains": "chứa", "rationale_for": "giải thích", "conceptually_related_to": "liên quan",
    "participate_in": "tham gia", "form": "tạo thành",
}

# Nhãn tag của bảng chi tiết lời gọi (`_suggest_tag`).
_TAGS = {
    "Module": "Mô-đun", "Class": "Lớp", "Component": "Thành phần", "Function": "Hàm", "Concept": "Khái niệm",
    "CLI": "CLI", "API": "API", "Async": "Bất đồng bộ", "Test": "Kiểm thử", "Hook": "Hook", "UI": "UI",
}

# Câu mô tả nút do `_describe_node` sinh, theo đúng câu tiếng Anh.
_DESCRIPTIONS = {
    "Reads, resolves, or persists project configuration.":
        "Đọc, phân giải hoặc lưu cấu hình của dự án.",
    "Starts scanning or handles scan status.": "Khởi động quét dự án hoặc xử lý trạng thái quét.",
    "Turns a local path or remote repository into analysis context.":
        "Chuyển thư mục cục bộ hoặc kho mã từ xa thành ngữ cảnh phân tích.",
    "Builds structured prompts for model calls.": "Dựng prompt có cấu trúc để gọi mô hình.",
    "Orchestrates analysis and returns structured documentation data.":
        "Điều phối quá trình phân tích và trả về dữ liệu tài liệu có cấu trúc.",
    "Builds dependency relationships and graph data.": "Dựng quan hệ phụ thuộc và dữ liệu đồ thị.",
    "Exports documentation data to a target format.": "Xuất dữ liệu tài liệu ra định dạng đích.",
    "Supports retrieval-augmented Q&A or streaming chat.": "Hỗ trợ hỏi đáp tăng cường truy hồi hoặc chat luồng.",
    "Organizes documentation pages, navigation, or content lookup.":
        "Tổ chức trang tài liệu, điều hướng hoặc tra cứu nội dung.",
    "Caches analysis results or computes cache keys.": "Lưu kết quả phân tích vào cache hoặc tạo khoá cache.",
    "Verifies imports, entry points, or version behavior.": "Kiểm chứng import, điểm vào hoặc hành vi phiên bản.",
}

# Tên phần do `SECTION_ARCHETYPES` của graphify sinh (qua `pick_text`).
_SECTION_NAMES = {
    "Extraction Pipeline": "Luồng trích xuất",
    "Graph Build": "Dựng đồ thị",
    "Analysis &amp; Clustering": "Phân tích &amp; gom cụm",
    "Outputs &amp; Docs": "Đầu ra &amp; tài liệu",
    "CLI &amp; Skill Installers": "CLI &amp; cài đặt kỹ năng",
    "Ingestion &amp; Updates": "Nạp dữ liệu &amp; cập nhật",
    "Serving API": "Phục vụ API",
    "Security &amp; Global Graph": "Bảo mật &amp; đồ thị chung",
    "Tests &amp; Fixtures": "Kiểm thử &amp; dữ liệu mẫu",
}

def _translate_relations(segment: str) -> str:
    """`contains x8, calls x3` → `chứa x8, gọi x3` (chỉ đổi tên quan hệ, giữ số lượng)."""
    return re.sub(r"(?P<rel>[a-z_]+)(?= x\d)",
                  lambda m: _RELATIONS.get(m["rel"], m["rel"]), segment)


def _section_intro(match: re.Match[str]) -> str:
    """Câu mở đầu phần: `unmapped files` là câu sinh, không phải dữ liệu."""
    files = "các tệp chưa gán" if match["files"] == "unmapped files" else match["files"]
    return (f"{match['name']} gom phần triển khai quanh {match['kw']}, chủ yếu ở {files}. "
            f"Phần này gồm {match['n']} nút và {match['e']} cạnh nội bộ; "
            "sơ đồ chỉ hiện các quan hệ tiêu biểu để dễ đọc.")


def _section_note(match: re.Match[str]) -> str:
    return ("Phần này do graphify gom cụm cộng đồng sinh ra. Tóm tắt quan hệ: "
            f"{_translate_relations(match['rel'])}. Sơ đồ ưu tiên các quan hệ gọi/dùng có độ tin cậy cao; "
            "bảng giữ danh sách nút rộng hơn.")


_NOTE = re.compile(r"This section comes from graphify community clustering\. Relationship summary: "
                   r"(?P<rel>[^<]+)\. The diagram prioritizes high-confidence calls or usage relationships; "
                   r"the table keeps the broader node inventory\.")


# Thứ tự quan trọng: mẫu cụ thể (có hậu tố) phải chạy trước mẫu chung.
_RULES: list[tuple[re.Pattern[str], str | Callable[[re.Match[str]], str]]] = [
    # ── Đầu trang ───────────────────────────────────────────────────────────────────────────────
    (re.compile(r" — Complete Call Flow &amp; Architecture Documentation"),
     " — Tài liệu luồng gọi &amp; kiến trúc đầy đủ"),
    (re.compile(r"Generated from graphify knowledge graph: (?P<n>[^<]+) nodes, (?P<e>[^<]+) edges, "
                r"(?P<c>[^<]+) communities\. Commit: (?P<commit>[^<]+)"),
     "Sinh từ đồ thị tri thức graphify: \\g<n> nút, \\g<e> cạnh, \\g<c> cộng đồng. Commit: \\g<commit>"),
    (re.compile(r"<h2 id=\"overview\">(?P<n>\d+)\. Architecture Overview</h2>"),
     "<h2 id=\"overview\">\\g<n>. Tổng quan kiến trúc</h2>"),
    (re.compile(r"<a href=\"#overview\">Architecture Overview</a>"),
     "<a href=\"#overview\">Tổng quan kiến trúc</a>"),
    (re.compile(r"<h2 id=\"other\">(?P<n>\d+)\. Other</h2>"), "<h2 id=\"other\">\\g<n>. Khác</h2>"),
    (re.compile(r"<a href=\"#other\">Other</a>"), "<a href=\"#other\">Khác</a>"),
    # ── Khối tầng kiến trúc + luồng chính ──────────────────────────────────────────────────────
    (re.compile(r"<h4>Architecture Layers</h4>"), "<h4>Các tầng kiến trúc</h4>"),
    (re.compile(r"<tr><th>Layer</th><th>Nodes</th><th>Communities</th></tr>"),
     "<tr><th>Tầng</th><th>Nút</th><th>Cộng đồng</th></tr>"),
    (re.compile(r"<h4>Core Flow</h4>"), "<h4>Luồng chính</h4>"),
    (re.compile(r">Graph nodes -> documentation<"), ">Các nút đồ thị -> tài liệu<"),
    # ── Mở đầu mỗi phần (template cứng, không qua pick_text) ───────────────────────────────────
    (re.compile(r"(?P<name>[^<>]+) groups implementation around (?P<kw>[^<>]+), mostly in "
                r"(?P<files>[^<>]+)\. This section covers (?P<n>\d+) nodes and (?P<e>\d+) internal edges; "
                r"the diagram shows only representative relationships to stay readable\."),
     _section_intro),
    # ── Bảng chi tiết lời gọi ──────────────────────────────────────────────────────────────────
    (re.compile(r"<h3>Call Details</h3>"), "<h3>Chi tiết lời gọi</h3>"),
    (re.compile(r"<th style=\"width:28%\">Node</th>"), "<th style=\"width:28%\">Nút</th>"),
    (re.compile(r"<th style=\"width:10%\">Type</th>"), "<th style=\"width:10%\">Loại</th>"),
    (re.compile(r"<th style=\"width:17%\">Caller</th>"), "<th style=\"width:17%\">Nơi gọi</th>"),
    (re.compile(r"<th style=\"width:20%\">Callees</th>"), "<th style=\"width:20%\">Được gọi</th>"),
    (re.compile(r"<th style=\"width:20%\">Description</th>"), "<th style=\"width:20%\">Mô tả</th>"),
    (re.compile(r"<td>External entry / no inbound edge</td>"), "<td>Điểm vào ngoài / không có cạnh vào</td>"),
    (re.compile(r"<td>No direct outbound edge</td>"), "<td>Không có cạnh ra trực tiếp</td>"),
    (re.compile(r"<td>Module file in (?P<source>[^<>]+)\.</td>"), "<td>Tệp mô-đun trong \\g<source>.</td>"),
    (re.compile(r"<td>Design note for (?P<label>[^<>]+)\.</td>"), "<td>Ghi chú thiết kế cho \\g<label>.</td>"),
    (re.compile(r"<td>Documentation node describing (?P<label>[^<>]+)\.</td>"),
     "<td>Nút tài liệu mô tả \\g<label>.</td>"),
    (re.compile(r"<td>(?P<label>[^<>]+?) node in (?P<source>[^<>]+)\.</td>"),
     "<td>Nút \\g<label> trong \\g<source>.</td>"),
    # ── Thẻ (File / Coverage / Design Notes) ───────────────────────────────────────────────────
    (re.compile(r"<h4>Key Files</h4>"), "<h4>Tệp chính</h4>"),
    (re.compile(r"<tr><th>File</th><th>Coverage</th></tr>"), "<tr><th>Tệp</th><th>Độ phủ</th></tr>"),
    (re.compile(r"<td colspan=\"2\">No source file mapping</td>"), "<td colspan=\"2\">Không có tệp nguồn</td>"),
    (re.compile(r"<h4>Design Notes</h4>"), "<h4>Ghi chú thiết kế</h4>"),
    (re.compile(r"No high-confidence call edges detected"), "Không phát hiện cạnh gọi có độ tin cậy cao"),
    # ── Thống kê dự án + chân trang ────────────────────────────────────────────────────────────
    (re.compile(r"<h2 id=\"stats\">Project Statistics</h2>"), "<h2 id=\"stats\">Thống kê dự án</h2>"),
    (re.compile(r"<h4>Graph</h4>"), "<h4>Đồ thị</h4>"),
    (re.compile(r"<tr><td>Nodes</td>"), "<tr><td>Nút</td>"),
    (re.compile(r"<tr><td>Edges</td>"), "<tr><td>Cạnh</td>"),
    (re.compile(r"<tr><td>Hyperedges</td>"), "<tr><td>Siêu cạnh</td>"),
    (re.compile(r"<tr><td>Communities</td>"), "<tr><td>Cộng đồng</td>"),
    (re.compile(r"<tr><td>Documented Sections</td>"), "<tr><td>Phần đã ghi tài liệu</td>"),
    (re.compile(r"<h4>Edge Confidence</h4>"), "<h4>Độ tin cậy của cạnh</h4>"),
    (re.compile(r" — Architecture Documentation</p>"), " — Tài liệu kiến trúc</p>"),
    (re.compile(r"Generated: (?P<ts>[^<]+) · graphify callflow-html"), "Tạo lúc: \\g<ts> · graphify callflow-html"),
    # ── Siêu cạnh (chỉ có khi đồ thị có hyperedge) ─────────────────────────────────────────────
    (re.compile(r"<h2 id=\"hyperedges\">Group Relationships \(Hyperedges\)</h2>"),
     "<h2 id=\"hyperedges\">Quan hệ nhóm (Siêu cạnh)</h2>"),
    (re.compile(r" — (?P<n>\d+) participants</p>"), " — \\g<n> thành viên</p>"),
    (re.compile(r"<li>\.\.\. and (?P<n>\d+) more</li>"), "<li>... và \\g<n> nữa</li>"),
]


def localize_callflow_html(html: str, lang: str) -> str:
    """Dịch HTML callflow sang tiếng Việt khi `lang=\"vi\"`; ngôn ngữ khác trả nguyên bản."""
    if lang != "vi":
        return html
    for pattern, replacement in _RULES:
        html = pattern.sub(replacement, html)  # type: ignore[arg-type]
    html = _NOTE.sub(_section_note, html)
    # Tên phần do graphify đặt theo mẫu (archetype) và nhãn cụm dự phòng.
    for en, vi in _SECTION_NAMES.items():
        html = html.replace(en, vi)
    html = re.sub(r">Community (?P<n>\d+)<", r">Cộng đồng \g<n><", html)
    html = re.sub(r"<small>(?P<n>\d+) nodes</small>", r"<small>\g<n> nút</small>", html)
    html = re.sub(r"<td>(?P<n>\d+) nodes</td>", r"<td>\g<n> nút</td>", html)
    html = re.sub(r"<span class=\"tag (?P<cls>tag-[a-z]+)\">(?P<label>[^<>]+)</span>",
                  lambda m: f'<span class="tag {m["cls"]}">{_TAGS.get(m["label"], m["label"])}</span>', html)
    for en, vi in _DESCRIPTIONS.items():
        html = html.replace(f"<td>{en}</td>", f"<td>{vi}</td>")
    # Nhãn cạnh trong sơ đồ Mermaid: `-->|calls|` → `-->|gọi|`.
    html = re.sub(r"\|(?P<rel>" + "|".join(_RELATIONS) + r")\|",
                  lambda m: f"|{_RELATIONS[m['rel']]}|", html)
    return html
