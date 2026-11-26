from nexgraph_engine.analysis.bridge.to_nx import Scope, build_nx, write_graph_json


def test_build_nx_all_has_graphify_attrs(copy_fixture, index_project):
    store, _, _ = index_project(copy_fixture("py_mini"))
    bg = build_nx(store)
    assert not bg.truncated
    n = bg.G.nodes["util.py::helper#function"]
    assert n["label"] == "helper" and n["source_file"] == "util.py" and n["source_location"].startswith("L")
    assert ".#repository" not in bg.G
    assert all(nid in bg.G for members in bg.communities.values() for nid in members)
    assert set().union(*bg.communities.values()) == set(bg.G.nodes)
    assert all(bg.G.nodes[nid]["community"] == cid for cid, members in bg.communities.items() for nid in members)


def test_multi_edges_collapse_keep_types(tmp_path, index_project):
    (tmp_path / "a.py").write_text("def f():\n    return 1\n")
    (tmp_path / "b.py").write_text("from a import f\n\ndef g():\n    f()\n    f()\n")
    store, _, _ = index_project(tmp_path)
    bg = build_nx(store)
    d = bg.G.get_edge_data("b.py::g#function", "a.py::f#function")
    assert d["relation"] == "calls" and d["weight"] == 2 and d["types"] == ["CALLS"]


def test_limit_truncates(copy_fixture, index_project):
    store, _, _ = index_project(copy_fixture("py_mini"))
    bg = build_nx(store, Scope(limit=3))
    assert bg.truncated and bg.G.number_of_nodes() == 3


def test_write_graph_json_loads_in_vendored_graphify(copy_fixture, index_project, tmp_path):
    store, _, _ = index_project(copy_fixture("py_mini"))
    out = tmp_path / "graph.json"
    bg = build_nx(store)
    write_graph_json(bg, out)
    from graphify.serve import _load_graph  # spec F10 §4.6: bản vendor nạp được
    G = _load_graph(str(out))
    assert G.number_of_nodes() == bg.G.number_of_nodes()
