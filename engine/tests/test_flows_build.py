from nexgraph_engine.flows.build import MAX_DEPTH, MAX_STEPS, Step, trace
from nexgraph_engine.index.refresh import refresh_project


def flows(store):
    return {r["ten"]: r for r in store.conn.execute("SELECT * FROM luong")}


def steps(store, name):
    return [
        r[0]
        for r in store.conn.execute(
            """
            SELECT n.id_nut FROM buoc_luong b
            JOIN luong l USING (ma_luong)
            JOIN nut n ON n.ma_nut = b.ma_nut
            WHERE l.ten = ? ORDER BY b.thu_tu
            """,
            (name,),
        )
    ]


def test_login_flow_steps_in_call_order(copy_fixture, index_project):
    store, _, _ = index_project(copy_fixture("flow_app"))  # index gọi rebuild_flows
    assert steps(store, "login") == [
        "app.py::login#function",
        "service.py::login_user#function",
        "repo.py::find_user#function",
        "service.py::check_password#function",
        "repo.py::save_session#function",
        "service.py::hash_password#function",
    ]
    f = flows(store)["login"]
    assert (f["loai_vao"], f["so_buoc"], f["so_tep"], f["do_sau"], f["bi_cat"]) == ("route", 6, 3, 3, 0)


def test_every_step_has_a_real_calls_edge(copy_fixture, index_project):
    store, _, _ = index_project(copy_fixture("flow_app"))
    missing = store.conn.execute(
        """
        SELECT count(*) FROM buoc_luong b
        WHERE b.ma_nut_goi IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM canh c
            WHERE c.loai_canh = 'CALLS'
              AND c.ma_nut_nguon = b.ma_nut_goi
              AND c.ma_nut_dich = b.ma_nut
              AND c.dong_bang_chung = b.dong_bang_chung
        )
        """
    ).fetchone()[0]
    assert missing == 0


def test_criticality_formula(copy_fixture, index_project):
    store, _, _ = index_project(copy_fixture("flow_app"))
    f = flows(store)
    # login: 3 tệp, sâu 3, 6 bước; từ khoá bảo mật ở login, login_user, check_password, hash_password, save_session (5/6);
    # login_user có TESTED_BY (1/6)
    assert f["login"]["diem"] == round(0.35 * 0.5 + 0.30 * (5 / 6) + 0.20 * (5 / 6) + 0.15 * (3 / 8), 4)
    assert f["login"]["diem"] > f["books"]["diem"]


def test_trace_caps_and_cycles():
    adj = {i: [(i + 1, 1)] for i in range(1, 200)}
    got, cut = trace(adj, 1)
    assert len(got) == MAX_DEPTH + 1 and cut is False  # dừng theo độ sâu
    wide = {1: [(i, i) for i in range(2, 100)]}
    got, cut = trace(wide, 1)
    assert len(got) == MAX_STEPS and cut is True
    loop = {1: [(2, 1)], 2: [(1, 1)]}
    assert [s.pk for s in trace(loop, 1)[0]] == [1, 2]
    diamond = {1: [(2, 1), (3, 2)], 2: [(4, 5)], 3: [(4, 9)]}  # 4 được gọi từ hai nhánh
    got, _ = trace(diamond, 1)
    assert [(s.pk, s.depth, s.caller_pk, s.line) for s in got] == [
        (1, 0, None, None),
        (2, 1, 1, 1),
        (3, 1, 1, 2),
        (4, 2, 2, 5),
    ]


def test_flows_follow_refresh(copy_fixture, index_project):
    root = copy_fixture("flow_app")
    store, _, _ = index_project(root)
    (root / "app.py").write_text((root / "app.py").read_text(encoding="utf-8").replace('@app.get("/books")\n', ""))
    refresh_project(store, root)
    assert flows(store)["login"]["loai_vao"] == "route"
    assert "books" not in flows(store)  # hết decorator, lại được main gọi -> không còn là điểm vào


def test_project_without_calls_has_no_flows(tmp_path, index_project):
    (tmp_path / "a.py").write_text("X = 1\n")
    store, r, _ = index_project(tmp_path)
    assert r.state == "hoan_tat" and flows(store) == {}
