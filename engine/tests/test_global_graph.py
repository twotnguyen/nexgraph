import shutil
import uuid

import pytest

from nexgraph_engine.analysis.global_graph.store import GlobalStore


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

from nexgraph_engine.analysis.global_graph.link import cross_repo_impact, relink  # noqa: E402


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
    # TS không có namespace: hai dự án cùng template không được coi là cùng kiểu
    assert not [r for r in g.edges() if r["loai_con"] == "same_type_as"]


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


# --- sửa sau kiểm thử độc lập ---------------------------------------------------------------------

def _project(api, root, files: dict[str, str]):
    for rel, text in files.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(text, encoding="utf-8")
    p = api.open(root)
    assert api.index(p["project_id"])["state"] == "done"
    return p["project_id"]


def _relinked(api, *pids):
    services = api.app.state.services
    g = GlobalStore(services.data_dir)
    for pid in pids:
        g.add(pid)
    relink(services.data_dir, services.registry)
    return g.edges()


def test_same_type_as_only_for_namespaced_languages(api, tmp_path):
    java = {"src/main/java/com/acme/Event.java": "package com.acme;\npublic class Event {\n  public int id;\n}\n"}
    a = _project(api, tmp_path / "svc-a", java)
    b = _project(api, tmp_path / "svc-b", java)
    same = [r for r in _relinked(api, a, b) if r["loai_con"] == "same_type_as"]
    assert [(r["id_nut_nguon"], r["id_nut_dich"]) for r in same] == [("src/main/java/com/acme/Event.java::Event#class",) * 2]


UTILS_LIB = {"package.json": '{ "name": "utils" }',
             "src/index.ts": "export function formatDate(d: number): string {\n  return String(d);\n}\n\n"
                             "export function log(m: string): void {\n  console.log(m);\n}\n"}


def test_import_symbol_needs_exact_package_and_imported_name(api, tmp_path):
    lib = _project(api, tmp_path / "utils", UTILS_LIB)
    app = _project(api, tmp_path / "web", {
        "package.json": '{ "name": "web" }',
        "src/extra.ts": 'import { formatDate } from "utils-extra";\n\nexport function a(): string {\n  return formatDate(1);\n}\n',
        "src/alias.ts": 'import { formatDate } from "@/utils/date";\n\nexport function b(): string {\n  return formatDate(2);\n}\n',
        "src/logger.ts": 'import { formatDate } from "utils";\nimport { log } from "winston";\n\n'
                         'export function c(): void {\n  log(formatDate(3));\n}\n',
        "src/sub.ts": 'import { formatDate as fd } from "utils/date";\n\nexport function d(): string {\n  return fd(4);\n}\n',
    })
    calls = {(r["id_nut_nguon"], r["id_nut_dich"]) for r in _relinked(api, lib, app) if r["loai_con"] == "import_symbol"}
    assert calls == {("src/logger.ts::c#function", "src/index.ts::formatDate#function"),
                     ("src/sub.ts::d#function", "src/index.ts::formatDate#function")}


def test_folder_name_is_not_a_key_when_package_json_exists(api, tmp_path):
    lib = _project(api, tmp_path / "mathlib", {"package.json": '{ "name": "@demo/mathlib" }',
                                                "src/index.ts": "export function formatSum(t: number): string {\n  return String(t);\n}\n"})
    app = _project(api, tmp_path / "shop", {"src/a.ts": 'import { formatSum } from "mathlib";\n\n'
                                                       'export function a(): string {\n  return formatSum(1);\n}\n'})
    assert not _relinked(api, lib, app)


def test_python_import_symbol_exact_module(api, tmp_path):
    lib = _project(api, tmp_path / "pyutils", {"pyutils/__init__.py": "", "pyutils/core.py": "def helper():\n    return 1\n"})
    app = _project(api, tmp_path / "pyapp", {
        "good.py": "from pyutils.core import helper\n\n\ndef run():\n    return helper()\n",
        "bad.py": "from pyutils_ext import helper\n\n\ndef other():\n    return helper()\n"})
    calls = {(r["id_nut_nguon"], r["id_nut_dich"]) for r in _relinked(api, lib, app) if r["loai_con"] == "import_symbol"}
    assert calls == {("good.py::run#function", "pyutils/core.py::helper#function")}


def test_visible_cross_repo_respects_both_policies_and_drops_stale(two_repos):
    from nexgraph_engine.analysis.global_graph.link import visible_cross_repo
    services, lib, app = two_repos
    g = GlobalStore(services.data_dir)
    g.add(lib), g.add(app)
    relink(services.data_dir, services.registry)
    hits = cross_repo_impact(services.data_dir, lib, ["src/calculator.ts::Calculator.add#method"])
    assert visible_cross_repo(services.data_dir, lib, hits) == hits
    (services.registry.get(lib).path / ".gitignore").write_text("src/calculator.ts\n", encoding="utf-8")
    assert visible_cross_repo(services.data_dir, lib, hits) == []  # đầu `via` bị loại khỏi AI
    (services.registry.get(lib).path / ".gitignore").unlink()
    (services.registry.get(app).path / ".gitignore").write_text("src/cart.ts\n", encoding="utf-8")
    assert visible_cross_repo(services.data_dir, lib, hits) == []  # đầu bên kia bị loại
    stale = [{**hits[0], "node_id": "src/cart.ts::gone#function"}]
    assert visible_cross_repo(services.data_dir, lib, stale, for_model=False) == []


def test_cross_repo_impact_drops_stale_endpoints(two_repos):
    services, lib, app = two_repos
    g = GlobalStore(services.data_dir)
    g.add(lib), g.add(app)
    g.replace_edges([{**_edge(app, lib, "src/cart.ts::gone#function", "src/calculator.ts::Calculator.add#method")}])
    assert cross_repo_impact(services.data_dir, lib, ["src/calculator.ts::Calculator.add#method"]) == []


def test_global_store_reads_empty_before_schema(tmp_path):
    import sqlite3
    sqlite3.connect(tmp_path / "global.db").close()  # tệp mới tạo, chưa có schema (đang tạo dở)
    g = GlobalStore(tmp_path)
    assert g.members(read_only=True) == [] and g.edges(read_only=True) == []
