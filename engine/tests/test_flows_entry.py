from pathlib import Path
from nexgraph_engine.flows.entry import detect_entry_points, decorators_above


def test_entry_points_of_flow_app(copy_fixture, index_project):
    root = copy_fixture("flow_app")
    store, _, _ = index_project(root)
    eps = {e.node_id: (e.kind, e.detail) for e in detect_entry_points(store.conn, root)}
    assert eps == {
        "app.py::main#function": ("main", None),
        "app.py::login#function": ("route", 'app.post("/auth/login")'),
        "app.py::books#function": ("route", 'app.get("/books")'),
    }   # unused_helper: không gọi ai; test_login: test; login_user…: có người gọi


def test_decorators_above_stops_at_code():
    lines = ["x = 1", "@Controller('auth')", "", "  @Post('login')", "  @UseGuards(A)", "  login() {"]
    assert decorators_above(lines, 6) == ["@UseGuards(A)", "@Post('login')"]


def test_missing_source_file_means_no_decorators(copy_fixture, index_project):
    root = copy_fixture("flow_app")
    store, _, _ = index_project(root)
    (root / "app.py").unlink()
    kinds = {e.node_id: e.kind for e in detect_entry_points(store.conn, root)}
    assert kinds["app.py::login#function"] == "root" and kinds["app.py::main#function"] == "main"
