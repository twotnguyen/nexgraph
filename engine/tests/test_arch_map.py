import pytest

from nexgraph_engine.arch import map as map_mod
from nexgraph_engine.arch.builder import UnknownBlock
from nexgraph_engine.arch.evidence import evidence_between
from nexgraph_engine.arch.map import build_map

SPEC = {
    "app/main.py": ["core.db", "core.auth.login", "web.views"],
    "core/db.py": [],
    "core/auth/login.py": ["core.db"],
    "core/auth/token.py": ["core.db"],
    "web/views.py": ["core.auth.login"],
    "web/static/a.py": [], "web/static/b.py": [], "web/static/c.py": [],
    "setup.py": [],
}


def make(tmp_path, spec, index_project):
    for rel, mods in spec.items():
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("".join(f"import {m}\n" for m in mods) + "X = 1\n", encoding="utf-8")
    store, _, _ = index_project(tmp_path)
    return store


def test_low_detail_keeps_top_level_directories(tmp_path, index_project):
    store = make(tmp_path, SPEC, index_project)
    m = build_map(store.conn, None, detail=4)
    assert {n["id"]: (n["kind"], n["files"]) for n in m["nodes"]} == {
        "file:app/main.py": ("file", 1), "dir:core": ("directory", 3), "dir:web": ("directory", 4), "file:setup.py": ("file", 1)}
    edges = {(e["source"], e["target"]): e for e in m["edges"]}       # thư mục app chỉ có một tệp nên hiện là tệp
    assert edges[("file:app/main.py", "dir:core")]["weight"] == 2
    assert edges[("file:app/main.py", "dir:core")]["types"] == {"IMPORTS": 2}
    assert ("dir:core", "dir:core") not in edges
    assert m["totals"] == {"files": 9, "nodes": 4} and m["truncated"] is False and m["parent"] is None


def test_higher_detail_opens_largest_directory_first(tmp_path, index_project):
    store = make(tmp_path, SPEC, index_project)
    ids = {n["id"] for n in build_map(store.conn, None, detail=5)["nodes"]}
    # web (4 tệp) mở trước: 4 -> 5 nút; mở tiếp core sẽ thành 6 > 5 nên core đóng
    assert ids == {"file:app/main.py", "dir:core", "file:web/views.py", "dir:web/static", "file:setup.py"}
    ids = {n["id"] for n in build_map(store.conn, None, detail=400)["nodes"]}
    assert ids == {f"file:{p}" for p in SPEC}


def test_drill_into_directory_and_labels_are_relative(tmp_path, index_project):
    store = make(tmp_path, SPEC, index_project)
    m = build_map(store.conn, "dir:core", detail=2)
    assert m["parent"] == {"id": "dir:core", "label": "core"}
    assert {n["id"]: n["label"] for n in m["nodes"]} == {"file:core/db.py": "db.py", "dir:core/auth": "auth"}
    assert [(e["source"], e["target"], e["weight"]) for e in m["edges"]] == [("dir:core/auth", "file:core/db.py", 2)]
    with pytest.raises(UnknownBlock):
        build_map(store.conn, "dir:nope", 400)
    with pytest.raises(UnknownBlock):
        build_map(store.conn, "file:setup.py", 400)


def test_single_child_directories_are_collapsed(tmp_path, index_project):
    store = make(tmp_path, {"a/b/c/x.py": [], "a/b/c/y.py": [], "z.py": []}, index_project)
    assert {n["id"] for n in build_map(store.conn, None, detail=2)["nodes"]} == {"dir:a/b/c", "file:z.py"}


def test_edge_cap_sets_truncated(tmp_path, index_project, monkeypatch):
    monkeypatch.setattr(map_mod, "MAX_EDGES", 1)
    store = make(tmp_path, SPEC, index_project)
    m = build_map(store.conn, None, detail=400)
    assert len(m["edges"]) == 1 and m["truncated"] is True


def test_map_ids_work_with_evidence(tmp_path, index_project):
    store = make(tmp_path, SPEC, index_project)
    ev = evidence_between(store.conn, "dir:app", "dir:core")
    assert sorted((e.file, e.edge.line) for e in ev) == [("app/main.py", 1), ("app/main.py", 2)]


def test_root_with_more_files_than_detail_keeps_most_symbols(tmp_path, index_project):
    spec = {f"f{i}.py": [] for i in range(5)}
    store = make(tmp_path, spec, index_project)
    (tmp_path / "f3.py").write_text("def a():\n    pass\n\ndef b():\n    pass\n")
    from nexgraph_engine.index.refresh import refresh_project
    refresh_project(store, tmp_path)
    m = build_map(store.conn, None, detail=2)
    assert len(m["nodes"]) == 2 and m["truncated"] is True and "file:f3.py" in {n["id"] for n in m["nodes"]}
