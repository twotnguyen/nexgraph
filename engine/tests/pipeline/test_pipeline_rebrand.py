"""NG-PIPE-4: hậu xử lý đổi tên hiển thị trong tệp pipeline xuất ra (ADR 0025 mục 3).

Chỉ chuỗi hiển thị: id/khóa nội bộ (`graphify-theme`), tên tệp phụ (`.graphify_analysis.json`) và
đường dẫn phải giữ nguyên để nâng cấp vendor bằng cách thay thư mục.
"""
import re
import shutil
from pathlib import Path

import pytest

from nexgraph_engine.pipeline.rebrand import rebrand_exported, rebrand_text
from nexgraph_engine.pipeline.runner import run_pipeline

FIXTURES = Path(__file__).parents[1] / "fixtures"
DISPLAY = re.compile(r"(?<![\w-])[Gg]raphify(?![\w-])")
EXPORTED = ("GRAPH_REPORT.md", "graph.html", "GRAPH_TREE.html")


def visible_text(html: str) -> str:
    """Chữ người dùng thấy: bỏ <script>/<style>/chú thích HTML (nhãn đồ thị nằm trong script)."""
    html = re.sub(r"<script\b.*?</script>", " ", html, flags=re.S | re.I)
    html = re.sub(r"<style\b.*?</style>", " ", html, flags=re.S | re.I)
    return re.sub(r"<!--.*?-->", " ", html, flags=re.S)


def test_rebrand_text_keeps_ids_and_paths():
    text = ('<title>graphify - graph.html</title><script id="graphify-theme-init">'
            "const THEME_KEY = 'graphify-theme';</script> x .graphify_analysis.json "
            "graphify-out")
    new, count = rebrand_text(text)
    assert "<title>NexGraph - graph.html</title>" in new
    assert 'id="graphify-theme-init"' in new and "'graphify-theme'" in new
    assert ".graphify_analysis.json" in new and "graphify-out" in new
    assert count == 1


def test_rebrand_text_does_not_touch_project_data():
    """Đường dẫn/tên ký hiệu của dự án đang phân tích là dữ liệu, không phải nhãn hiển thị."""
    text = ("engine/src/graphify/cli.py, engine/third_party/graphify/tests, _graphify_version(), "
            "test_graphify_commands_are_recognised(), graphify-out, .graphify_analysis.json")
    assert rebrand_text(text) == (text, 0)


@pytest.fixture
def exported(tmp_path):
    root = tmp_path / "Đồ án" / "pipeline app"
    shutil.copytree(FIXTURES / "graphify_import_app", root)
    assert run_pipeline(root).ok
    return root / ".nexgraph"


def test_rebrand_removes_source_name_from_exported_files(exported):
    before = {name: (exported / name).read_text(encoding="utf-8") for name in EXPORTED}
    callflow = next(exported.glob("*-callflow.html"))
    before[callflow.name] = callflow.read_text(encoding="utf-8")
    assert any(DISPLAY.search(text) for text in before.values())

    counts = rebrand_exported(exported)

    assert sum(counts.values()) >= 1
    assert not DISPLAY.search((exported / "GRAPH_REPORT.md").read_text(encoding="utf-8"))
    for name in ("graph.html", "GRAPH_TREE.html", callflow.name):
        assert not DISPLAY.search(visible_text((exported / name).read_text(encoding="utf-8"))), name
    assert "NexGraph" in (exported / "graph.html").read_text(encoding="utf-8")
    # Id/khóa nội bộ của trang vẫn nguyên để không phá cầu nối theme của desktop.
    html = (exported / "graph.html").read_text(encoding="utf-8")
    assert "graphify-theme" in html and "graphify-theme-init" in html


def test_index_job_rebrands_exported_files(api, tmp_path, monkeypatch):
    """Job lập chỉ mục (đường pipeline) cũng gọi hậu xử lý, không chỉ hàm đứng riêng."""
    monkeypatch.setenv("NEXGRAPH_PIPELINE", "graphify")
    root = tmp_path / "Đồ án" / "pipeline app job"
    shutil.copytree(FIXTURES / "graphify_import_app", root)
    p = api.open(root)
    assert api.index(p["project_id"], timeout=180)["state"] == "done"
    out = root / ".nexgraph"
    callflow = next(out.glob("*-callflow.html"))
    assert not DISPLAY.search((out / "GRAPH_REPORT.md").read_text(encoding="utf-8"))
    for path in (out / "graph.html", out / "GRAPH_TREE.html", callflow):
        assert not DISPLAY.search(visible_text(path.read_text(encoding="utf-8"))), path.name
