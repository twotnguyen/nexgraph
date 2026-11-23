"""Che secret trong chữ tài liệu: mẫu token của graphify + mẫu `KEY=value` tên nhạy cảm (GFY-08).

`graphify.security.redact_secrets` chỉ bắt hình dạng token của nhà cung cấp (AKIA…, ghp_…, sk-…).
Tài liệu hay dán nguyên khối `.env` nên thêm mẫu `DB_PASSWORD=***`, `API_KEY: "abc"`. Chỉ che khi
**tên khoá** nhạy cảm đúng nghĩa (PASSWORD/SECRET/TOKEN/API_KEY… đứng độc lập hoặc làm hậu tố, không
phải `TOKENS`, `token_budget`) **và** giá trị trông như giá trị cấu hình, để `token = compute()`,
`token: string`, `token_budget = BUDGET`, `MAX_TOKENS=8192` trong tài liệu kỹ thuật không bị che nhầm.
"""
from __future__ import annotations

import re

from graphify.security import redact_secrets

# Hậu tố tên khoá nhạy cảm, so sau khi bỏ mọi ký tự không phải chữ/số: `DB_PASSWORD` → `DBPASSWORD`.
# `TOKENS` không khớp `TOKEN` (khác ký tự cuối), `token_budget` → `TOKENBUDGET` cũng không khớp.
_SENSITIVE_SUFFIXES = ("PASSWORD", "PASSWD", "PASSPHRASE", "SECRET", "TOKEN", "APIKEY", "ACCESSKEY",
                       "PRIVATEKEY", "CREDENTIAL", "CREDENTIALS")
_ENV_LINE = re.compile(
    r"(?im)^([ \t]*(?:export[ \t]+)?)([A-Za-z_][A-Za-z0-9_.-]*)([ \t]*[:=][ \t]*)"
    r"(\"[^\"\n]*\"|'[^'\n]*'|[^\s#'\"]+)([ \t]*(?:#.*)?)$")
# Giá trị có ký tự cú pháp là code/biểu thức, không phải giá trị cấu hình.
_OBVIOUS_CODE = re.compile(r"[(){}[\]<>]|=>|::|^\$|^%")
_TYPE_WORDS = frozenset({"string", "number", "boolean", "any", "unknown", "void", "null", "undefined",
                         "true", "false", "none", "str", "int", "bool", "float", "never", "object"})
# Định danh viết hoa (`BUDGET`, `MAX_TOKENS_VALUE`) và số thuần (`8192`) là hằng/tham chiếu, không phải bí mật.
_CONSTANT = re.compile(r"^(?:[A-Z][A-Z0-9_]*|\d+)$")
_PLACEHOLDER = re.compile(r"^[xX*.\-]+$")


def _is_sensitive_key(key: str) -> bool:
    compact = re.sub(r"[^A-Z0-9]", "", key.upper())
    return any(compact.endswith(suffix) for suffix in _SENSITIVE_SUFFIXES)


def _looks_like_secret(value: str) -> bool:
    if len(value) < 4 or _PLACEHOLDER.match(value) or _CONSTANT.match(value):
        return False
    return not (_OBVIOUS_CODE.search(value) or value.lower() in _TYPE_WORDS)


def redact_doc_secrets(text: str) -> str:
    """Trả `text` đã che token theo hình dạng và `KEY=value` của tên khoá nhạy cảm."""
    text = redact_secrets(text)

    def repl(match: re.Match[str]) -> str:
        if not _is_sensitive_key(match.group(2)):
            return match.group(0)
        raw = match.group(4)
        quote = raw[0] if raw[:1] in ("'", '"') else ""
        value = raw[1:-1] if quote else raw
        if not _looks_like_secret(value):
            return match.group(0)
        return f"{match.group(1)}{match.group(2)}{match.group(3)}{quote}[redacted]{quote}{match.group(5)}"

    return _ENV_LINE.sub(repl, text)
