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


def test_extractor_never_writes_stdout(tmp_path, capfd):
    # stdout của engine là kênh giao thức (dòng `ready` của serve, JSON của refresh, JSON-RPC của MCP).
    (tmp_path / "a.py").write_text("def f():\n    return 1\n")
    extract_generic(tmp_path, "a.py", "python", is_test=False)
    assert capfd.readouterr().out == ""


def test_csharp_constructor_calls_are_attributed_to_the_class(tmp_path):
    # 0.9.112 tách constructor thành nút không `_callable`; giữ hành vi 0.9.92: lời gọi thuộc về lớp.
    (tmp_path / "B.cs").write_text("class B {\n  public B() { Setup(); }\n  void Setup() {}\n}\n")
    r = extract_generic(tmp_path, "B.cs", "csharp", is_test=False)
    calls = {(e.source.split("::")[-1], e.target.split("::")[-1]) for e in r.edges if e.type.name == "CALLS"}
    assert ("B#class", "B.Setup#method") in calls


def test_java_overloads_share_one_line_independent_node(tmp_path):
    # Thêm một dòng phía trên không được đổi id của overload (changes sẽ báo xoá/thêm giả).
    src = "class A {\n  void run() {}\n  void run(int n) {}\n}\n"
    (tmp_path / "A.java").write_text(src)
    before = {n.id for n in extract_generic(tmp_path, "A.java", "java", is_test=False).nodes}
    (tmp_path / "A.java").write_text("// x\n" + src)
    after = {n.id for n in extract_generic(tmp_path, "A.java", "java", is_test=False).nodes}
    assert before == after
    assert sum(1 for i in after if "A.run" in i) == 1


def _kinds(r):
    return {n.id.split("::", 1)[1]: n.kind.value for n in r.nodes}


def _edges(r, type_name):
    return {(e.source.split("::", 1)[-1], e.target.split("::", 1)[-1], e.subtype) for e in r.edges if e.type.name == type_name}


RUST = """pub const RETRY_LIMIT: u32 = 3;
pub struct Graph { n: u32 }
pub trait Shape { fn area(&self) -> f64; }
impl Graph {
    pub fn add(&mut self) { self.grow(); }
    fn grow(&mut self) {}
}
impl Shape for Graph { fn area(&self) -> f64 { 0.0 } }
"""


def test_rust_types_methods_constants_and_calls(tmp_path):
    (tmp_path / "a.rs").write_text(RUST)
    r = extract_generic(tmp_path, "a.rs", "rust", is_test=False)
    k = _kinds(r)
    assert k["Graph#class"] == "class" and k["Shape#class"] == "class"
    assert k["Graph.add#method"] == "method" and k["Graph.area#method"] == "method" and k["Shape.area#method"] == "method"
    assert k["RETRY_LIMIT#variable"] == "variable"
    assert ("Graph.add#method", "Graph.grow#method", None) in _edges(r, "CALLS")
    assert ("Graph#class", "Shape#class", None) in _edges(r, "IMPLEMENTS")


def test_bash_functions_and_calls(tmp_path):
    (tmp_path / "a.sh").write_text("build() {\n  echo hi\n}\ndeploy() {\n  build\n}\n")
    r = extract_generic(tmp_path, "a.sh", "bash", is_test=False)
    assert _kinds(r) == {"build#function": "function", "deploy#function": "function"}  # nút "script" là chính tệp
    assert ("deploy#function", "build#function", None) in _edges(r, "CALLS")


def test_ruby_nested_class_and_external_base(tmp_path):
    (tmp_path / "a.rb").write_text("module Shop\n  class Cart < Base\n    def total\n      sum()\n    end\n    def sum; 0; end\n  end\nend\n")
    r = extract_generic(tmp_path, "a.rb", "ruby", is_test=False)
    k = _kinds(r)
    assert k["Shop.Cart#class"] == "class" and k["Shop.Cart.total#method"] == "method"
    assert any(ref.name == "Base" and ref.type.name == "INHERITS" for ref in r.refs)


def test_sql_tables_and_references(tmp_path):
    (tmp_path / "a.sql").write_text("CREATE TABLE users (id INT PRIMARY KEY);\n"
                                    "CREATE TABLE orders (id INT, user_id INT REFERENCES users(id));\n"
                                    "CREATE VIEW v AS SELECT * FROM users;\n")
    r = extract_generic(tmp_path, "a.sql", "sql", is_test=False)
    k = _kinds(r)
    assert k["users#table"] == "table" and k["orders#table"] == "table" and k["v#table"] == "table"
    refs = _edges(r, "REFERENCES")
    assert ("orders#table", "users#table", None) in refs and ("v#table", "users#table", "reads_from") in refs


def test_same_file_name_in_two_directories_gets_distinct_ids(tmp_path):
    for d in ("a", "b"):
        (tmp_path / d).mkdir()
        (tmp_path / d / "mod.rs").write_text("pub fn run() {}\n")
    ids = {n.id for d in ("a", "b") for n in extract_generic(tmp_path, f"{d}/mod.rs", "rust", is_test=False).nodes}
    assert ids == {"a/mod.rs::run#function", "b/mod.rs::run#function"}
