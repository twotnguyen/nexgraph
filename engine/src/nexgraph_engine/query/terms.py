"""Tách từ và khớp định danh cho câu hỏi tiếng Việt (A4-F4/MIN).

`graphify.serve._query_terms` chỉ biết từ dừng tiếng Anh; câu tiếng Việt thuần đi tiếp vào bộ chấm
điểm và có thể khớp chuỗi con 2–3 ký tự sau khi bỏ dấu (`thế` → `the` nằm trong `other`). Ở lớp
NexGraph: bỏ từ dừng tiếng Việt, chỉ nhận hạt giống khớp theo ranh giới từ/định danh, và trả gợi ý
thân thiện khi không có từ nào khớp.
"""
from __future__ import annotations

import re
import unicodedata

from nexgraph_engine.index.keywords import split_identifier

NO_MATCH_SUGGESTION = (
    "Chưa khớp từ khoá nào trong đồ thị. Hãy hỏi bằng tên hàm/lớp/tệp hoặc định danh tiếng Anh, "
    "ví dụ: “login”, “AuthService”, “auth_service.dart”."
)

# Dạng đã bỏ dấu; chỉ áp cho câu có ký tự tiếng Việt để không đụng từ dừng tiếng Anh của Graphify.
VI_STOPWORDS = frozenset("""
la lam sao the nao gi cua cho voi trong mot cac nhung nguoi dung va thi ma o ra vao toi tu den
khi nhu de co khong duoc bi boi tai hay hoac neu vay nay do day roi cung chi con rat qua nhieu
it moi cai ai dau bao bang len xuong sang lai di xem biet hieu giup nhi oi a u
""".split())

_WORD = re.compile(r"\w+", re.UNICODE)


def fold(text: str) -> str:
    """Bỏ dấu tiếng Việt đúng cách (NFKD + đ/Đ) và hạ chữ thường."""
    text = str(text).replace("đ", "d").replace("Đ", "D")
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch)).lower()


def has_vietnamese(text: str) -> bool:
    """Câu có ký tự ngoài ASCII (dấu tiếng Việt) — cờ để bật bộ lọc từ dừng."""
    return any(ord(ch) > 127 for ch in text)


def has_words(text: str) -> bool:
    return bool(_WORD.search(text))


def is_vi_stopword(token: str) -> bool:
    return fold(token) in VI_STOPWORDS


def drop_vi_stopwords(tokens: list[str], question: str) -> list[str]:
    if not has_vietnamese(question):
        return tokens
    return [token for token in tokens if not is_vi_stopword(token)]


def _name_tokens(name: str) -> list[str]:
    return [fold(piece) for piece in split_identifier(name)]


def name_matches(name: str, term: str) -> bool:
    """True nếu `term` trùng cả tên/token, hoặc là tiền tố ≥4 ký tự của một token."""
    folded = fold(term)
    if not folded:
        return False
    tokens = _name_tokens(name)
    if folded in tokens or folded == fold(name) or folded == "".join(tokens):
        return True
    return len(folded) >= 4 and any(token.startswith(folded) for token in tokens)


def seed_matches(label: str, qualified_name: str, source_file: str, terms: list[str]) -> bool:
    """Hạt giống chỉ hợp lệ khi khớp ranh giới với nhãn, tên đầy đủ hoặc đường dẫn tệp."""
    names = [value for value in (label, qualified_name, source_file) if value]
    return any(name_matches(name, term) for name in names for term in terms)
