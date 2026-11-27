"""Tool tệp của MCP (`read_file`, `grep`, `glob`): thay `read`/`grep`/`glob` của OpenCode cho Nex.

Bất biến: agent không đọc, không tìm thấy, không thấy tên tệp bị loại khỏi AI (tên nhạy cảm, mẫu loại trừ
của người dùng, `.gitignore`, ngoài dự án, symlink); tài liệu và cấu hình trả bản đã che secret, và `grep`
tìm trên bản đã che nên không dò được giá trị secret.
"""
import os
import time

import pytest

from nexgraph_engine.interfaces.mcp.server import build_server
from support import call, payload

PASSWORD = "hunter2supersecret"
TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"
ENV_VALUE = "env-value-must-not-leak"


def _index(api, root, exclude):
    pid = api.open(root)["project_id"]
    job = api.post(f"/v1/projects/{pid}/index", json={"exclude": exclude}).json()["job_id"]
    end = time.time() + 30
    while time.time() < end:
        state = api.get(f"/v1/jobs/{job}").json()["state"]
        if state in ("done", "error", "cancelled"):
            assert state == "done"
            return
        time.sleep(0.02)
    raise AssertionError("job không kết thúc")


@pytest.fixture
def project(api, tmp_path):
    root = tmp_path / "Dự án có dấu"
    (root / "docs").mkdir(parents=True)
    (root / "private").mkdir()
    (root / "node_modules" / "pkg").mkdir(parents=True)
    (root / "app.py").write_text("def login(user):\n    return check(user)\n", encoding="utf-8")
    (root / "config.yaml").write_text(f"name: demo\npassword: {PASSWORD}\n", encoding="utf-8")
    (root / "docs" / "readme.md").write_text(f"# Demo\n\ntoken: {TOKEN}\n", encoding="utf-8")
    (root / ".env").write_text(f"SECRET={ENV_VALUE}\n", encoding="utf-8")
    (root / "id_rsa").write_text(f"{ENV_VALUE}\n", encoding="utf-8")
    (root / "private" / "notes.py").write_text(f"X = '{ENV_VALUE}'\n", encoding="utf-8")
    (root / "ignored.log").write_text(f"{ENV_VALUE}\n", encoding="utf-8")
    (root / "node_modules" / "pkg" / "index.js").write_text(f"// {ENV_VALUE}\n", encoding="utf-8")
    (root / ".gitignore").write_text("*.log\n", encoding="utf-8")
    (root / "blob.bin").write_bytes(b"\x00\x01login\x00")
    outside = tmp_path / "ngoai.py"
    outside.write_text(f"X = '{ENV_VALUE}'\n", encoding="utf-8")
    try:
        os.symlink(outside, root / "link.py")
    except (OSError, NotImplementedError):  # Windows không có quyền tạo symlink
        pass
    _index(api, root, ["private"])
    return build_server(root, tmp_path / "appdata"), root


BLOCKED = (".env", "id_rsa", "private/notes.py", "ignored.log", "node_modules/pkg/index.js", "link.py", "../ngoai.py")


def test_read_file_reads_code_and_lists_only_allowed_entries(project):
    server, _ = project
    code = payload(call(server, "read_file", {"path": "app.py"}))
    assert code["text"].startswith("def login(user):") and code["redacted"] is False
    assert code["start"] == 1 and code["end"] == code["total_lines"] == 2
    listing = payload(call(server, "read_file", {"path": "."}))
    assert listing["kind"] == "directory"
    assert {"app.py", "config.yaml", "docs/", ".gitignore"} <= set(listing["entries"])
    assert not {".env", "id_rsa", "private/", "ignored.log", "node_modules/", "link.py"} & set(listing["entries"])


@pytest.mark.parametrize("path", BLOCKED)
def test_read_file_refuses_excluded_sources(project, path):
    server, _ = project
    result = call(server, "read_file", {"path": path})
    assert result.isError, path
    assert ENV_VALUE not in result.content[0].text


def test_read_file_redacts_documents_and_config(project):
    server, _ = project
    config = payload(call(server, "read_file", {"path": "config.yaml"}))
    assert PASSWORD not in config["text"] and "name: demo" in config["text"] and config["redacted"] is True
    readme = payload(call(server, "read_file", {"path": "docs/readme.md"}))
    assert TOKEN not in readme["text"] and "# Demo" in readme["text"]


def test_read_file_reads_files_created_after_indexing_but_not_binary(project):
    server, root = project
    (root / "new_module.py").write_text("VALUE = 1\n", encoding="utf-8")
    assert payload(call(server, "read_file", {"path": "new_module.py"}))["text"] == "VALUE = 1"
    binary = call(server, "read_file", {"path": "blob.bin"})
    assert binary.isError and "nhị phân" in binary.content[0].text
    ranged = call(server, "read_file", {"path": "app.py", "start": 0})
    assert ranged.isError


def test_grep_never_sees_excluded_files_or_secret_values(project):
    server, _ = project
    hits = payload(call(server, "grep", {"pattern": ENV_VALUE, "literal": True}))
    assert hits["matches"] == []
    for secret in (PASSWORD, TOKEN):  # tìm trên bản đã che: không dò được giá trị
        assert payload(call(server, "grep", {"pattern": secret, "literal": True}))["matches"] == []
    login = payload(call(server, "grep", {"pattern": r"def \w+\(", "include": "*.py"}))
    assert login["matches"] == [{"file": "app.py", "line": 1, "text": "def login(user):"}]
    assert payload(call(server, "grep", {"pattern": "LOGIN", "case_sensitive": False, "path": "docs"}))["matches"] == []
    bad = call(server, "grep", {"pattern": "("})
    assert bad.isError and "không hợp lệ" in bad.content[0].text


def test_glob_lists_only_allowed_files(project):
    server, root = project
    everything = set(payload(call(server, "glob", {"pattern": "*"}))["files"])
    assert {"app.py", "config.yaml", "docs/readme.md", ".gitignore", "blob.bin"} <= everything
    assert not set(BLOCKED) & everything
    assert payload(call(server, "glob", {"pattern": "*.md", "path": "docs"}))["files"] == ["docs/readme.md"]
    (root / "b.py").write_text("B = 1\n", encoding="utf-8")
    capped = payload(call(server, "glob", {"pattern": "*.py", "limit": 1}))
    assert capped["files"] == ["app.py"] and capped["truncated"] is True
