"""Tách định danh thành các từ để tìm kiếm (camelCase, PascalCase, snake_case, kebab-case, viết tắt, chữ số)."""
import re

_SEPARATORS = re.compile(r"[\W_]+", re.UNICODE)


def _split_camel(segment: str) -> list[str]:
    parts: list[str] = []
    start = 0
    for i in range(1, len(segment)):
        prev, cur = segment[i - 1], segment[i]
        boundary = (
            (prev.islower() and cur.isupper())
            or (prev.isalpha() and cur.isdigit())
            or (prev.isdigit() and cur.isalpha())
            # "HTTPServer": ranh giới đứng trước chữ hoa cuối của chuỗi viết tắt khi chữ sau nó là chữ thường
            or (prev.isupper() and cur.isupper() and i + 1 < len(segment) and segment[i + 1].islower())
        )
        if boundary:
            parts.append(segment[start:i])
            start = i
    parts.append(segment[start:])
    return [p.lower() for p in parts if p]


def split_identifier(name: str) -> list[str]:
    return [w for seg in _SEPARATORS.split(name) if seg for w in _split_camel(seg)]


def search_keywords(label: str, qualified_name: str) -> str:
    """Từ khoá của một nút cho cột `tu_khoa` của `nut_fts`: các phần của nhãn và tên đầy đủ, bỏ trùng."""
    seen: dict[str, None] = {}
    for word in (*split_identifier(label), *split_identifier(qualified_name)):
        seen.setdefault(word)
    return " ".join(seen)
