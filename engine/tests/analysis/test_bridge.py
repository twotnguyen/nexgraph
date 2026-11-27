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


def test_vendor_graph_round_trips_graphify_file_type_and_location(tmp_path):
    """`graph.json` xuất ra giữ quy ước Graphify mà vendor dựa vào: node tệp ở `L1` (`query`/`resolve` nhận node tệp),
    docstring là `rationale` (`suggest_questions` bỏ khỏi danh sách cô lập, `query` không hạ điểm như `document`),
    node ngoài dự án không có tệp."""
    import json

    from nexgraph_engine.core.schema.db import open_graph_db
    from nexgraph_engine.indexing.graphify_import import import_graph_json
    from nexgraph_engine.storage.store.graph_store import GraphStore

    root = tmp_path / "du an"
    (root / ".nexgraph").mkdir(parents=True)
    (root / "app.py").write_text('import networkx\n\ndef greet(name):\n    """Chào người dùng."""\n    return name\n')
    (root / "README.md").write_text("# Demo\n")
    nodes = [
        {"id": "app", "label": "app.py", "file_type": "code", "source_file": "app.py", "source_location": "L1"},
        {"id": "app_greet", "label": "greet()", "file_type": "code", "source_file": "app.py", "source_location": "L3",
         "_callable": True},
        {"id": "app_rationale_4", "label": "Chào người dùng.", "file_type": "rationale", "source_file": "app.py",
         "source_location": "L4"},
        {"id": "readme_demo", "label": "Demo", "file_type": "document", "source_file": "README.md",
         "source_location": "L1"},
        {"id": "networkx", "label": "networkx", "file_type": "concept", "source_file": ""},
    ]
    links = [
        {"source": "app", "target": "app_greet", "relation": "contains", "source_file": "app.py"},
        {"source": "app_rationale_4", "target": "app_greet", "relation": "rationale_for", "source_file": "app.py"},
        {"source": "app", "target": "networkx", "relation": "imports", "source_file": "app.py"},
    ]
    graph = root / ".nexgraph" / "graph.json"
    graph.write_text(json.dumps({"directed": False, "multigraph": False, "graph": {}, "nodes": nodes, "links": links}))
    store = GraphStore(open_graph_db(tmp_path / "graph.db"))
    import_graph_json(store, root, graph)

    by_label = {d["label"]: d for _, d in build_nx(store).G.nodes(data=True)}
    assert by_label["app.py"]["source_location"] == "L1" and by_label["app.py"]["file_type"] == "code"
    assert by_label["greet()"]["file_type"] == "code"
    assert by_label["Chào người dùng."]["file_type"] == "rationale"
    assert by_label["Demo"]["file_type"] == "document"
    assert by_label["networkx"]["source_file"] == "" and by_label["networkx"]["file_type"] == "concept"
