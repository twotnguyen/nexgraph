"""NG-PIPE-3: cập nhật tăng dần khi sửa tệp — `update` của vendor + `replace_files` theo manifest."""
import shutil
import sqlite3
from pathlib import Path

import pytest

from nexgraph_engine.core.schema.db import open_graph_db
from nexgraph_engine.storage.store.graph_store import GraphStore
from nexgraph_engine.storage.store.search import search

FIXTURES = Path(__file__).parents[1] / "fixtures"


@pytest.fixture
def indexed_pipeline(api, tmp_path, monkeypatch):
    """Dự án đã lập chỉ mục bằng pipeline vendor (không dùng fixture `opened` của test legacy)."""
    monkeypatch.setenv("NEXGRAPH_PIPELINE", "graphify")
    root = tmp_path / "Đồ án" / "pipeline app"
    shutil.copytree(FIXTURES / "graphify_import_app", root)
    p = api.open(root)
    assert api.index(p["project_id"], timeout=180)["state"] == "done"
    return root, p["project_id"]


def _store(root: Path) -> tuple[GraphStore, sqlite3.Connection]:
    conn = open_graph_db(root / ".nexgraph" / "graph.db")
    return GraphStore(conn), conn


def test_refresh_reloads_only_the_changed_file(api, indexed_pipeline):
    root, pid = indexed_pipeline
    html = root / ".nexgraph" / "graph.html"
    assert "zzz_added" not in html.read_text(encoding="utf-8")
    store, conn = _store(root)
    try:
        util_before = store.node_ids_of_file("util.ts")
        app_file_pk = store.pk_of("app.py#file")
    finally:
        conn.close()

    source = root / "app.py"
    source.write_text(source.read_text(encoding="utf-8") + "\n\ndef zzz_added(x):\n    return x + 1\n",
                      encoding="utf-8")
    body = api.post(f"/v1/projects/{pid}/refresh").json()

    assert body["status"] == "ok", body
    assert body["pipeline"] == "graphify"
    assert (body["added"], body["changed"], body["removed"]) == (0, 1, 0)
    # Thay cả tệp đổi + tệp có cạnh trỏ vào nó (test_app.py gọi app.py), không nạp lại cả cây.
    assert 1 <= body["replaced_files"] <= 2

    store, conn = _store(root)
    try:
        # Ký hiệu mới vào chỉ mục, tìm được bằng FTS (vendor đặt nhãn callable kèm `()`).
        assert any("zzz_added" in node.label for node, _score in search(conn, "zzz_added"))
        # Tệp không đổi giữ nguyên khoá chính (không bị nạp lại) và nút tệp app.py giữ nguyên id.
        assert store.node_ids_of_file("util.ts") == util_before
        assert store.pk_of("app.py#file") == app_file_pk
    finally:
        conn.close()
    assert "zzz_added" in html.read_text(encoding="utf-8")


def test_refresh_without_changes_is_noop(api, indexed_pipeline):
    root, pid = indexed_pipeline
    body = api.post(f"/v1/projects/{pid}/refresh").json()
    assert body["status"] == "ok" and body["pipeline"] == "graphify"
    assert (body["added"], body["changed"], body["removed"]) == (0, 0, 0)
    assert body["replaced_files"] == 0


def test_refresh_removed_file_drops_its_nodes(api, indexed_pipeline):
    root, pid = indexed_pipeline
    (root / "util.ts").unlink()
    body = api.post(f"/v1/projects/{pid}/refresh").json()
    assert body["status"] == "ok", body
    assert body["pipeline"] == "graphify"
    assert body["removed"] == 1 and body["changed"] <= 1
    store, conn = _store(root)
    try:
        assert store.node_ids_of_file("util.ts") == {}
    finally:
        conn.close()


def test_changes_keep_full_index_baseline_after_refresh(api, tmp_path, monkeypatch):
    """Dự án không Git: Changes so với lần lập chỉ mục đầy đủ, refresh tăng dần không được dời mốc.

    Smoke bộ cài: sửa `smoke.ts` rồi GET /changes phải báo tệp đổi và người gọi ở tệp khác.
    """
    monkeypatch.setenv("NEXGRAPH_PIPELINE", "graphify")
    root = tmp_path / "Đồ án" / "changes app"
    root.mkdir(parents=True)
    lines = ["export function helper(): boolean {", "  return true", "}", "",
             "export function entry(): boolean {", "  return helper()", "}", ""]
    (root / "lib.ts").write_text("\n".join(lines), encoding="utf-8")
    (root / "caller.ts").write_text("\n".join([
        "import { helper } from './lib'", "", "export function external(): boolean {", "  return helper()", "}", ""]),
        encoding="utf-8")
    pid = api.open(root)["project_id"]
    assert api.index(pid, timeout=180)["state"] == "done"
    base = f"/v1/projects/{pid}"
    assert api.get(f"{base}/changes", params={"refresh": "false"}).json()["changed_files"] == []

    lines[1] = "  return false"
    (root / "lib.ts").write_text("\n".join(lines), encoding="utf-8")
    changes = api.get(f"{base}/changes").json()  # refresh tăng dần rồi đọc thay đổi

    assert changes["base"] == "last_index"
    assert [(f["path"], f["status"]) for f in changes["changed_files"]] == [("lib.ts", "M")]
    changed = {node["id"] for node in changes["changed_nodes"]}
    impacted = {(item["node"]["file"], item["hops"]) for item in changes["impacted"]}
    assert any(node_id.startswith("lib_helper") for node_id in changed), changed
    assert ("caller.ts", 1) in impacted, impacted
    # Gọi lại vẫn so với mốc cũ: lần refresh thứ hai không đổi gì nhưng không được xoá thay đổi đã có.
    again = api.get(f"{base}/changes").json()
    assert [(f["path"], f["status"]) for f in again["changed_files"]] == [("lib.ts", "M")]
