from nexgraph_engine.analysis.arch.cycles import import_cycles
from support import make


def test_import_cycles(tmp_path, index_project):
    store = make(tmp_path, {"a.py": ["b"], "b.py": ["c"], "c.py": ["a"], "d.py": ["a"], "e.py": ["f"], "f.py": ["e"]}, index_project)
    r = import_cycles(store.conn)
    assert r == {"cycles": [{"files": ["a.py", "b.py", "c.py"], "size": 3}, {"files": ["e.py", "f.py"], "size": 2}], "total": 2}
    assert import_cycles(store.conn, limit=1)["total"] == 2 and len(import_cycles(store.conn, limit=1)["cycles"]) == 1


def test_map_routes(api, pid_flow):
    pid = pid_flow
    m = api.get(f"/v1/projects/{pid}/map").json()
    assert set(m) == {"parent", "nodes", "edges", "truncated", "totals"} and m["totals"]["files"] == len(m["nodes"])
    assert api.get(f"/v1/projects/{pid}/map", params={"detail": 10}).status_code == 400
    assert api.get(f"/v1/projects/{pid}/map", params={"detail": 1501}).status_code == 400
    assert api.get(f"/v1/projects/{pid}/map", params={"parent": "dir:nope"}).json()["error"]["code"] == "unknown_block"
    assert api.get(f"/v1/projects/{pid}/cycles").json() == {"cycles": [], "total": 0}
