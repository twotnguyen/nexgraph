"""N2-E2: đồ thị dựng bằng pipeline vendor vẫn có luồng thực thi (`luong`/`buoc_luong`).

Đường cũ gọi `rebuild_flows` sau bước phân giải (index đầy đủ) và `update_flows` khi refresh. Pipeline
nạp `graph.json` bằng bộ nạp #67, nên job và refresh phải tự dựng lại luồng — thiếu bước này thì
`list_flows`/`trace_flow` của trợ lý AI trả rỗng (test desktop `ai-e2e` "hỏi luồng đăng nhập").
"""
from pathlib import Path

import pytest

from nexgraph_engine.schema.db import open_graph_db


def _bare(label: str) -> str:
    """Nhãn nút của vendor có `()` (`login()`); so theo tên trần như đường cũ."""
    return label[:-2] if label.endswith("()") else label


def _flow_kinds(root: Path) -> dict[str, str]:
    conn = open_graph_db(root / ".nexgraph" / "graph.db")
    try:
        return {_bare(name): kind for name, kind in conn.execute("SELECT ten, loai_vao FROM luong")}
    finally:
        conn.close()


def _flow_steps(root: Path) -> dict[str, list[str]]:
    conn = open_graph_db(root / ".nexgraph" / "graph.db")
    try:
        rows = conn.execute(
            """
            SELECT l.ten, n.nhan FROM luong l
            JOIN buoc_luong b USING (ma_luong)
            JOIN nut n ON n.ma_nut = b.ma_nut
            ORDER BY l.ten, b.thu_tu
            """
        ).fetchall()
    finally:
        conn.close()
    flows: dict[str, list[str]] = {}
    for name, label in rows:
        flows.setdefault(_bare(name), []).append(_bare(label))
    return flows


@pytest.fixture
def pipeline_flow(api, copy_fixture, monkeypatch):
    monkeypatch.setenv("NEXGRAPH_PIPELINE", "graphify")
    root = copy_fixture("flow_app")
    pid = api.open(root)["project_id"]
    job = api.index(pid, timeout=180)
    assert job["state"] == "done", job
    assert job["result"]["pipeline"] == "graphify"
    return root, pid


def test_pipeline_index_builds_flows(api, pipeline_flow):
    root, pid = pipeline_flow
    flows = _flow_steps(root)
    assert "login" in flows, flows
    assert flows["login"] == ["login", "login_user", "find_user", "check_password", "save_session",
                              "hash_password"]  # đúng thứ tự gọi như đường cũ (test_flows_build)
    # Loại điểm vào khớp theo tên trần: `main()` vẫn là `main`, route nhận từ decorator.
    assert _flow_kinds(root) == {"login": "route", "books": "route", "main": "main"}
    body = api.get(f"/v1/projects/{pid}/flows", params={"q": "login"}).json()
    assert [_bare(flow["name"]) for flow in body["flows"]] == ["login"], body


def test_pipeline_refresh_updates_flows(api, pipeline_flow):
    root, pid = pipeline_flow
    service = root / "service.py"
    service.write_text(service.read_text(encoding="utf-8").replace("    check_password(user, body)\n", ""),
                       encoding="utf-8")

    body = api.post(f"/v1/projects/{pid}/refresh").json()

    assert body.get("pipeline") == "graphify", body
    login = _flow_steps(root)["login"]
    assert "check_password" not in login and "save_session" in login, login
