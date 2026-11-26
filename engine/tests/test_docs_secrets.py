"""GFY-08: che secret trong tài liệu — chỉ che tên khoá nhạy cảm thật, không che định danh kỹ thuật."""
import subprocess
from pathlib import Path

import pytest

from nexgraph_engine.indexing.docs.secrets import redact_doc_secrets

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


# Re-review #52 Important 1 (vòng 3): các dạng tài liệu từng lọt — JSON, gạch đầu dòng, cả dòng bọc ngoặc,
# câu văn có backtick, `*_KEY` tiền tố lạ với giá trị ngắn.
@pytest.mark.parametrize("line,secret", [
    ('{"secret_key": "Json4Pq9Xy2Lk6Q"}', "Json4Pq9Xy2Lk6Q"),
    ('  "api_key": "Json4Pq9Xy2Lk6Q",', "Json4Pq9Xy2Lk6Q"),
    ('{"MASTER_KEY": "Json4Pq9Xy2Lk6Q"}', "Json4Pq9Xy2Lk6Q"),
    ('"aws_secret_access_key": "Aws4Pq9Xy2Lk6Q"', "Aws4Pq9Xy2Lk6Q"),
    ("- `SECRET_KEY=Dash4Pq9Xy2Lk6Q`", "Dash4Pq9Xy2Lk6Q"),
    ("* `DB_PASSWORD=hunter2`", "hunter2"),
    ('"ENCRYPTION_KEY=Quote4Pq9Xy2"', "Quote4Pq9Xy2"),
    ("[SIGNING_KEY=Bracket4Pq9Xy2]", "Bracket4Pq9Xy2"),
    ("Đặt `MASTER_KEY=Prose8Kx2Rt5` trong tệp.", "Prose8Kx2Rt5"),
    ("master_key: Yaml8Kx2Rt5abcd", "Yaml8Kx2Rt5abcd"),
    ("token = 'Single8Kx2Rt5'", "Single8Kx2Rt5"),
    ("TENANT_KEY=abcd1234", "abcd1234"),
    ("FOO_KEY=Zx9Qm2", "Zx9Qm2"),
    ("MY_APP_KEY=hunter2", "hunter2"),
])
def test_redacts_secret_forms_found_in_documents(line, secret):
    out = redact_doc_secrets(line)
    assert secret not in out and "[redacted]" in out, out
    assert out == redact_doc_secrets(out)  # idempotent


@pytest.mark.parametrize("line", [
    '{"key": "value"}',
    '{"name": "NexGraph"}',
    "key: value",
    'sorted(subgraph_nodes, key=relevance, reverse=True)',
    '"token_budget": 4000',
    '{"public_key": "abcd1234"}',
    "Credential = ApiKeyCredential | OAuthCredential",
    "apiKey: 'fake-key',",
    "DB_PASSWORD=<your-password>",
    "API_KEY=${MY_KEY}",
    "API_KEY=***",
    "API_KEY=xxx",
    "SECRET_MODE=null",
    "RETRIES=3",
    "TOKEN_TTL_SECONDS=3600",
    "GITHUB_TOKEN_EXPIRES=3600",
])
def test_document_shapes_without_secret_are_kept(line):
    assert redact_doc_secrets(line) == line


def test_markdown_table_value_column_is_redacted():
    """MIN-52(1): bảng markdown có cột tên khoá nhạy cảm + cột giá trị phải che ô giá trị."""
    rows = [
        "| API_KEY | TblA8Zx2Nq7Vb4Xc9Mp5Rt1 |",
        "| `SECRET_KEY` | TblS3Wn8Qa4Zc7Vb2Xm9Lp6 |",
        "| DATABASE_PASSWORD | TblD7Kx2Nq9Vb4Zc8Rt5Wm3 |",
        "| Biến | Giá trị |\n|---|---|\n| GITHUB_TOKEN | ghp_" + "a" * 36 + " |",
    ]
    for row in rows:
        out = redact_doc_secrets(row)
        assert "[redacted]" in out, out
        assert out.count("|") == row.count("|"), (row, out)
        assert out.count("\n") == row.count("\n"), (row, out)
        assert out == redact_doc_secrets(out)  # idempotent


@pytest.mark.parametrize("row", [
    "| API_KEY | xxx |",           # placeholder trong đề bài: giữ nguyên
    "| API_KEY | *** |",
    "| MAX_TOKENS | 8192 |",
    "| PRIMARY_KEY | id |",
    "| Biến | Giá trị |",
    "|---|---|",
    "| API_KEY | required |",
])
def test_markdown_table_without_secret_is_kept(row):
    assert redact_doc_secrets(row) == row


