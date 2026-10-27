"""Thử từng cú pháp Dart 3 trên grammar đã chọn. Chạy: python syntax_probe.py {language_pack,dart,dart_orchard}"""
import sys
from tree_sitter import Parser
from spike import load

CASES = {
 "switch expression + pattern": "int f(Object o) => switch (o) { int n when n > 0 => n, _ => 0 };",
 "object pattern có generic": "void f(Result r) { switch (r) { case Ok<int>(): break; case Error<int>(): break; } }",
 "object pattern có field": "void f(Result r) { switch (r) { case Ok(value: var v): print(v); } }",
 "record": "(int, String) f() => (1, 'a'); var r = (a: 1, b: 2);",
 "destructuring record": "void f() { var (a, b) = (1, 2); }",
 "sealed class": "sealed class S {} final class A extends S {}",
 "mixin class": "mixin class M {}",
 "base/interface class": "base class B {} interface class I {}",
 "enhanced enum": "enum E { a(1), b(2); final int v; const E(this.v); }",
 "extension type": "extension type Id(int v) { int get x => v; }",
 "extension method": "extension X on String { int get n => length; }",
 "async/await/stream": "Future<void> f() async { await for (var x in s()) { print(x); } } Stream<int> g() async* { yield 1; }",
 "null-aware & cascade": "void f(A? a) { a?..b = 1..c(); var x = a?.b ?? 0; }",
 "late/required/named params": "class C { late final int x; C({required this.x, int? y}); }",
 "typedef mới": "typedef F<T> = void Function(T);",
 "if-case": "void f(Object o) { if (o case int n when n > 1) print(n); }",
 "collection if/for/spread": "var l = [1, if (true) 2, for (var i in [3]) i, ...[4]];",
 "annotation có tham số": "@Deprecated('x') @override void f() {}",
 "part of": "part of 'a.dart';",
 "dot shorthand (Dart 3.10)": "void f() { Color c = .red; }",
}
g = sys.argv[1]
p = Parser(load(g))
bad = []
for name, src in CASES.items():
    t = p.parse(src.encode())
    if t.root_node.has_error:
        bad.append(name)
print(f"{g}: {len(CASES)-len(bad)}/{len(CASES)} cú pháp OK; lỗi: {bad}")
