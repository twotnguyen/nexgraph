from pathlib import Path

from nexgraph_engine.schema.enums import Confidence, EdgeType, Origin


def write(root: Path, rel: str, text: str) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def edges(store, type_):
    return {(e.edge.source, e.edge.target, e.edge.line): e for n in store.all_nodes()
            for e in store.neighbors(n.id, direction="out", types={type_}).edges}


def targets(store, type_, source_suffix):
    return {t for (s, t, _l) in edges(store, type_) if s.endswith(source_suffix)}


def test_relative_and_package_imports_resolved(tmp_path, index_project):
    root = tmp_path / "proj"
    write(root, "pubspec.yaml", "name: my_app\n")
    write(root, "lib/a.dart", "import 'b.dart';\nimport 'package:my_app/c.dart';\nimport 'package:flutter/material.dart';\nimport '../outside.dart';\n")
    write(root, "lib/b.dart", "class B {}\n")
    write(root, "lib/c.dart", "class C {}\n")
    store, result, _ = index_project(root)
    got = edges(store, EdgeType.IMPORTS)
    assert ("lib/a.dart#file", "lib/b.dart#file", 1) in got and ("lib/a.dart#file", "lib/c.dart#file", 2) in got
    assert len(got) == 2
    names = {r for r in store.conn.execute("SELECT ten_tham_chieu, trang_thai FROM tham_chieu_chua_phan_giai")}
    assert {(n["ten_tham_chieu"], n["trang_thai"]) for n in names} == {
        ("package:flutter/material.dart", "that_bai"), ("../outside.dart", "that_bai")}


def test_calls_resolve_by_scope(tmp_path, index_project):
    root = tmp_path / "proj"
    write(root, "lib/util.dart", "String helper() => 'x';\nclass Svc { void run() {} static void make() {} }\n")
    write(root, "lib/a.dart", """import 'util.dart';
class A {
  final Svc svc = Svc();
  void m1() { m2(); }
  void m2() {}
  void m3() { this.m2(); }
  void m4() { svc.run(); }
  void m5() { Svc.make(); }
  void m6() { Svc().run(); }
  void m7() { helper(); }
  void m8(Svc s) { s.run(); }
  void m9() { unknownThing.foo(); }
}
""")
    store, _, _ = index_project(root)
    f = "lib/a.dart::A."
    def one(m):
        t = targets(store, EdgeType.CALLS, f"{m}#method")
        return t
    assert one("m1") == {f + "m2#method"}
    assert one("m3") == {f + "m2#method"}
    assert "lib/util.dart::Svc.run#method" in one("m4")
    assert "lib/util.dart::Svc.make#method" in one("m5")
    assert "lib/util.dart::Svc.run#method" in one("m6")
    assert "lib/util.dart::helper#function" in one("m7")
    assert "lib/util.dart::Svc.run#method" in one("m8")
    assert one("m9") == set()
    e = next(x for (s, t, _l), x in edges(store, EdgeType.CALLS).items() if s.endswith("A.m1#method"))
    assert e.edge.confidence == Confidence.INFERRED and e.edge.origin == Origin.RESOLVER and e.edge.confidence_score == 0.9
    imported = next(x for (s, t, _l), x in edges(store, EdgeType.CALLS).items() if s.endswith("A.m7#method"))
    assert imported.edge.confidence_score == 0.8


def test_ambiguous_name_not_guessed(tmp_path, index_project):
    root = tmp_path / "proj"
    write(root, "lib/d1.dart", "class Dup {}\n")
    write(root, "lib/d2.dart", "class Dup {}\n")
    write(root, "lib/use.dart", "void go() { Dup(); }\n")
    store, _, _ = index_project(root)
    assert targets(store, EdgeType.CALLS, "use.dart::go#function") == set()
    row = store.conn.execute("SELECT trang_thai FROM tham_chieu_chua_phan_giai WHERE ten_tham_chieu = 'Dup'").fetchone()
    assert row["trang_thai"] == "that_bai"


def test_imported_wins_over_unrelated_duplicate(tmp_path, index_project):
    root = tmp_path / "proj"
    write(root, "lib/d1.dart", "class Dup {}\n")
    write(root, "lib/d2.dart", "class Dup {}\n")
    write(root, "lib/use.dart", "import 'd1.dart';\nvoid go() { Dup(); }\n")
    store, _, _ = index_project(root)
    assert targets(store, EdgeType.CALLS, "use.dart::go#function") == {"lib/d1.dart::Dup#class"}


def test_unique_global_has_lower_score(tmp_path, index_project):
    root = tmp_path / "proj"
    write(root, "lib/only.dart", "class Only {}\n")
    write(root, "lib/use.dart", "void go() { Only(); }\n")
    store, _, _ = index_project(root)
    (e,) = [x for (s, t, _l), x in edges(store, EdgeType.CALLS).items() if s.endswith("go#function")]
    assert e.edge.confidence_score == 0.5 and e.edge.subtype == "construct"


def test_inherits_implements_resolved(tmp_path, index_project):
    root = tmp_path / "proj"
    write(root, "lib/base.dart", "class Base {}\nmixin Mx {}\nclass Iface {}\n")
    write(root, "lib/child.dart", "import 'base.dart';\nclass Child extends Base with Mx implements Iface {}\n")
    store, _, _ = index_project(root)
    inh = {(t, e.edge.subtype) for (s, t, _l), e in edges(store, EdgeType.INHERITS).items()}
    assert inh == {("lib/base.dart::Base#class", None), ("lib/base.dart::Mx#mixin", "mixin")}
    assert targets(store, EdgeType.IMPLEMENTS, "Child#class") == {"lib/base.dart::Iface#class"}
