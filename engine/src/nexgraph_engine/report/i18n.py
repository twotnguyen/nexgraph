"""Dịch văn bản do Graphify sinh (câu hỏi gợi ý, lý do "bất ngờ") sang tiếng Việt ở lớp NexGraph.

Graphify là mã vendored: không sửa chuỗi trong `graphify/analyze.py`. Route/hàm của NexGraph nhận
`lang=vi|en` rồi hậu xử lý theo khoá chuỗi ở đây; chuỗi không khớp mẫu nào được giữ nguyên để bản
Graphify mới không làm vỡ báo cáo.
"""
from __future__ import annotations

import re

LANGS = ("vi", "en")

_FILE_CATEGORY = {"code": "mã", "doc": "tài liệu", "paper": "bài báo", "image": "ảnh"}

_QUESTIONS = (
    (re.compile(r"^What is the exact relationship between `(?P<a>.+?)` and `(?P<b>.+?)`\?$"),
     "Mối quan hệ chính xác giữa `{a}` và `{b}` là gì?"),
    (re.compile(r"^Edge tagged AMBIGUOUS \(relation: (?P<r>.*)\) - confidence is low\.$"),
     "Cạnh được gắn nhãn AMBIGUOUS (quan hệ: {r}) - độ tin cậy thấp."),
    (re.compile(r"^Why does `(?P<label>.+?)` connect `(?P<a>.+?)` to (?P<rest>.+)\?$"),
     "Vì sao `{label}` nối `{a}` với {rest}?"),
    (re.compile(r"^High betweenness centrality \((?P<score>.+?)\) - this node is a cross-community bridge\.$"),
     "Betweenness centrality cao ({score}) - nút này là cầu nối giữa các cộng đồng."),
    (re.compile(r"^Are the (?P<n>\d+) inferred relationships involving `(?P<label>.+?)` "
                r"\(e\.g\. with `(?P<a>.+?)` and `(?P<b>.+?)`\) actually correct\?$"),
     "{n} quan hệ suy luận liên quan tới `{label}` (ví dụ với `{a}` và `{b}`) có thực sự đúng không?"),
    (re.compile(r"^`(?P<label>.+?)` has (?P<n>\d+) INFERRED edges - "
                r"model-reasoned connections that need verification\.$"),
     "`{label}` có {n} cạnh INFERRED - các kết nối do mô hình suy ra, cần kiểm chứng."),
    (re.compile(r"^What connects (?P<labels>.+?) to the rest of the system\?$"),
     "Điều gì nối {labels} với phần còn lại của hệ thống?"),
    (re.compile(r"^(?P<n>\d+) weakly-connected nodes found - "
                r"(?P<reason>possible documentation gaps or missing edges|possible missing edges)\.$"),
     None),  # hai nhánh lý do, xử lý riêng bên dưới
    (re.compile(r"^Should `(?P<label>.+?)` be split into smaller, more focused modules\?$"),
     "Có nên tách `{label}` thành các mô-đun nhỏ hơn, tập trung hơn không?"),
    (re.compile(r"^Cohesion score (?P<score>.+?) - nodes in this community are weakly interconnected\.$"),
     "Độ gắn kết {score} - các nút trong cộng đồng này liên kết lỏng."),
)

_NO_SIGNAL = (
    "Not enough signal to generate questions. This usually means the corpus has no AMBIGUOUS edges, "
    "no bridge nodes, no INFERRED relationships, and all communities are tightly cohesive. "
    "Add more files or run with --mode deep to extract richer edges."
)
_NO_SIGNAL_VI = (
    "Không đủ tín hiệu để sinh câu hỏi. Điều này thường có nghĩa là corpus không có cạnh AMBIGUOUS, "
    "không có nút cầu nối, không có quan hệ INFERRED và mọi cộng đồng đều gắn kết chặt. "
    "Hãy thêm tệp hoặc chạy với --mode deep để trích xuất nhiều cạnh hơn."
)

_ISOLATED_REASONS = {
    "possible documentation gaps or missing edges": "có thể thiếu tài liệu hoặc thiếu cạnh",
    "possible missing edges": "nghi thiếu cạnh",
}

_WHY_EXACT = {
    "ambiguous connection - not explicitly stated in source":
        "kết nối AMBIGUOUS - không được nêu rõ trong mã nguồn",
    "inferred connection - not explicitly stated in source":
        "kết nối INFERRED - không được nêu rõ trong mã nguồn",
    "connects across different repos/directories": "nối các repo/thư mục khác nhau",
    "bridges separate communities": "bắc cầu giữa các cộng đồng riêng",
    "semantically similar concepts with no structural link":
        "khái niệm tương đồng ngữ nghĩa nhưng không có liên kết cấu trúc",
    "cross-file semantic connection": "kết nối ngữ nghĩa giữa các tệp",
}
_WHY_PATTERNS = (
    (re.compile(r"^crosses file types \((?P<a>[a-z]+) ↔ (?P<b>[a-z]+)\)$"),
     lambda m: f"vượt loại tệp ({_FILE_CATEGORY.get(m['a'], m['a'])} ↔ {_FILE_CATEGORY.get(m['b'], m['b'])})"),
    (re.compile(r"^peripheral node `(?P<a>.+?)` unexpectedly reaches hub `(?P<b>.+?)`$"),
     lambda m: f"nút ngoại vi `{m['a']}` bất ngờ chạm tới hub `{m['b']}`"),
    (re.compile(r"^Bridges graph structure \(betweenness=(?P<score>.+?)\)$"),
     lambda m: f"Bắc cầu cấu trúc đồ thị (betweenness={m['score']})"),
    (re.compile(r"^Bridges community (?P<a>\d+) → community (?P<b>\d+)$"),
     lambda m: f"Bắc cầu cộng đồng {m['a']} → cộng đồng {m['b']}"),
)


def check_lang(lang: str | None, default: str) -> str:
    """Chuẩn hoá `lang` của route; None giữ hành vi cũ của route đó."""
    value = default if lang is None else lang
    if value not in LANGS:
        raise ValueError(f"lang phải là 'vi' hoặc 'en', nhận {value!r}")
    return value


def _translate_question(text: str | None) -> str | None:
    if text is None:
        return None
    if text == _NO_SIGNAL:
        return _NO_SIGNAL_VI
    for pattern, template in _QUESTIONS:
        match = pattern.match(text)
        if match is None:
            continue
        if template is None:  # isolated_nodes: lý do có hai nhánh
            reason = _ISOLATED_REASONS.get(match["reason"])
            if reason is None:
                return text
            return f"Có {match['n']} nút ít kết nối - {reason}."
        return template.format(**match.groupdict())
    return text


def _translate_why(text: str) -> str:
    parts = []
    for segment in text.split("; "):
        translated = _WHY_EXACT.get(segment)
        if translated is None:
            for pattern, render in _WHY_PATTERNS:
                match = pattern.match(segment)
                if match is not None:
                    translated = render(match)
                    break
        parts.append(translated if translated is not None else segment)
    return "; ".join(parts)


def translate_questions(items: list[dict], lang: str) -> list[dict]:
    if lang != "vi":
        return items
    out = []
    for item in items:
        why = item.get("why") or ""
        why_vi = _translate_question(why) if why else why
        if why_vi == why and why:
            why_vi = _translate_why(why)
        out.append({**item, "question": _translate_question(item.get("question")), "why": why_vi})
    return out


def translate_surprising(items: list[dict], lang: str) -> list[dict]:
    if lang != "vi":
        return items
    return [{**item, "why": _translate_why(item["why"]) if item.get("why") else item.get("why", "")}
            for item in items]
