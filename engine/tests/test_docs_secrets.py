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
])
def test_sensitive_env_values_are_redacted(line, secret):
    out = redact_doc_secrets(line)
    assert secret not in out and "[redacted]" in out
    assert out == redact_doc_secrets(out)  # idempotent


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
