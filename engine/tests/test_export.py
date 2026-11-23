from pathlib import Path

import pytest

from nexgraph_engine.bridge.to_nx import Scope
from nexgraph_engine.export.run import export_graph


@pytest.mark.parametrize("fmt,expect", [
    ("html", "py_mini app-graph.html"), ("callflow_html", "py_mini app-callflow.html"),
    ("obsidian", "py_mini app-obsidian"), ("wiki", "py_mini app-wiki"), ("svg", "py_mini app-graph.svg"),
    ("graphml", "py_mini app.graphml"), ("cypher", "py_mini app-cypher.txt"), ("json", "py_mini app-graph.json"),
    ("markdown", "py_mini app-GRAPH_REPORT.md")])
def test_export_each_format(copy_fixture, index_project, tmp_path, fmt, expect):
    store, _, _ = index_project(copy_fixture("py_mini"))
    r = export_graph(store, fmt, Scope(), tmp_path, "py_mini app")
    target = tmp_path / expect
    assert str(target) in r.files and target.exists()
    assert (target.is_dir() and any(target.iterdir())) or (target.is_file() and target.stat().st_size > 0)
    assert r.truncated is False


def test_export_does_not_call_llm(copy_fixture, index_project, tmp_path, monkeypatch):
    import shutil
    monkeypatch.setattr(shutil, "which", lambda name, *a, **k: pytest.fail(f"không được dò {name}"))
    store, _, _ = index_project(copy_fixture("py_mini"))
    export_graph(store, "wiki", Scope(), tmp_path, "x")


def test_export_community_scope(copy_fixture, index_project, tmp_path):
    store, _, _ = index_project(copy_fixture("py_mini"))
    cid = store.communities()[0]["id"] if store.communities() else None
    if cid is None:
        pytest.skip("fixture không có cụm")
    r = export_graph(store, "json", Scope(kind="community", value=f"com:{cid}"), tmp_path, "x")
    assert r.files


def _indexed(api, copy_fixture):
    pid = api.open(copy_fixture("py_mini"))["project_id"]
    assert api.index(pid)["state"] == "done"
    return pid


def test_export_route_ok(api, copy_fixture, tmp_path):
    pid = _indexed(api, copy_fixture)
    r = api.post(f"/v1/projects/{pid}/export", json={"format": "json", "scope": {"kind": "all"}, "out_dir": str(tmp_path)})
    assert r.status_code == 200 and r.json()["files"] and r.json()["truncated"] is False


def test_markdown_export_uses_requested_node_scope(api, tmp_path):
    root = tmp_path / "Đồ án nguồn"
    root.mkdir()
    (root / "left.py").write_text("def selected_symbol():\n    return 1\n", encoding="utf-8")
    (root / "right.py").write_text("def unrelated_symbol():\n    return 2\n", encoding="utf-8")
    pid = api.open(root)["project_id"]
    assert api.index(pid)["state"] == "done"
    base = f"/v1/projects/{pid}"
    search = api.get(f"{base}/search", params={"q": "selected_symbol", "kinds": "function"})
    selected = next(row["node"]["id"] for row in search.json() if row["node"]["label"] == "selected_symbol")

    def export(scope):
        result = api.post(f"{base}/export", json={"format": "markdown", "scope": scope, "out_dir": str(tmp_path)})
        assert result.status_code == 200, result.text
        return Path(result.json()["files"][0]).read_text(encoding="utf-8")

    full = export({"kind": "all"})
    assert "unrelated_symbol" in full and "- 2 files" in full
    scoped = export({"kind": "node", "value": selected})
    assert "selected_symbol" in scoped and "- 1 files" in scoped
    assert "unrelated_symbol" not in scoped and "right.py" not in scoped


@pytest.mark.parametrize("scope", [
    {"kind": "node", "value": "unknown-node"},
    {"kind": "community", "value": "com:999999"},
    {"kind": "community", "value": "com:" + "9" * 30},
])
def test_invalid_markdown_scope_does_not_write_full_report(api, copy_fixture, tmp_path, scope):
    pid = _indexed(api, copy_fixture)
    output = tmp_path / "exports"
    output.mkdir()
    result = api.post(f"/v1/projects/{pid}/export", json={"format": "markdown", "scope": scope, "out_dir": str(output)})
    assert result.status_code == 404 and result.json()["error"]["code"] == "unknown_scope"
    assert list(output.iterdir()) == []


@pytest.mark.parametrize("out_dir", ["relative/dir", "/nonexistent/nexgraph-x"])
def test_export_route_bad_out_dir(api, copy_fixture, out_dir):
    pid = _indexed(api, copy_fixture)
    r = api.post(f"/v1/projects/{pid}/export", json={"format": "json", "scope": {"kind": "all"}, "out_dir": out_dir})
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_path"


def test_export_route_unindexed(api, tmp_path):
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "a.py").write_text("x = 1\n")
    pid = api.open(tmp_path / "src")["project_id"]
    r = api.post(f"/v1/projects/{pid}/export", json={"format": "json", "scope": {"kind": "all"}, "out_dir": str(tmp_path)})
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_indexed"


