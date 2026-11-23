"""GFY-08: che secret trong tài liệu — chỉ che tên khoá nhạy cảm thật, không che định danh kỹ thuật."""
import subprocess
from pathlib import Path

import pytest

from nexgraph_engine.docs.secrets import redact_doc_secrets

REPO = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("line", [
    "token_budget = BUDGET  # default 2000",
    "token_budget=2000",
    "MAX_TOKENS=8192",
    "MAX_TOKENS = 8192",
    "token = compute()",
    "token: string",
    "password_hash: $2b$12$abcdefghijklmnop",
    "TOKENS_PER_REQUEST=10",
    "max_tokens=4096",
    "GITHUB_TOKEN_EXPIRES=3600",
    "The token is rotated nightly",
    # Tên kết thúc bằng KEY nhưng là khái niệm kỹ thuật: khoá chính/ngoại của SQL, khoá sắp xếp, khoá công khai.
    "PRIMARY_KEY = user_id",
    "PRIMARY_KEY=user_id",
    "FOREIGN_KEY = user_id",
    "FOREIGN_KEY=user_id",
    "SORT_KEY=created_at",
    "SORT_KEY: created_at",
    "PUBLIC_KEY=abcd1234",
    "cache_key = user_id",
    "KEYBOARD=us-layout",
])
def test_technical_text_is_not_redacted(line):
    assert redact_doc_secrets(line) == line


@pytest.mark.parametrize("line,secret", [
    ("DB_PASSWORD=hunter2", "hunter2"),
    ('DB_PASSWORD="a b c"', "a b c"),
    ("DB_PASSWORD='a b c'", "a b c"),
    ("API_KEY: \"abc12345\"", "abc12345"),
    ("APIKEY=abc12345", "abc12345"),
    ("export GITHUB_TOKEN=abc12345", "abc12345"),
    ("ACCESS_KEY=abcd1234", "abcd1234"),
    ("PRIVATE_KEY=abcd1234", "abcd1234"),
    ("CLIENT_SECRET=abcd1234", "abcd1234"),
    ("password = \"correct horse\"", "correct horse"),
    # Review #52 Important 1: `SECRET_KEY`/`SECRET_KEY_BASE`/`*_KEY` là tên phổ biến nhất trong .env và tài liệu cấu hình.
    ("SECRET_KEY=django-insecure-a1b2c3d4e5", "django-insecure-a1b2c3d4e5"),
    ("SECRET_KEY_BASE=9f8e7d6c5b4a3210", "9f8e7d6c5b4a3210"),
    ("secret_key_base: 0f1e2d3c4b5a69788796a5b4c3d2e1f0", "0f1e2d3c4b5a69788796a5b4c3d2e1f0"),
    ("MASTER_KEY=abcd1234", "abcd1234"),
    ("ENCRYPTION_KEY=abcd1234", "abcd1234"),
    ("SIGNING_KEY=abcd1234", "abcd1234"),
    ("AUTH_KEY=abcd1234", "abcd1234"),
    ("secretKey = \"abcd1234\"", "abcd1234"),
    ("SOME_RANDOM_KEY=0f1e2d3c4b5a69788796a5b4c3d2e1f0", "0f1e2d3c4b5a69788796a5b4c3d2e1f0"),
])
def test_sensitive_env_values_are_redacted(line, secret):
    out = redact_doc_secrets(line)
    assert secret not in out and "[redacted]" in out
    assert out == redact_doc_secrets(out)  # idempotent


def test_backticks_surrounding_the_value_are_kept():
    """A3 #9: che `api_key=*** không được ăn dấu backtick bao quanh giá trị."""
    value = "abcd" + "1234"
    for line in (f"API_KEY={value}`", f"`API_KEY={value}`", f'`API_KEY="{value}"`'):
        out = redact_doc_secrets(line)
        assert value not in out and "[redacted]" in out, out
        assert out.count("`") == line.count("`"), (line, out)
        assert out.endswith("`") is line.endswith("`"), (line, out)


def test_backticked_line_keeps_closing_tick_when_redacted():
    value = "abcd" + "1234"
    out = redact_doc_secrets(f"`DB_PASSWORD={value}`")
    assert out == "`DB_PASSWORD=[redacted]`"


def test_repo_markdown_has_no_false_positive_redaction():
    """Quét mọi tệp .md của repo: không dòng nào bị đổi (mục tiêu 0 dương tính giả)."""
    listed = subprocess.run(["git", "ls-files", "*.md"], cwd=REPO, capture_output=True, text=True, check=True)
    changed = []
    for rel in listed.stdout.splitlines():
        path = REPO / rel
        if not path.is_file():
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            if redact_doc_secrets(line) != line:
                changed.append(f"{rel}:{number}: {line.strip()}")
    assert changed == []