# Review #58 Important 1: dòng header của bảng markdown có ô 1 là `Token`/`Key`/`Secret` từng bị che
# (`| Token | Purpose |` → `| Token | [redacted] |`), làm hỏng tài liệu đã lập chỉ mục.
@pytest.mark.parametrize("text", [
    "| Token | Purpose |",
    "| Key | Default | Meaning |",
    "| Secret | Source |",
    "| Token | Size | Weight |",
    "| Token | Purpose |\n|---|---|\n| API_KEY | TblA8Zx2Nq7Vb4Xc9Mp5Rt1 |",
    "| Key | Default |\n|:---|---:|",
    "| Secret | Source |\n| :---: | :---: |",
    # Bảng 3+ cột: regex chỉ ăn hai ô đầu, dòng header vẫn phải nhận ra (bản dịch nike/shopify/slack).
    "| Token | Wartość | Zastosowanie |\n|---|---|---|",
    "| Token | Значення | Використання |\n| --- | --- | --- |",
])
def test_markdown_table_header_rows_are_kept(text):
    """Dòng header (dòng kế là `|---|`, kể cả căn lề `:---:`) không phải dữ liệu: giữ nguyên."""
    out = redact_doc_secrets(text)
    assert out.splitlines()[0] == text.splitlines()[0], out
    assert out == redact_doc_secrets(out)


@pytest.mark.parametrize("row", [
    "| Tablet Dikey | 768–1023px |",                        # "Dikey" kết thúc bằng KEY nhưng là từ, không phải khoá
    "| copilot_chat.time_to_first_token | Histogram |",     # ô giá trị là loại metric, không phải secret
    "| gitlab_token | Đọc mã nguồn |",
    "| API Key | string |",
    "| SECRET_KEY | Mandatory |",
    "| api_key | 1024 |",
])
def test_markdown_table_description_cells_are_kept(row):
    """Important 1: chỉ che ô giá trị trông như secret; mô tả chữ, tên loại, số/đơn vị giữ nguyên."""
    assert redact_doc_secrets(row) == row


@pytest.mark.parametrize("row", [
    "| NEO4J_PASSWORD | archviewer123 |",
    "| API_KEY | TblA8Zx2Nq7Vb4Xc9Mp5Rt1 |",
    "| `SECRET_KEY` | TblS3Wn8Qa4Zc7Vb2Xm9Lp6 |",
])
def test_markdown_table_secret_cells_still_redacted(row):
    """Mặt ngược của Important 1: giá trị secret thật trong bảng vẫn bị che."""
    out = redact_doc_secrets(row)
    assert "[redacted]" in out, out
    assert out.count("|") == row.count("|"), (row, out)


def test_prose_with_verb_refresh_is_not_a_secret():
    """MIN-52(4): 'Token: refresh tokens rotate' là câu văn, không phải giá trị bí mật."""
    text = "Token: refresh tokens rotate"
    assert redact_doc_secrets(text) == text
    # Nhưng token thật sau nhãn Token vẫn bị che (không nới luật quá mức).
    real = "Token: Tok8Xq2Lm5Rt9"
    assert real.split(": ")[1] not in redact_doc_secrets(real)


def test_pem_block_keeps_line_count():
    """Minor 1 (review #52): che PEM theo từng dòng để heading sau khối không lệch số dòng."""
    body = "\n".join(["MIIEvQIBADANBgkqhkiG9w0BAQEFAASC" + "A" * 20] * 3)
    text = (f"# Khoá\n\n-----BEGIN RSA PRIVATE KEY-----\n{body}\n"
            "-----END RSA PRIVATE KEY-----\n\n## Sau\n\nNội dung sau.\n")
    out = redact_doc_secrets(text)
    assert out.count("\n") == text.count("\n")
    assert "BEGIN" not in out and "MIIE" not in out
    assert out.splitlines().index("## Sau") == text.splitlines().index("## Sau")
    assert out.count("[redacted]") == 5  # 3 dòng thân + BEGIN + END, mỗi dòng một marker


def test_pem_block_without_end_line_is_redacted():
    """PEM bị cắt (không có dòng END) vẫn che hết phần còn lại, giữ nguyên số dòng."""
    text = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\nAAAA\n"
    out = redact_doc_secrets(text)
    assert "b3BlbnNzaC1rZXk" not in out and "BEGIN" not in out
    assert out.count("\n") == text.count("\n")


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
