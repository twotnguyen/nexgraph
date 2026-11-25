"""NG-PIPE-2: job lập chỉ mục dùng pipeline vendor; cờ `NEXGRAPH_PIPELINE=legacy` giữ đường cũ."""
import shutil
from pathlib import Path

import pytest

from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.store.graph_store import GraphStore

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def pipeline_root(tmp_path):
    """Fixture Python/TS nhỏ — vendor hỗ trợ cả hai ngôn ngữ nên đồ thị không rỗng."""
    root = tmp_path / "Đồ án" / "pipeline app"
    shutil.copytree(FIXTURES / "graphify_import_app", root)
    return root


def test_index_job_uses_pipeline(api, pipeline_root, monkeypatch):
    monkeypatch.setenv("NEXGRAPH_PIPELINE", "graphify")
    p = api.open(pipeline_root)

    job = api.index(p["project_id"], timeout=180)

    assert job["state"] == "done", job
    assert job["result"]["pipeline"] == "graphify" and job["result"]["fallback_reason"] is None
    assert job["result"]["nodes"] >= 4 and job["result"]["edges"] >= 3
    out = pipeline_root / ".nexgraph"
    assert (out / "graph.html").is_file()
    assert (out / "GRAPH_TREE.html").is_file()
    assert len(list(out.glob("*-callflow.html"))) == 1

    stats = api.get(f"/v1/projects/{p['project_id']}/stats").json()
    assert stats["nodes_by_kind"]["function"] >= 2

    # graph.db có đúng nút do bộ nạp #67 sinh (`<id vendor>#<kind>`, nút tệp theo `ids.file_node_id`).
    conn = open_graph_db(pipeline_root / ".nexgraph" / "graph.db")
    try:
        store = GraphStore(conn)
        assert store.get_node("app_greet#function") is not None
        assert store.get_node("app.py#file") is not None
    finally:
        conn.close()


def test_job_publishes_vendor_progress(api, pipeline_root, monkeypatch):
    """Stdout của vendor thành sự kiện tiến độ của job (không nuốt log của pipeline)."""
    monkeypatch.setenv("NEXGRAPH_PIPELINE", "graphify")
    p = api.open(pipeline_root)
    sub = api.app.state.services.bus.subscribe()
    try:
        job = api.index(p["project_id"], timeout=180)
        events = []
        while (event := sub.get(timeout=0.05)) is not None:
            events.append(event)
    finally:
        sub.close()
    assert job["state"] == "done"
    messages = [event.get("message") or "" for event in events if event["type"] == "job_progress"]
    assert any("AST extraction" in message for message in messages)
    states = {event["state"] for event in events if event["type"] == "job_progress"}
    assert {"structure", "resolve", "done"} <= states


def test_legacy_flag_keeps_old_extractor(api, copy_fixture, monkeypatch):
    monkeypatch.setenv("NEXGRAPH_PIPELINE", "legacy")
    root = copy_fixture("bookstore_app")

    job = api.index(api.open(root)["project_id"])

    assert job["state"] == "done", job
    assert job["result"]["pipeline"] == "legacy" and job["result"]["fallback_reason"] == "env_legacy"
    stats = api.get(f"/v1/projects/{job['project_id']}/stats").json()
    assert stats["nodes_by_kind"]["widget"] == 3  # Dart: chỉ bộ trích xuất cũ hiểu
    assert not (root / ".nexgraph" / "graph.html").exists()


def test_subdir_index_falls_back_to_legacy(api, copy_fixture, monkeypatch):
    """Pipeline vendor chỉ quét cả gốc: lập chỉ mục thư mục con giữ đường cũ và báo lý do."""
    monkeypatch.setenv("NEXGRAPH_PIPELINE", "graphify")
    root = copy_fixture("bookstore_app")
    p = api.open(root)
    r = api.post(f"/v1/projects/{p['project_id']}/index", json={"subdir": "lib"})
    assert r.status_code == 202, r.text
    job = api.get(f"/v1/jobs/{r.json()['job_id']}").json()
    for _ in range(600):
        job = api.get(f"/v1/jobs/{r.json()['job_id']}").json()
        if job["state"] in ("done", "error", "cancelled"):
            break
    assert job["state"] == "done", job
    assert job["result"]["pipeline"] == "legacy" and job["result"]["fallback_reason"] == "subdir"
