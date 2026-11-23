"""Che secret trong chữ tài liệu: mẫu token của graphify + mẫu `KEY[:=]value` tên nhạy cảm (GFY-08).

`graphify.security.redact_secrets` chỉ bắt hình dạng token của nhà cung cấp (AKIA…, ghp_…, sk-…).
Tài liệu hay dán nguyên khối `.env`, JSON cấu hình hoặc câu văn có backtick nên thêm mẫu tìm `TÊN_KHOÁ[:=]giá trị`
**không neo đầu dòng**: dòng `.env`/`export`, YAML, JSON `"key": "value"`, gạch đầu dòng `- `, cả dòng bọc
ngoặc kép/đơn/ngoặc vuông, và câu văn kiểu ``Đặt `API_KEY=…` trong tệp``. Chỉ che khi **tên khoá** nhạy cảm
(PASSWORD/SECRET/TOKEN/PWD/CREDENTIAL(S)/KEY đứng độc lập hoặc làm hậu tố, không phải `TOKENS`, `token_budget`)
**và** giá trị trông như giá trị cấu hình, để `token = compute()`, `token: string`, `token_budget = BUDGET`,
`MAX_TOKENS=8192` trong tài liệu kỹ thuật không bị che nhầm. Tên kết thúc bằng `KEY` bị coi là nhạy cảm trừ
danh sách trắng khái niệm kỹ thuật (`PRIMARY_KEY`, `FOREIGN_KEY`, `SORT_KEY`, `CACHE_KEY`…); tên `KEY` trần
chỉ che khi đứng ở vị trí gán cấu hình (đầu dòng/bullet/ngoặc), không che tham số `key=` trong code.
"""
from __future__ import annotations

import re

from graphify.security import redact_secrets

REDACTED = "[redacted]"
# Hậu tố tên khoá nhạy cảm, so sau khi bỏ mọi ký tự không phải chữ/số: `DB_PASSWORD` → `DBPASSWORD`.
# `TOKENS` không khớp `TOKEN` (khác ký tự cuối), `token_budget` → `TOKENBUDGET` cũng không khớp.
_SENSITIVE_SUFFIXES = ("PASSWORD", "PASSWD", "PWD", "PASSPHRASE", "SECRET", "TOKEN",
                       "CREDENTIALS", "CREDENTIAL", "KEYBASE", "KEY")
# Tên kết thúc bằng KEY nhưng là khái niệm kỹ thuật (SQL, sắp xếp, cache, khoá công khai): giữ nguyên.
# Từ tiếng Anh thường gặp (monkey, turkey…) cũng nằm đây để không che nhầm câu văn.
_NON_SECRET_KEY_COMPOUNDS = frozenset({
    "PRIMARYKEY", "FOREIGNKEY", "SORTKEY", "SORTINGKEY", "PARTITIONKEY", "CLUSTERKEY", "SHARDKEY",
    "GROUPKEY", "GROUPINGKEY", "CACHEKEY", "HASHKEY", "INDEXKEY", "ROWKEY", "MAPKEY", "DICTKEY",
    "LOOKUPKEY", "CANDIDATEKEY", "COMPOSITEKEY", "UNIQUEKEY", "PUBLICKEY", "KEYBOARDKEY", "HOTKEY",
    "SHORTCUTKEY", "NODEKEY", "FIELDKEY", "OBJECTKEY", "ARRAYKEY", "JOINKEY", "MERGEKEY", "BRANCHKEY",
    "ROUTINGKEY", "MONKEY", "TURKEY", "HOCKEY", "DONKEY", "WHISKEY", "JOCKEY",
})
_KEY = r"[A-Za-z_][A-Za-z0-9_.-]*"
_VALUE = r'"[^"\n]*"|\'[^\'\n]*\'|`[^`\n]*`|[^\s,;}\]\)"\'`]+'
_CLOSE = "[" + '"' + "'" + "]?"
# Tên khoá + dấu đóng ngoặc (nếu JSON kiểu `"key":`) + `:`/`=` + giá trị. Không neo `^`: dạng JSON, bullet,
# câu văn đều khớp. `(?![=>])` để `==`/`=>` của code không bị nhận là phép gán cấu hình.
_ASSIGN = re.compile(
    rf"(?<![A-Za-z0-9_.-])(?P<key>{_KEY})(?P<close>{_CLOSE})"
    r"(?P<sep>[ \t]*(?::=|:|=)(?![=>])[ \t]*)(?P<value>" + _VALUE + ")")
