"""Che secret trong chữ tài liệu: mẫu token của graphify + mẫu `KEY=value` tên nhạy cảm (GFY-08).

`graphify.security.redact_secrets` chỉ bắt hình dạng token của nhà cung cấp (AKIA…, ghp_…, sk-…).
Tài liệu hay dán nguyên khối `.env` nên thêm mẫu `DB_PASSWORD=***`, `API_KEY: "abc"`. Chỉ che khi
**tên khoá** nhạy cảm đúng nghĩa (PASSWORD/SECRET/TOKEN/API_KEY/SECRET_KEY… đứng độc lập hoặc làm hậu tố,
không phải `TOKENS`, `token_budget`) **và** giá trị trông như giá trị cấu hình, để `token = compute()`,
`token: string`, `token_budget = BUDGET`, `MAX_TOKENS=8192` trong tài liệu kỹ thuật không bị che nhầm.
Tên kết thúc bằng `KEY` chỉ bị che khi phần trước là từ khoá bí mật (`MASTER`, `ENCRYPTION`…) hoặc giá trị
trông như khoá sinh ngẫu nhiên, để `PRIMARY_KEY`/`FOREIGN_KEY` của SQL, `SORT_KEY`, `PUBLIC_KEY` không bị che.
"""
from __future__ import annotations

import re

from graphify.security import redact_secrets

# Hậu tố tên khoá nhạy cảm, so sau khi bỏ mọi ký tự không phải chữ/số: `DB_PASSWORD` → `DBPASSWORD`.
# `TOKENS` không khớp `TOKEN` (khác ký tự cuối), `token_budget` → `TOKENBUDGET` cũng không khớp.
# `SECRET_KEY` → `SECRETKEY`, `SECRET_KEY_BASE` → `SECRETKEYBASE` (đuôi `KEYBASE`): tên phổ biến nhất trong
# `.env`/tài liệu cấu hình, trước đây lọt vì không kết thúc bằng `SECRET`.
_SENSITIVE_SUFFIXES = ("PASSWORD", "PASSWD", "PASSPHRASE", "SECRET", "TOKEN", "APIKEY", "ACCESSKEY",
                       "PRIVATEKEY", "CREDENTIAL", "CREDENTIALS", "SECRETKEY", "KEYBASE")
# Tên kết thúc bằng KEY nhưng là khái niệm kỹ thuật (SQL, sắp xếp, cache, khoá công khai): giữ nguyên.
_NON_SECRET_KEY_COMPOUNDS = frozenset({
    "PRIMARYKEY", "FOREIGNKEY", "SORTKEY", "SORTINGKEY", "PARTITIONKEY", "CLUSTERKEY", "SHARDKEY",
    "GROUPKEY", "GROUPINGKEY", "CACHEKEY", "HASHKEY", "INDEXKEY", "ROWKEY", "MAPKEY", "DICTKEY",
    "LOOKUPKEY", "CANDIDATEKEY", "COMPOSITEKEY", "UNIQUEKEY", "PUBLICKEY", "KEYBOARDKEY", "HOTKEY",
    "SHORTCUTKEY", "NODEKEY", "FIELDKEY", "OBJECTKEY", "ARRAYKEY", "JOINKEY", "MERGEKEY", "BRANCHKEY",
    "ROUTINGKEY",
})
# Tiền tố thường gặp của khoá bí mật dạng `*_KEY` (`MASTER_KEY`, `ENCRYPTION_KEY`, `SIGNING_KEY`…).
_SECRET_KEY_PREFIXES = frozenset({
    "MASTER", "ENCRYPTION", "ENCRYPT", "DECRYPT", "SIGNING", "SIGN", "AUTH", "API", "SECRET", "ACCESS",
    "PRIVATE", "SESSION", "JWT", "HMAC", "TOTP", "OTP", "FERNET", "KMS", "SSH", "TLS", "DEPLOY",
    "BACKUP", "RECOVERY", "STORAGE", "SERVICEACCOUNT", "WEBHOOK", "CLIENT", "APP", "SERVER", "DATA",
    "DEK", "KEK", "WIPE", "STRIPE", "LICENSE", "NONCE",
})
# Giá trị trông như khoá sinh ngẫu nhiên (hex/base64, có cả chữ và số): dùng cho `*_KEY` tiền tố lạ.
_RANDOM_KEY_VALUE = re.compile(r"^(?=[A-Za-z0-9+/=_-]*\d)(?=[A-Za-z0-9+/=_-]*[A-Za-z])[A-Za-z0-9+/=_-]{20,}$")
_ENV_LINE = re.compile(
    r"(?im)^([ \t]*(?:export[ \t]+)?`*)([A-Za-z_][A-Za-z0-9_.-]*)([ \t]*[:=][ \t]*)"
    r"(\"[^\"\n]*\"|'[^'\n]*'|`[^`\n]*`|[^\s#\"'`]+)([ \t]*`*[ \t]*(?:#.*)?)$")
# Giá trị có ký tự cú pháp là code/biểu thức, không phải giá trị cấu hình.
_OBVIOUS_CODE = re.compile(r"[(){}[\]<>]|=>|::|^\$|^%")
_TYPE_WORDS = frozenset({"string", "number", "boolean", "any", "unknown", "void", "null", "undefined",
                         "true", "false", "none", "str", "int", "bool", "float", "never", "object"})
# Định danh viết hoa (`BUDGET`, `MAX_TOKENS_VALUE`) và số thuần (`8192`) là hằng/tham chiếu, không phải bí mật.
_CONSTANT = re.compile(r"^(?:[A-Z][A-Z0-9_]*|\d+)$")
_PLACEHOLDER = re.compile(r"^[xX*.\-]+$")


def _key_rule(key: str) -> str:
    """`sensitive` (chắc chắn), `generic` (`*_KEY` lạ, cần giá trị giống khoá sinh ngẫu nhiên) hoặc rỗng."""
    compact = re.sub(r"[^A-Z0-9]", "", key.upper())
    if any(compact.endswith(suffix) for suffix in _SENSITIVE_SUFFIXES):
        return "sensitive"
    if not compact.endswith("KEY") or compact in _NON_SECRET_KEY_COMPOUNDS:
        return ""
    return "sensitive" if compact[:-3] in _SECRET_KEY_PREFIXES else "generic"


def _is_sensitive_key(key: str) -> bool:
    return _key_rule(key) == "sensitive"


def _looks_like_secret(value: str) -> bool:
    if len(value) < 4 or _PLACEHOLDER.match(value) or _CONSTANT.match(value):
        return False
    return not (_OBVIOUS_CODE.search(value) or value.lower() in _TYPE_WORDS)


def redact_doc_secrets(text: str) -> str:
    """Trả `text` đã che token theo hình dạng và `KEY=value` của tên khoá nhạy cảm."""
    text = redact_secrets(text)

    def repl(match: re.Match[str]) -> str:
        rule = _key_rule(match.group(2))
        if not rule:
            return match.group(0)
        raw = match.group(4)
        quote = raw[0] if raw[:1] in ("'", '"') else ""
        value = raw[1:-1] if quote else raw
        if not _looks_like_secret(value) or (rule == "generic" and not _RANDOM_KEY_VALUE.match(value)):
            return match.group(0)
        return f"{match.group(1)}{match.group(2)}{match.group(3)}{quote}[redacted]{quote}{match.group(5)}"

    return _ENV_LINE.sub(repl, text)

