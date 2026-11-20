"""W10: bộ nhớ làm việc (đánh giá → bài học) và Memory neo vào node (remember/recall)."""
import json
from contextlib import closing
from datetime import datetime, timedelta, timezone

import anyio
import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from nexgraph_engine.mcp.server import build_server
from nexgraph_engine.memory import MemoryBusy, lessons, rate, recall, remember, writer
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.store.publication import graph_writer

AUTH = "lib/services/auth_service.dart#file"
LOGIN = "lib/screens/login_screen.dart#file"
BUTTON = "lib/widgets/primary_button.dart#file"
NOW = datetime(2026, 11, 21, tzinfo=timezone.utc)


@pytest.fixture
def project(api, copy_fixture):
    root = copy_fixture("bookstore_app")
    p = api.open(root)
    assert api.index(p["project_id"])["state"] == "done"
    info = api.app.state.services.registry.get(p["project_id"])
    return p["project_id"], info.graph_db, root


def at(days_ago: float) -> datetime:
    return NOW - timedelta(days=days_ago)


def test_ratings_become_lessons(project):
    _, db, _ = project
    with writer(db) as conn:
        rate(conn, "Đăng nhập ở đâu?", "AuthService.login", "huu_ich", [AUTH, LOGIN], now=at(1))
        rate(conn, "Ai gọi login?", "LoginScreen", "huu_ich", [AUTH], now=at(2))
        rate(conn, "Nút bấm?", "PrimaryButton", "ngo_cut", [BUTTON], now=at(1))
        rate(conn, "Lưu token ở đâu?", "localStorage", "da_sua", [AUTH], correction="SharedPreferences", now=at(0))
    with closing(open_graph_db(db, read_only=True)) as conn:
        out = lessons(conn, now=NOW)
    assert out["counts"] == {"useful": 2, "dead_end": 1, "corrected": 1, "unmarked": 0}
    assert [e["node"] for e in out["contested"]] == [AUTH]  # 2 hữu ích + 1 đã sửa
    assert [e["node"] for e in out["tentative"]] == [LOGIN]
    assert out["dead_ends"][0]["question"] == "Nút bấm?"
    assert out["corrections"][0]["correction"] == "SharedPreferences"
    assert out["labels"][AUTH] == "auth_service.dart"


def test_tentative_below_two_corroborations(project):
    _, db, _ = project
    with writer(db) as conn:
        rate(conn, "q1", "a", "huu_ich", [AUTH], now=at(1))
    with closing(open_graph_db(db, read_only=True)) as conn:
        one = lessons(conn, now=NOW)
    assert one["preferred"] == [] and [e["node"] for e in one["tentative"]] == [AUTH]
    with writer(db) as conn:
        rate(conn, "q2", "a", "huu_ich", [AUTH], now=at(1))
    with closing(open_graph_db(db, read_only=True)) as conn:
        two = lessons(conn, now=NOW)
    assert [e["node"] for e in two["preferred"]] == [AUTH] and two["tentative"] == []


def test_decay_uses_injected_now(project):
    _, db, _ = project
    with writer(db) as conn:
        rate(conn, "cũ", "a", "huu_ich", [AUTH], now=at(90))  # 3 chu kỳ bán rã → 0,125
        rate(conn, "mới", "a", "ngo_cut", [AUTH], now=at(0))
    with closing(open_graph_db(db, read_only=True)) as conn:
        out = lessons(conn, now=NOW)
        later = lessons(conn, now=NOW + timedelta(days=30))
    entry = out["contested"][0]
    assert entry["verdict"] == "dead end" and entry["score"] == pytest.approx(0.125 - 1.0)
    assert later["contested"][0]["score"] == pytest.approx(0.0625 - 0.5)


def test_recall_by_node_and_by_query(project):
    _, db, _ = project
    with writer(db) as conn:
        remember(conn, "decision", "Token lưu trong SharedPreferences", [AUTH], "nguoi_dung")
        remember(conn, "owner", "Nhóm Tình phụ trách màn hình đăng nhập", [LOGIN], "mcp")
        rate(conn, "Đăng nhập ở đâu?", "AuthService", "huu_ich", [AUTH], now=at(1))
    with closing(open_graph_db(db, read_only=True)) as conn:
        by_node = recall(conn, node_id=AUTH, now=NOW)
        by_query = recall(conn, query="sharedpreferences token")
    assert by_node["node_exists"] is True
    assert {m["kind"] for m in by_node["memories"]} == {"decision", "danh_gia"}
    assert by_node["lesson"]["status"] == "tentative"
    rating = next(m for m in by_node["memories"] if m["kind"] == "danh_gia")
    assert rating["outcome"] == "huu_ich" and rating["question"] == "Đăng nhập ở đâu?" and rating["answer"] == "AuthService"
    assert [m["text"] for m in by_query["memories"]] == ["Token lưu trong SharedPreferences"]