# Giá trị có ký tự cú pháp là code/biểu thức (kể cả `|` của union type), không phải giá trị cấu hình.
_OBVIOUS_CODE = re.compile(r"[(){}[\]<>|]|=>|::|^\$|^%")
_TYPE_WORDS = frozenset({"string", "number", "boolean", "any", "unknown", "void", "null", "undefined",
                         "true", "false", "none", "str", "int", "bool", "float", "never", "object"})
# Tên biến được nhắc làm giá trị (`NEXGRAPH_TOKEN: token`) — tham chiếu, không phải bí mật.
_REFERENCE_WORDS = frozenset({"token", "secret", "password", "passwd", "pwd", "value", "key",
                              "credentials", "credential", "apikey", "env"})
# Định danh viết hoa (`BUDGET`, `MAX_TOKENS_VALUE`) là hằng/tham chiếu; số ≤ 6 chữ số là cổng/giới hạn.
_CONSTANT = re.compile(r"^[A-Z][A-Z0-9_]*$")
_SMALL_NUMBER = re.compile(r"^\d{1,6}$")
_PLACEHOLDER = re.compile(r"^[xX*.\-…]+$")
# Giá trị minh hoạ trong tài liệu: `fake-key`, `your-token`, `sk-…`…
_PLACEHOLDER_HINTS = ("fake", "dummy", "example", "placeholder", "sample", "changeme", "redacted",
                      "your-", "your_", "…")
# `ApiKeyCredential`, `OAuthCredential`: tên kiểu/lớp trong code, không phải khoá.
_TYPE_NAME = re.compile(r"^[A-Z][A-Za-z]*[a-z][A-Z][A-Za-z]*$")
# `key=` trần chỉ là cấu hình khi đứng đầu dòng/bullet/sau `export`/ngoặc mở; `sorted(x, key=y)` thì không.
_BARE_KEY_PREFIX = re.compile(r"^[ \t]*(?:[-*+>][ \t]+)?(?:export[ \t]+)?[`" + '"' + r"'\[" + r"]*$")

def _key_rule(key: str) -> bool:
    compact = re.sub(r"[^A-Z0-9]", "", key.upper())
    if compact in _NON_SECRET_KEY_COMPOUNDS:
        return False
    return any(compact.endswith(suffix) for suffix in _SENSITIVE_SUFFIXES)


def _looks_like_secret(value: str) -> bool:
    lowered = value.lower()
    if (len(value) < 4 or _PLACEHOLDER.match(value) or _CONSTANT.match(value)
            or _SMALL_NUMBER.match(value) or lowered in _TYPE_WORDS or lowered in _REFERENCE_WORDS
            or _TYPE_NAME.match(value)):
        return False
    if any(hint in lowered for hint in _PLACEHOLDER_HINTS):
        return False
    return not _OBVIOUS_CODE.search(value)


def redact_doc_secrets(text: str) -> str:
    """Trả `text` đã che token theo hình dạng và `KEY[:=]value` của tên khoá nhạy cảm."""
    text = redact_secrets(text)

    def repl(match: re.Match[str]) -> str:
        key = match.group("key")
        if not _key_rule(key):
            return match.group(0)
        if re.sub(r"[^A-Z0-9]", "", key.upper()) == "KEY":
            line_start = text.rfind("\n", 0, match.start("key")) + 1
            if not _BARE_KEY_PREFIX.match(text[line_start:match.start("key")]):
                return match.group(0)
        raw = match.group("value")
        quote = raw[0] if raw[:1] in ("'", '"', "`") else ""
        value = raw[1:-1] if quote else raw
        if not _looks_like_secret(value):
            return match.group(0)
        return f"{key}{match.group('close')}{match.group('sep')}{quote}{REDACTED}{quote}"

    return _ASSIGN.sub(repl, text)
