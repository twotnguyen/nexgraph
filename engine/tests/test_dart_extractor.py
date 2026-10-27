from pathlib import Path

import pytest

from nexgraph_engine.dart.extractor import FileExtraction, extract_dart
from nexgraph_engine.ids import file_node_id, node_id
from nexgraph_engine.schema.enums import EdgeType, NodeKind

FIXTURE = Path(__file__).parent / "fixtures" / "bookstore_app"


def extract_fixture(rel: str) -> FileExtraction:
    return extract_dart(rel, (FIXTURE / rel).read_bytes(), is_test=rel.startswith("test/"))


def by_qname(x: FileExtraction) -> dict:
    return {n.qualified_name: n for n in x.nodes}


def refs(x: FileExtraction, type_: EdgeType) -> list:
    return [r for r in x.refs if r.type == type_]


def test_ids():
    assert node_id("lib/a.dart", "A.b", NodeKind.METHOD) == "lib/a.dart::A.b#method"
    assert file_node_id("lib/a.dart") == "lib/a.dart#file"


def test_kinds():
    login = by_qname(extract_fixture("lib/screens/login_screen.dart"))
    assert login["LoginScreen"].kind == NodeKind.WIDGET          # extends StatefulWidget
    assert login["_LoginScreenState"].kind == NodeKind.CLASS     # extends State<...>
    assert login["_LoginScreenState.build"].kind == NodeKind.METHOD
    assert by_qname(extract_fixture("lib/widgets/primary_button.dart"))["PrimaryButton"].kind == NodeKind.WIDGET
    auth = by_qname(extract_fixture("lib/services/auth_service.dart"))
    assert auth["AuthService"].kind == NodeKind.CLASS and auth["AuthService.login"].kind == NodeKind.METHOD
    assert by_qname(extract_fixture("lib/router.dart"))["initialLocation"].kind == NodeKind.FUNCTION
    other = by_qname(extract_dart("lib/x.dart", b"mixin M { void m() {} }\nenum E { a, b; void e() {} }\n"
                                  b"extension X on String { int get n => length; set n(int v) {} }\n"
                                  b"extension on int { void twice() {} }\n", is_test=False))
    assert other["M"].kind == NodeKind.MIXIN and other["M.m"].kind == NodeKind.METHOD
    assert other["E"].kind == NodeKind.ENUM and other["E.e"].kind == NodeKind.METHOD
    assert other["X"].kind == NodeKind.EXTENSION and other["X.n"].kind == NodeKind.METHOD and "X.n=" in other
    assert any(n.label == "extension on int" for n in other.values())


def test_ids_and_lines():
    x = extract_fixture("lib/services/auth_service.dart")
    n = by_qname(x)["AuthService.login"]
    assert n.id == "lib/services/auth_service.dart::AuthService.login#method"
    assert n.file == "lib/services/auth_service.dart" and 1 <= n.line_start <= n.line_end
    assert (FIXTURE / n.file).read_text().splitlines()[n.line_start - 1].lstrip().startswith("Future<User> login")
    assert "login" in n.signature and len(n.signature) <= 200
    cls = by_qname(x)["AuthService"]
    assert cls.line_start < n.line_start and n.line_end <= cls.line_end


def test_defines_edges():
    x = extract_fixture("lib/services/auth_service.dart")
    pairs = {(e.source, e.target) for e in x.edges if e.type == EdgeType.DEFINES}
    f = "lib/services/auth_service.dart"
    assert (file_node_id(f), f"{f}::AuthService#class") in pairs
    assert (f"{f}::AuthService#class", f"{f}::AuthService.login#method") in pairs
    assert all(e.line is None for e in x.edges)  # DEFINES không cần bằng chứng


def test_two_calls_two_refs():
    x = extract_fixture("lib/services/auth_service.dart")
    src = "lib/services/auth_service.dart::AuthService.login#method"
    posts = [r for r in refs(x, EdgeType.CALLS) if r.name == "_api.post" and r.source == src]
    assert len(posts) == 2 and posts[0].line != posts[1].line
    node = by_qname(x)["AuthService.login"]
    assert all(node.line_start <= r.line <= node.line_end for r in posts)
    assert any(r.name == "User" for r in refs(x, EdgeType.CALLS))  # gọi constructor


def test_calls_in_lambda_belong_to_enclosing_method():
    x = extract_fixture("lib/screens/login_screen.dart")
    build = "lib/screens/login_screen.dart::_LoginScreenState.build#method"
    names = {r.name for r in refs(x, EdgeType.CALLS) if r.source == build}
    assert {"_auth.login", "PrimaryButton", "Scaffold", "Center", "_goHome"} <= names
    assert ".then" not in names and not any(n.startswith(".") for n in names)  # kết quả của lời gọi khác
    go = {r.name for r in refs(x, EdgeType.CALLS) if r.source.endswith("_goHome#method")}
    assert "Navigator.pushNamed" in go


