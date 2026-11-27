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


# ── Sửa sau review độc lập của #101 ───────────────────────────────────────────

def test_mcp_config_and_manifests_are_redacted(project):
    """`.mcp.json` mang token server MCP; engine gọi nó là `mcp_config`, không phải mã nguồn."""
    server, root = project
    (root / ".mcp.json").write_text(f'{{"mcpServers": {{"gh": {{"env": {{"GITHUB_TOKEN": "{TOKEN}"}}}}}}}}\n',
                                    encoding="utf-8")
    (root / "pyproject.toml").write_text(f'[tool.x]\npassword = "{PASSWORD}"\n', encoding="utf-8")
    for name in (".mcp.json", "pyproject.toml"):
        body = payload(call(server, "read_file", {"path": name}))
        assert TOKEN not in body["text"] and PASSWORD not in body["text"] and body["redacted"] is True, name
    assert payload(call(server, "grep", {"pattern": "ghp_", "literal": True}))["matches"] == []


def test_file_tools_refuse_without_a_completed_index(project, monkeypatch):
    """Lần index đầu bị huỷ/lỗi: `last_exclude()` rỗng, nên không được đọc với chính sách thiếu mẫu loại trừ."""
    from nexgraph_engine.storage.store.graph_store import GraphStore

    server, _ = project
    monkeypatch.setattr(GraphStore, "has_published_graph", lambda self: False)
    for tool, args in (("read_file", {"path": "private/notes.py"}), ("grep", {"pattern": "X"}), ("glob", {"pattern": "*"})):
        result = call(server, tool, args)
        assert result.isError and "lập chỉ mục" in result.content[0].text, tool


def test_glob_and_include_expand_braces(project):
    server, _ = project
    assert set(payload(call(server, "glob", {"pattern": "*.{py,yaml}"}))["files"]) == {"app.py", "config.yaml"}
    hits = payload(call(server, "grep", {"pattern": "name|def", "include": "*.{py,yaml}"}))["matches"]
    assert {hit["file"] for hit in hits} == {"app.py", "config.yaml"}


@pytest.mark.parametrize("pattern", ["(a+)+$", "(a*)*b", "(x|xx)+y", "((ab)*)+c"])
def test_grep_refuses_catastrophic_backtracking(project, pattern):
    server, _ = project
    result = call(server, "grep", {"pattern": pattern})
    assert result.isError and "lồng nhau" in result.content[0].text


def test_grep_accepts_ordinary_patterns(project):
    server, _ = project
    for pattern in (r"def \w+\(", "login|check", r"(?:user)\)", r"^\s+return"):
        assert payload(call(server, "grep", {"pattern": pattern, "include": "*.py"}))["matches"], pattern


def test_missing_search_path_is_an_error(project):
    server, _ = project
    for tool, args in (("grep", {"pattern": "login", "path": "scr"}), ("glob", {"pattern": "*", "path": "scr"})):
        result = call(server, tool, args)
        assert result.isError and "scr" in result.content[0].text, tool


def test_grep_follows_a_symlinked_search_path_inside_the_project(project):
    server, root = project
    try:
        os.symlink(root / "docs", root / "tai-lieu", target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("không tạo được symlink")
    hits = payload(call(server, "grep", {"pattern": "Demo", "path": "tai-lieu"}))["matches"]
    assert [hit["line"] for hit in hits] == [1]


def test_scan_skips_dependency_dirs_unless_asked(project):
    server, root = project
    (root / ".venv" / "lib").mkdir(parents=True)
    (root / ".venv" / "lib" / "dep.py").write_text("def handler():\n    pass\n", encoding="utf-8")
    assert payload(call(server, "grep", {"pattern": "def handler"}))["matches"] == []
    inside = payload(call(server, "grep", {"pattern": "def handler", "path": ".venv"}))["matches"]
    assert [hit["file"] for hit in inside] == [".venv/lib/dep.py"]


def test_read_file_flags_clipped_lines_and_converts_documents(project):
    import docx

    server, root = project
    (root / "min.js").write_text("x" * 3000 + "\n", encoding="utf-8")
    assert payload(call(server, "read_file", {"path": "min.js"}))["clipped"] is True
    assert payload(call(server, "read_file", {"path": "app.py"}))["clipped"] is False
    document = docx.Document()
    document.add_paragraph("Đặc tả đăng nhập")
    document.add_paragraph(f"token: {TOKEN}")
    document.save(root / "spec.docx")
    body = payload(call(server, "read_file", {"path": "spec.docx"}))
    assert "Đặc tả đăng nhập" in body["text"] and TOKEN not in body["text"]
