import shutil
import uuid

import pytest

from nexgraph_engine.global_graph.store import GlobalStore


def _edge(src_pid, dst_pid, src="a#function", dst="b#function"):
    return {"du_an_nguon": src_pid, "id_nut_nguon": src, "du_an_dich": dst_pid, "id_nut_dich": dst,
            "loai_canh": "CALLS", "loai_con": "member_call", "diem_tin_cay": 0.85,
            "tep_bang_chung": "src/a.ts", "dong_bang_chung": 3}


def test_global_store_add_remove_cascades_edges(tmp_path):
    g = GlobalStore(tmp_path)
    a, b, c = (str(uuid.uuid4()) for _ in range(3))
    assert g.add(a) and g.add(b) and g.add(c)
    assert not g.add(a)  # đã là thành viên
    assert [m[0] for m in g.members()] == [a, b, c]
    g.replace_edges([_edge(a, b), _edge(c, b, "x#function")])
    assert len(g.edges()) == 2
    assert g.remove(a)
    assert not g.remove(a)
    assert [(e["du_an_nguon"], e["du_an_dich"]) for e in g.edges()] == [(c, b)]
    assert (tmp_path / "global.db").is_file()


# --- Task 2: cạnh liên repo -----------------------------------------------------------------------

from nexgraph_engine.global_graph.link import cross_repo_impact, relink  # noqa: E402


@pytest.fixture
def two_repos(api, copy_fixture):
    """(services, lib_pid, app_pid): thư viện TS và app import nó, cả hai đã index, chưa vào graph chung."""
    pids = []
    for name in ("global_ts_lib", "global_ts_app"):
        p = api.open(copy_fixture(name))
        assert api.index(p["project_id"])["state"] == "done"
        pids.append(p["project_id"])
    return api.app.state.services, pids[0], pids[1]


def _calls(rows):
    return {(r["id_nut_nguon"], r["id_nut_dich"], r["loai_con"]) for r in rows if r["loai_canh"] == "CALLS"}


def test_ts_app_calls_lib_across_repos(two_repos):
    services, lib, app = two_repos
    g = GlobalStore(services.data_dir)
    g.add(lib), g.add(app)
    assert relink(services.data_dir, services.registry)["skipped"] == []
    rows = g.edges()
    assert ("src/cart.ts::checkout#function", "src/calculator.ts::Calculator.add#method", "member_call") in _calls(rows)
    assert ("src/cart.ts::checkout#function", "src/calculator.ts::formatSum#function", "import_symbol") in _calls(rows)
    assert ("src/cart.ts::checkout#function", "src/calculator.ts::Calculator#class", "import_symbol") in _calls(rows)
    assert all(r["muc_tin_cay"] == "INFERRED" and r["du_an_nguon"] == app and r["du_an_dich"] == lib for r in rows)


def test_duplicate_type_in_two_libs_links_no_member_call(two_repos, api, tmp_path, fixtures_dir):
    services, lib, app = two_repos
    twin = tmp_path / "twin"
    shutil.copytree(fixtures_dir / "global_ts_lib", twin)
    (twin / "package.json").write_text('{ "name": "@demo/twin" }', encoding="utf-8")
    p = api.open(twin)
    assert api.index(p["project_id"])["state"] == "done"
    g = GlobalStore(services.data_dir)
    for pid in (lib, app, p["project_id"]):
        g.add(pid)
    relink(services.data_dir, services.registry)
    calls = _calls(g.edges())
    assert not any(kind == "member_call" for *_, kind in calls)  # Calculator ở hai repo: mơ hồ, không nối
    assert ("src/cart.ts::checkout#function", "src/calculator.ts::formatSum#function", "import_symbol") in calls
    same = [r for r in g.edges() if r["loai_con"] == "same_type_as"]  # cùng tên + cùng thư mục ở hai thư viện
    assert [(r["id_nut_nguon"], r["id_nut_dich"]) for r in same] == [("src/calculator.ts::Calculator#class",) * 2]
    assert {same[0]["du_an_nguon"], same[0]["du_an_dich"]} == {lib, p["project_id"]}


def test_relink_skips_missing_member(two_repos):
    services, lib, app = two_repos
    g = GlobalStore(services.data_dir)
    g.add(lib), g.add(app)
    relink(services.data_dir, services.registry)
    assert g.edges()
    shutil.rmtree(services.registry.get(lib).path)
    out = relink(services.data_dir, services.registry)
    assert out["skipped"] == [lib] and g.edges() == []


def test_cross_repo_impact_lists_callers(two_repos):
    services, lib, app = two_repos
    g = GlobalStore(services.data_dir)
    g.add(lib), g.add(app)
    relink(services.data_dir, services.registry)
    hits = cross_repo_impact(services.data_dir, lib, ["src/calculator.ts::Calculator.add#method"])
    assert [(h["project_id"], h["node_id"], h["via"]) for h in hits] == [
        (app, "src/cart.ts::checkout#function", "src/calculator.ts::Calculator.add#method")]
    assert cross_repo_impact(services.data_dir, app, ["src/cart.ts::checkout#function"]) == []


def test_concurrent_relinks_agree(two_repos):
    from concurrent.futures import ThreadPoolExecutor
    services, lib, app = two_repos
    g = GlobalStore(services.data_dir)
    g.add(lib), g.add(app)
    with ThreadPoolExecutor(4) as pool:
        counts = list(pool.map(lambda _: relink(services.data_dir, services.registry)["edges"], range(4)))
    assert len(set(counts)) == 1 and len(g.edges()) == counts[0] > 0