@pytest.mark.parametrize("uri", [
    "http://127.0.0.1:7474", "https://example.com", "file:///etc/passwd",
    "http://169.254.169.254/latest/meta-data", "khong-co-scheme", "javascript:alert(1)",
])
def test_push_rejects_unsupported_scheme(api, copy_fixture, uri):
    pid = _indexed(api, copy_fixture)
    r = api.post(f"/v1/projects/{pid}/export/push",
                 json={"target": "neo4j", "uri": uri, "user": "neo4j", "password": "s3cret-pw-scheme", "scope": {"kind": "all"}})
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_param"
    assert "s3cret-pw-scheme" not in r.text


@pytest.mark.parametrize("uri", ["bolt://h:7687", "bolt+s://h", "neo4j://h", "neo4j+s://h", "redis://h", "rediss://h"])
def test_validate_push_uri_allows_driver_schemes(uri):
    from nexgraph_engine.export.run import validate_push_uri
    assert validate_push_uri(uri) == uri.split("://")[0]


def test_export_route_obeys_export_root(api, copy_fixture, tmp_path, monkeypatch):
    pid = _indexed(api, copy_fixture)
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    monkeypatch.setenv("NEXGRAPH_EXPORT_ROOT", str(allowed))
    body = {"format": "json", "scope": {"kind": "all"}, "out_dir": str(allowed)}
    assert api.post(f"/v1/projects/{pid}/export", json=body).status_code == 200
    body["out_dir"] = str(tmp_path)  # thư mục cha nằm ngoài root được phép
    r = api.post(f"/v1/projects/{pid}/export", json=body)
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_path"


def test_push_unreachable_server(api, copy_fixture):
    pid = _indexed(api, copy_fixture)
    r = api.post(f"/v1/projects/{pid}/export/push",
                 json={"target": "neo4j", "uri": "bolt://127.0.0.1:1", "user": "neo4j", "password": "s3cret-pw", "scope": {"kind": "all"}})
    assert r.status_code == 502 and r.json()["error"]["code"] == "push_failed"
    assert "s3cret-pw" not in r.text  # mật khẩu không lộ trong thông điệp


def test_svg_export_of_graph_over_500_nodes(index_project, tmp_path):
    # networkx.spring_layout chuyển sang ma trận thưa (scipy) khi đồ thị >= 500 nút: lỗi thật trên dự án NestJS.
    root = tmp_path / "big"
    root.mkdir()
    for f in range(3):
        (root / f"m{f}.py").write_text("".join(f"def f{f}_{i}():\n    return f{f}_{(i + 1) % 200}()\n" for i in range(200)))
    store, _, _ = index_project(root)
    r = export_graph(store, "svg", Scope(), tmp_path, "big")
    assert (tmp_path / "big-graph.svg").stat().st_size > 0 and r.files


def test_export_route_unexpected_error_is_json(api, copy_fixture, tmp_path, monkeypatch):
    pid = _indexed(api, copy_fixture)
    import nexgraph_engine.api.routes_export as routes
    monkeypatch.setattr(routes, "export_graph", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    r = api.post(f"/v1/projects/{pid}/export", json={"format": "svg", "scope": {"kind": "all"}, "out_dir": str(tmp_path)})
    assert r.status_code == 500 and r.json()["error"]["code"] == "export_failed" and "boom" in r.json()["error"]["message"]


def test_export_twice_does_not_overwrite_the_first_file(index_project, copy_fixture, tmp_path):
    store, _, _ = index_project(copy_fixture("py_mini"))
    first = Path(export_graph(store, "json", Scope(), tmp_path, "py_mini app").files[0])
    first.write_bytes(b"nguoi dung da sua")
    second = Path(export_graph(store, "json", Scope(), tmp_path, "py_mini app").files[0])
    assert second != first and second.is_file() and second.stat().st_size > 0
    assert first.read_bytes() == b"nguoi dung da sua"  # không ghi đè im lặng


def test_directory_export_twice_keeps_both_dirs(index_project, copy_fixture, tmp_path):
    store, _, _ = index_project(copy_fixture("py_mini"))
    first = Path(export_graph(store, "wiki", Scope(), tmp_path, "app").files[0])
    second = Path(export_graph(store, "wiki", Scope(), tmp_path, "app").files[0])
    assert first != second and first.is_dir() and second.is_dir()
    assert any(first.iterdir()) and any(second.iterdir())


def test_failed_export_leaves_no_placeholder_file(index_project, copy_fixture, tmp_path, monkeypatch):
    from nexgraph_engine.export import run as run_mod

    store, _, _ = index_project(copy_fixture("py_mini"))
    monkeypatch.setattr(run_mod, "_write", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("hỏng")))
    with pytest.raises(RuntimeError):
        run_mod.export_graph(store, "json", Scope(), tmp_path, "py_mini app")
    assert [p.name for p in tmp_path.iterdir() if p.suffix == ".json" or p.name.startswith(".")] == []


