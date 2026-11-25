"""NG-PAR-1: lớp nạp lười `.nexgraph/graph.json` (cache theo mtime/size, nhả sau khi rảnh).

Test nhanh, không cần lập chỉ mục; mỗi test dựng một đồ thị tí hon.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

import pytest

from nexgraph_engine.mcp import graphify_view


def _write_graph(path: Path, nodes: list[tuple[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "directed": False,
        "multigraph": False,
        "graph": {},
        "nodes": [{"id": nid, "label": label} for nid, label in nodes],
        "links": [],
    }), encoding="utf-8")


@pytest.fixture
def graph_path(tmp_path: Path) -> Path:
    path = tmp_path / "Đồ án" / ".nexgraph" / "graph.json"
    _write_graph(path, [("a", "Alpha"), ("b", "Beta")])
    return path


def test_loads_once_for_many_calls(graph_path, monkeypatch):
    import graphify.serve as vendor_serve

    calls: list[str] = []
    real = vendor_serve._load_graph

    def spy(path: str):
        calls.append(path)
        return real(path)

    monkeypatch.setattr(vendor_serve, "_load_graph", spy)
    view = graphify_view.GraphView(graph_path)

    first = view.get()
    second = view.get()
    third = view.get()

    assert first is not None and first is second is third
    assert view.is_loaded is True
    assert view.loads == 1
    assert len(calls) == 1
    assert set(first.G.nodes) == {"a", "b"}
    assert first.root == graph_path.parent.parent


def test_reloads_after_mtime_change(graph_path):
    view = graphify_view.GraphView(graph_path)
    first = view.get()
    assert first is not None and view.loads == 1

    _write_graph(graph_path, [("a", "Alpha"), ("b", "Beta"), ("c", "Gamma")])
    stat = graph_path.stat()
    os.utime(graph_path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000))

    second = view.get()
    assert second is not None and second is not first
    assert set(second.G.nodes) == {"a", "b", "c"}
    assert view.loads == 2


def test_releases_after_idle(graph_path):
    view = graphify_view.GraphView(graph_path, idle_ttl=0.05)
    assert view.get() is not None
    assert view.is_loaded is True

    deadline = time.monotonic() + 5.0
    while view.is_loaded and time.monotonic() < deadline:
        time.sleep(0.02)
    assert view.is_loaded is False  # hẹn giờ đã nhả, không cần lời gọi kế tiếp
    # Lời gọi sau nạp lại bình thường
    assert view.get() is not None
    assert view.loads == 2


def test_missing_graph_returns_none(tmp_path):
    view = graphify_view.GraphView(tmp_path / "khong-co" / "graph.json")
    assert view.get() is None
    assert view.is_loaded is False


def test_corrupt_graph_falls_back_instead_of_exiting(tmp_path):
    path = tmp_path / ".nexgraph" / "graph.json"
    path.parent.mkdir(parents=True)
    path.write_text("{ khong phai json", encoding="utf-8")
    view = graphify_view.GraphView(path)
    assert view.get() is None  # vendor._load_graph gọi sys.exit(1); lớp này phải nuốt
    assert view.is_loaded is False


def test_view_for_shares_instance_per_project(tmp_path):
    graphify_view.clear_views()
    try:
        a = graphify_view.view_for(tmp_path)
        b = graphify_view.view_for(tmp_path)
        assert a is b
        assert graphify_view.view_for(tmp_path / "khac") is not a
    finally:
        graphify_view.clear_views()


def test_rebrand_text_only_changes_template_phrases():
    """Chỉ câu mẫu của vendor đổi; id, nhãn, đường dẫn, nội dung người dùng giữ nguyên byte."""
    assert graphify_view.rebrand_text(
        "Run `graphify update .` to refresh the graph."
    ) == "Run `nexgraph update .` to refresh the graph."
    assert graphify_view.rebrand_text(
        "The heading moved since indexing; run `graphify update .` to refresh the graph."
    ) == "The heading moved since indexing; run `nexgraph update .` to refresh the graph."
    # Dữ liệu người dùng: không đổi, kể cả khi mang đúng chữ của nguồn.
    for data in ("graphify_qa", "engine/src/graphify/serve.py", "Graphify Report", "GRAPHIFY_OUT",
                 "graphify-out/graph.json", "def graphify(): pass"):
        assert graphify_view.rebrand_text(data) == data
