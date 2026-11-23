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
Khối PEM được che **từng dòng** trước khi gọi `redact_secrets` để heading sau khối không lệch số dòng (Minor 1).
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
                              "credentials", "credential", "apikey", "env",
                              # MIN-52(4): câu văn kiểu "Token: refresh tokens rotate" không phải secret.
                              "refresh", "rotate", "rotated", "refreshed", "renew", "expires", "expired",
                              "required", "optional", "enabled", "disabled", "missing", "revoked"})
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
# Khối PEM: che cả khối kể cả khi thiếu dòng END (bị cắt), giữ nguyên số dòng.
_PEM_BLOCK = re.compile(
    r"(?ms)^[ \t]*-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----"
    r"(?:.*?^[ \t]*-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|.*)")

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


def _redact_pem_blocks(text: str) -> str:
    """Thay mỗi dòng trong khối PEM bằng `[redacted]`, giữ nguyên số dòng để số dòng của tài liệu không lệch."""
    def repl(match: re.Match[str]) -> str:
        block = match.group(0)
        trailing_newline = block.endswith("\n")
        body = block[:-1] if trailing_newline else block
        line_count = body.count("\n") + 1
        return "\n".join([REDACTED] * line_count) + ("\n" if trailing_newline else "")
    return _PEM_BLOCK.sub(repl, text)


# Dòng bảng markdown: `| TÊN_KHOÁ | giá trị |`. Chỉ che ô thứ hai khi ô đầu là tên khoá nhạy cảm và giá trị
# trông như secret (MIN-52(1); `| API_KEY | xxx |` placeholder và `| MAX_TOKENS | 8192 |` giữ nguyên).
_TABLE_ROW = re.compile(r"(?m)^(?P<lead>[ \t]*)\|(?P<key>[^|\n]+)\|(?P<value>[^|\n]*)\|")
# Ô tên khoá phải là một định danh (`API_KEY`, `db.password`, `Stripe secret key`), không phải câu mô tả.
_TABLE_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_.\- ]*$")


def _redact_table_cells(text: str) -> str:
    """Che cột giá trị của bảng markdown khi cột tên khoá là tên nhạy cảm (MIN-52)."""
    def repl(match: re.Match[str]) -> str:
        key = match["key"].strip().strip("`*_\"'")
        if not _TABLE_KEY.match(key) or not _key_rule(key):
            return match.group(0)
        raw = match["value"]
        cell = raw.strip()
        if not cell:
            return match.group(0)
        quote = cell[0] if cell[:1] in ("'", '"', "`") else ""
        value = cell[1:-1] if quote and cell.endswith(quote) and len(cell) > 1 else cell
        # Ô giá trị của bảng secret là một token; câu văn (có khoảng trắng) là mô tả, không che.
        if any(ch.isspace() for ch in value.strip()) or not _looks_like_secret(value):
            return match.group(0)
        lead = raw[:len(raw) - len(raw.lstrip())]
        trail = raw[len(raw.rstrip()):]
        return f"{match['lead']}|{match['key']}|{lead}{quote}{REDACTED}{quote}{trail}|"

    return _TABLE_ROW.sub(repl, text)


def redact_doc_secrets(text: str) -> str:
    """Trả `text` đã che token theo hình dạng, khối PEM và `KEY[:=]value` của tên khoá nhạy cảm."""
    text = redact_secrets(_redact_pem_blocks(text))

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

    text = _ASSIGN.sub(repl, text)
    return _redact_table_cells(text)