def test_remember_merges_duplicates(project):
    _, db, _ = project
    with writer(db) as conn:
        first = remember(conn, "lesson", "Đừng sửa cache!", [AUTH, LOGIN], "mcp")
        same = remember(conn, "lesson", "  đừng   SỬA cache ", [LOGIN, AUTH], "nguoi_dung")
        other_nodes = remember(conn, "lesson", "Đừng sửa cache", [AUTH], "mcp")
        other_kind = remember(conn, "incident", "Đừng sửa cache", [AUTH, LOGIN], "mcp")
        count = conn.execute("SELECT count(*) FROM ky_uc").fetchone()[0]
    assert first["created"] and not same["created"] and same["id"] == first["id"]
    assert other_nodes["created"] and other_kind["created"] and count == 3


def test_remember_validates_input(project):
    _, db, _ = project
    with writer(db) as conn:
        for kind, text, nodes in [("note", "x", []), ("lesson", "  ", []), ("lesson", "x" * 4001, []),
                                  ("lesson", "x", [AUTH] * 51), ("lesson", "x", ["khong/co#file"])]:
            with pytest.raises(ValueError):
                remember(conn, kind, text, nodes, "mcp")


def test_remember_while_indexing_is_rejected(project):
    _, db, _ = project
    with graph_writer(db):  # khoá mà index giữ suốt lúc dựng bản tạm và công bố
        with pytest.raises(MemoryBusy):
            with writer(db) as conn:
                remember(conn, "lesson", "x", [], "mcp")


def test_memory_survives_reindex_without_node(api, project):
    pid, db, root = project
    with writer(db) as conn:
        remember(conn, "incident", "Nút bấm từng lỗi", [BUTTON, AUTH], "nguoi_dung")
        rate(conn, "q", "a", "huu_ich", [BUTTON], now=at(1))
    (root / "lib/widgets/primary_button.dart").unlink()
    assert api.index(pid)["state"] == "done"
    with closing(open_graph_db(db, read_only=True)) as conn:
        out = recall(conn, node_id=BUTTON, now=NOW)
        assert lessons(conn, now=NOW)["tentative"] == []  # bài học bỏ node đã mất, giống vendor
    assert out["node_exists"] is False
    incident = next(m for m in out["memories"] if m["kind"] == "incident")
    assert incident["missing_node_ids"] == [BUTTON]


# --- API -----------------------------------------------------------------------------------------------------------

def test_api_memory_flow(api, project):
    pid, _, _ = project
    r = api.post(f"/v1/projects/{pid}/memory/ratings", json={
        "question": "Đăng nhập ở đâu?", "answer": "Xem lib/services/auth_service.dart:3", "outcome": "huu_ich",
        "citations": [{"file": "lib/services/auth_service.dart", "line": 3}, {"file": "khong_co.dart", "line": 1}]})
    assert r.status_code == 200, r.text
    assert r.json()["node_ids"] and all(n.startswith("lib/services/auth_service.dart") for n in r.json()["node_ids"])
    r = api.post(f"/v1/projects/{pid}/memory", json={"kind": "owner", "text": "Tình", "node_ids": [AUTH]})
    assert r.status_code == 200 and r.json()["created"] is True
    assert api.post(f"/v1/projects/{pid}/memory", json={"kind": "x", "text": "a", "node_ids": []}).status_code == 400
    assert api.post(f"/v1/projects/{pid}/memory/ratings", json={
        "question": "q", "answer": "a", "outcome": "da_sua", "citations": []}).status_code == 400  # thiếu cách đúng
    got = api.get(f"/v1/projects/{pid}/memory", params={"node": AUTH}).json()
    assert [m["kind"] for m in got["memories"]] == ["owner"]
    assert api.get(f"/v1/projects/{pid}/lessons").json()["total"] == 1


def test_api_rejects_write_while_index_running(api, project):
    pid, db, _ = project
    with graph_writer(db):
        r = api.post(f"/v1/projects/{pid}/memory", json={"kind": "lesson", "text": "x", "node_ids": []})
    assert r.status_code == 409 and r.json()["error"]["code"] == "index_running"


# --- MCP -----------------------------------------------------------------------------------------------------------

def _call(server, name: str, args: dict):
    async def run():
        async with create_connected_server_and_client_session(server._mcp_server) as client:
            return await client.call_tool(name, args)
    return anyio.run(run)


def _body(result):
    assert result.isError is False, result.content[0].text
    return result.structuredContent if result.structuredContent is not None else json.loads(result.content[0].text)


def test_mcp_remember_and_recall(project, tmp_path):
    _, db, root = project
    server = build_server(root, tmp_path / "appdata")
    first = _body(_call(server, "remember", {"kind": "lesson", "text": "Đừng sửa cache", "node_ids": [AUTH]}))
    again = _body(_call(server, "remember", {"kind": "lesson", "text": "đừng sửa cache.", "node_ids": [AUTH]}))
    assert first["created"] and not again["created"] and again["id"] == first["id"]
    got = _body(_call(server, "recall", {"node_id": AUTH}))
    assert [m["text"] for m in got["memories"]] == ["Đừng sửa cache"]
    with closing(open_graph_db(db, read_only=True)) as conn:
        assert conn.execute("SELECT nguon FROM ky_uc").fetchone()[0] == "mcp"
    bad = _call(server, "recall", {})
    assert bad.isError
    with graph_writer(db):
        busy = _call(server, "remember", {"kind": "lesson", "text": "y", "node_ids": []})
    assert busy.isError and "lập chỉ mục" in busy.content[0].text
