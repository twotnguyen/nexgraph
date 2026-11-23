"""Che secret trong chữ tài liệu: mẫu token của graphify + mẫu `KEY=value` tên nhạy cảm (GFY-08).

`graphify.security.redact_secrets` chỉ bắt hình dạng token của nhà cung cấp (AKIA…, ghp_…, sk-…).
Tài liệu hay dán nguyên khối `.env` nên thêm mẫu `DB_PASSWORD=***`, `API_KEY: "abc"`. Chỉ che khi
giá trị trông như giá trị cấu hình, để `token = compute()` hay `token: string` trong tài liệu kỹ thuật
không bị che nhầm.
"""
from __future__ import annotations

import re

from graphify.security import redact_secrets

_SENSITIVE = (r"(?:pass(?:word|wd)?|secret|token|api[_-]?key|access[_-]?key|private[_-]?key"
              r"|client[_-]?secret|credential)")
_ENV_LINE = re.compile(
    rf"(?im)^([ \t]*(?:export[ \t]+)?[A-Za-z0-9_.-]*{_SENSITIVE}[A-Za-z0-9_.-]*[ \t]*[:=][ \t]*)"
    r"(['\"]?)([^\s'\"#]+)\2([ \t]*(?:#.*)?)$")
# Giá trị có ký tự cú pháp là code/biểu thức, không phải giá trị cấu hình.
_OBVIOUS_CODE = re.compile(r"[(){}[\]<>]|=>|::")
_TYPE_WORDS = frozenset({"string", "number", "boolean", "any", "unknown", "void", "null", "undefined",
                         "true", "false", "none", "str", "int", "bool", "float", "never", "object"})


def redact_doc_secrets(text: str) -> str:
    """Trả `text` đã che token theo hình dạng và `KEY=value` của tên khoá nhạy cảm."""
    text = redact_secrets(text)

    def repl(match: re.Match[str]) -> str:
        value = match.group(3)
        if len(value) < 4 or _OBVIOUS_CODE.search(value) or value.lower() in _TYPE_WORDS:
            return match.group(0)
        quote = match.group(2)
        return f"{match.group(1)}{quote}[redacted]{quote}{match.group(4)}"

    return _ENV_LINE.sub(repl, text)