def test_const_constructor_calls():
    x = extract_fixture("lib/main.dart")
    main = "lib/main.dart::main#function"
    assert any(r.name == "MyApp" and r.source == main for r in refs(x, EdgeType.CALLS))
    assert any(r.name == "runApp" and r.source == main for r in refs(x, EdgeType.CALLS))


def test_import_refs():
    x = extract_fixture("lib/screens/login_screen.dart")
    names = {r.name: r for r in refs(x, EdgeType.IMPORTS)}
    assert set(names) == {"package:flutter/material.dart", "../services/auth_service.dart", "../widgets/primary_button.dart"}
    r = names["../services/auth_service.dart"]
    assert r.source == "lib/screens/login_screen.dart#file" and r.line == 3 and r.col == 0
    other = extract_dart("lib/x.dart", b"import 'a.dart' as a;\nexport 'c.dart';\npart 'x.g.dart';\n", is_test=False)
    assert {r.name for r in refs(other, EdgeType.IMPORTS)} == {"export:c.dart", "part:x.g.dart", "a.dart"}


def test_inherits_implements_mixin_refs():
    x = extract_dart("lib/x.dart", b"abstract class Foo<T> extends Bar with M1, M2 implements I1, I2 {}\n"
                                   b"mixin M on Base {}\n", is_test=False)
    got = {(r.type, r.name) for r in x.refs}
    assert (EdgeType.INHERITS, "Bar") in got and (EdgeType.INHERITS, "mixin:M1") in got
    assert (EdgeType.INHERITS, "mixin:M2") in got
    assert (EdgeType.IMPLEMENTS, "I1") in got and (EdgeType.IMPLEMENTS, "I2") in got
    assert (EdgeType.INHERITS, "on:Base") in got
    assert all(r.source in {"lib/x.dart::Foo#class", "lib/x.dart::M#mixin"} for r in x.refs)


def test_bindings():
    x = extract_fixture("lib/screens/login_screen.dart")
    assert x.bindings["lib/screens/login_screen.dart::_LoginScreenState#class"]["_auth"] == "AuthService"
    assert x.bindings["lib/screens/login_screen.dart::_LoginScreenState#class"]["_email"] == "TextEditingController"
    auth = extract_fixture("lib/services/auth_service.dart")
    assert auth.bindings["lib/services/auth_service.dart::AuthService#class"]["_api"] == "ApiClient"
    login = auth.bindings["lib/services/auth_service.dart::AuthService.login#method"]
    assert login["email"] == "String" and login["password"] == "String" and "data" not in login  # data không khai báo kiểu


def test_test_file_nodes():
    x = extract_fixture("test/auth_service_test.dart")
    tests = [n for n in x.nodes if n.kind == NodeKind.TEST]
    assert [t.label for t in tests] == ["login returns a user"]
    assert tests[0].is_test and all(n.is_test for n in x.nodes)
    assert any(r.name == "AuthService" and r.source == tests[0].id for r in refs(x, EdgeType.CALLS))


def test_crlf_line_numbers():
    lf = extract_fixture("lib/services/auth_service.dart")
    crlf_src = (FIXTURE / "lib/services/auth_service.dart").read_bytes().replace(b"\n", b"\r\n")
    crlf = extract_dart("lib/services/auth_service.dart", crlf_src, is_test=False)
    key = lambda x: sorted((n.id, n.line_start, n.line_end) for n in x.nodes)  # noqa: E731
    assert key(lf) == key(crlf)
    assert sorted((r.name, r.line) for r in lf.refs) == sorted((r.name, r.line) for r in crlf.refs)


def test_bom_and_empty():
    bom = extract_dart("lib/x.dart", b"\xef\xbb\xbfclass A {}\n", is_test=False)
    assert [n.qualified_name for n in bom.nodes] == ["A"] and bom.errors == []
    empty = extract_dart("lib/x.dart", b"", is_test=False)
    assert empty.nodes == [] and empty.errors == []


def test_syntax_error_partial():
    x = extract_fixture("lib/broken.dart")
    assert "validHelper" in by_qname(x)
    assert x.errors and x.errors[0][0] == "parse_partial"
    garbage = extract_dart("lib/x.dart", b"}}}} ((( ;;;\n", is_test=False)
    assert garbage.errors and garbage.errors[0][0] == "parse_unusable"


def test_invalid_utf8_does_not_crash():
    x = extract_dart("lib/x.dart", b"class A { String s = '\xff\xfe'; void m() {} }\n", is_test=False)
    assert "A" in by_qname(x) and "A.m" in by_qname(x)


def test_duplicate_test_names_get_unique_ids():
    src = b"void main() {\n  test('same', () {});\n  test('same', () {});\n}\n"
    x = extract_dart("test/a_test.dart", src, is_test=True)
    ids = [n.id for n in x.nodes if n.kind == NodeKind.TEST]
    assert len(ids) == 2 and len(set(ids)) == 2