_FMT_TARGETS = [
    ("html", "py_mini app-graph.html"), ("callflow_html", "py_mini app-callflow.html"),
    ("obsidian", "py_mini app-obsidian"), ("wiki", "py_mini app-wiki"), ("svg", "py_mini app-graph.svg"),
    ("graphml", "py_mini app.graphml"), ("cypher", "py_mini app-cypher.txt"), ("json", "py_mini app-graph.json"),
    ("markdown", "py_mini app-GRAPH_REPORT.md")]


def _no_hard_links(monkeypatch):
    """Ổ FAT32/exFAT/SMB: `os.link` ném ENOTSUP (đo được trên ổ FAT thật, xem rereview-36)."""
    import errno
    import os

    def unsupported(src, dst, *args, **kwargs):
        raise OSError(errno.ENOTSUP, "Operation not supported", str(src), None, str(dst))

    monkeypatch.setattr(os, "link", unsupported)


@pytest.mark.parametrize("fmt,expect", _FMT_TARGETS)
def test_export_each_format_on_filesystem_without_hard_links(copy_fixture, index_project, tmp_path, monkeypatch, fmt, expect):
    store, _, _ = index_project(copy_fixture("py_mini"))
    _no_hard_links(monkeypatch)
    r = export_graph(store, fmt, Scope(), tmp_path, "py_mini app")
    target = tmp_path / expect
    assert str(target) in r.files and target.exists()
    assert (target.is_dir() and any(target.iterdir())) or (target.is_file() and target.stat().st_size > 0)
    assert [p.name for p in tmp_path.iterdir() if p.name.startswith(".") and p.name.endswith(".tmp")] == []


def test_export_without_hard_links_still_does_not_overwrite(copy_fixture, index_project, tmp_path, monkeypatch):
    store, _, _ = index_project(copy_fixture("py_mini"))
    _no_hard_links(monkeypatch)
    first = Path(export_graph(store, "json", Scope(), tmp_path, "py_mini app").files[0])
    first.write_bytes(b"nguoi dung da sua")
    second = Path(export_graph(store, "json", Scope(), tmp_path, "py_mini app").files[0])
    assert second.name == "py_mini app-graph-2.json"
    assert first.read_bytes() == b"nguoi dung da sua" and second.stat().st_size > 0


def test_hard_kill_during_write_leaves_no_destination_file(copy_fixture, index_project, tmp_path):
    """SIGKILL giữa lúc ghi (mất điện): tên đích chưa được tạo, không có tệp dở 0 byte/dở dang.

    Mô phỏng đúng lỗi thật của head 4705df3: tên đích được giữ chỗ rồi ghi trực tiếp vào đó, kill cứng
    để lại `py_mini app-graph.json` dở (reviewer đo 12 byte). Trên code hiện tại chữ dở chỉ nằm ở tệp tạm ẩn.
    """
    import signal
    import subprocess
    import sys

    store, _, _ = index_project(copy_fixture("py_mini"))
    db = store.conn.execute("PRAGMA database_list").fetchone()[2]
    out = tmp_path / "out"
    out.mkdir()
    script = (
        "import os, signal, sqlite3\n"
        "from pathlib import Path\n"
        "from nexgraph_engine.bridge.to_nx import Scope\n"
        "from nexgraph_engine.store.graph_store import GraphStore\n"
        "import nexgraph_engine.export.run as run\n"
        "\n"
        "def half_then_kill(store, fmt, scope, target, project_name, gx):\n"
        "    with open(target, 'wb') as fh:\n"
        "        fh.write(b'x' * 4096)\n"
        "        fh.flush()\n"
        "        os.fsync(fh.fileno())\n"
        "        os.kill(os.getpid(), signal.SIGKILL)\n"
        "\n"
        "run._write = half_then_kill\n"
        f"conn = sqlite3.connect({db!r})\n"
        f"run.export_graph(GraphStore(conn), 'json', Scope(), Path({str(out)!r}), 'py_mini app')\n"
    )
    proc = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, timeout=120)
    assert proc.returncode == -signal.SIGKILL, (proc.returncode, proc.stderr[-800:])
    assert [p.name for p in out.iterdir() if not p.name.startswith(".")] == []


def test_export_cleans_stale_temp_files_left_by_killed_runs(copy_fixture, index_project, tmp_path):
    """Tệp `.{tên}.*.tmp` còn lại do lần xuất bị kill phải được dọn khi xuất lần sau vào cùng thư mục."""
    import os
    import time

    store, _, _ = index_project(copy_fixture("py_mini"))
    stale = tmp_path / ".py_mini app-graph.json.deadbeef.tmp"
    stale.write_bytes(b"rac cua lan xuat bi kill")
    os.utime(stale, (time.time() - 7200, time.time() - 7200))  # cũ hơn 1 giờ
    fresh = tmp_path / ".py_mini app-graph.json.cafebabe.tmp"
    fresh.write_bytes(b"dang ghi do")
    export_graph(store, "json", Scope(), tmp_path, "py_mini app")
    assert not stale.exists()
    assert fresh.exists(), "tệp tạm mới (< 1 giờ) có thể của tiến trình khác đang ghi, không được xoá"
