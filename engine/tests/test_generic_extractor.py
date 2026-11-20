from pathlib import Path

from nexgraph_engine.index.generic import extract_generic
from nexgraph_engine.schema.enums import Confidence, EdgeType, NodeKind

ROOT = Path(__file__).parent / "fixtures" / "py_mini"


def run(rel="main.py", **kw):
    return extract_generic(ROOT, rel, "python", is_test=kw.get("is_test", False))


def by_q(x):
    return {n.qualified_name: n for n in x.nodes}


def test_python_kinds_and_ids():
    x = run()
    n = by_q(x)
    assert n["App"].kind == NodeKind.CLASS and n["App.run"].kind == NodeKind.METHOD
    assert n["local"].kind == NodeKind.FUNCTION and n["start"].kind == NodeKind.FUNCTION
    assert n["App.run"].id == "main.py::App.run#method"
    assert {v.kind for v in x.nodes} <= {NodeKind.CLASS, NodeKind.FUNCTION, NodeKind.METHOD}
    assert all(v.file == "main.py" and v.line_start >= 1 for v in x.nodes)


def test_defines_edges():
    x = run()
    pairs = {(e.source, e.target) for e in x.edges if e.type == EdgeType.DEFINES}
    assert ("main.py#file", "main.py::App#class") in pairs
    assert ("main.py::App#class", "main.py::App.run#method") in pairs
    assert ("main.py#file", "main.py::local#function") in pairs


def test_line_end_estimate_contains_evidence():
    x = run()
    by = {n.id: n for n in x.nodes}
    calls = [e for e in x.edges if e.type == EdgeType.CALLS]
    assert calls
    for e in calls:
        src = by[e.source]
        assert src.line_start <= e.line <= src.line_end
    app = by_q(x)["App"]
    assert app.line_end >= by_q(x)["App.step"].line_start  # lớp bao các phương thức


def test_imports_become_refs():
    x = run()
    got = {(r.type, r.name) for r in x.refs}
    assert (EdgeType.IMPORTS, "os") in got and (EdgeType.IMPORTS, "util") in got
    assert all(r.source == "main.py#file" for r in x.refs if r.type == EdgeType.IMPORTS)


def test_intra_file_call_edge_and_unresolved_ref():
    x = run()
    calls = {(e.source, e.target) for e in x.edges if e.type == EdgeType.CALLS}
    assert ("main.py::local#function", "main.py::other#function") in calls
    assert ("main.py::App.run#method", "main.py::App.step#method") in calls
    assert ("main.py::start#function", "main.py::App#class") in calls  # dựng đối tượng
    assert any(r.type == EdgeType.CALLS and r.name == "os" for r in x.refs)  # đích ngoài tệp
    assert all(e.confidence in (Confidence.EXTRACTED, Confidence.INFERRED) for e in x.edges)


def test_test_file_flags():
    x = extract_generic(ROOT, "test_util.py", "python", is_test=True)
    assert x.nodes and all(n.is_test for n in x.nodes)


def test_unsupported_or_missing_file_returns_error_not_exception():
    x = extract_generic(ROOT, "does_not_exist.py", "python", is_test=False)
    assert x.nodes == [] and x.errors and x.errors[0][0] in ("read", "extract")


def test_same_name_nested_functions_get_unique_ids(tmp_path):
    (tmp_path / "dup.py").write_text(
        "def a():\n    def mutate(x):\n        return x\n    return mutate\n\n"
        "def b():\n    def mutate(x):\n        return x + 1\n    return mutate\n\n"
        "def c():\n    def mutate(x):\n        return x + 2\n    return mutate\n")
    x = extract_generic(tmp_path, "dup.py", "python", is_test=False)
    ids = [n.id for n in x.nodes]
    assert len(ids) == len(set(ids))
    assert len([n for n in x.nodes if n.label == "mutate"]) == 3
    assert "dup.py::mutate#function" in ids
    assert sorted(i for i in ids if "mutate@" in i) == ["dup.py::mutate@12#function", "dup.py::mutate@7#function"]


def test_typescript_symbol_imports_are_not_refs(tmp_path):
    (tmp_path / "u.ts").write_text("export class U {}\nexport function f() {}\n")
    (tmp_path / "a.ts").write_text("import { U, f } from './u'\nimport * as path from 'path'\nexport const x = f()\n")
    x = extract_generic(tmp_path, "a.ts", "typescript", is_test=False)
    imports = [r for r in x.refs if r.type == EdgeType.IMPORTS]
    assert [(r.line, r.name.endswith("_u_ts") or r.name in ("u", "path", "ref_path")) for r in imports] == [(1, True), (2, True)]


def test_python_parse_trees_are_not_memoized():
    # Bản 0.9.92 giữ cây cú pháp của tới 2.048 tệp mỗi tiến trình (~400 MB/worker, PR #19 phải xoá cache).
    # Từ 0.9.112 upstream bỏ hẳn memo (7d302e7b); test này giữ hợp đồng đó khi nâng vendor lần sau.
    from graphify.extractors import resolution

    assert not hasattr(resolution, "_parse_python_tree_cached")
    assert not hasattr(resolution._parse_python_tree, "cache_info")
