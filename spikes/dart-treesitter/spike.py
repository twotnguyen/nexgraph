"""Spike: grammar Dart cho tree-sitter 0.25 (môi trường engine). Trả lời 5 câu hỏi của kế hoạch con 1, Task 6.

Chạy: python spike.py --grammar {language_pack,dart,dart_orchard} DIR [DIR...]
"""
import argparse
import collections
import importlib
import re
import sys
import time
from pathlib import Path

import tree_sitter
from tree_sitter import Language, Parser

GENERATED = (".g.dart", ".freezed.dart", ".gr.dart", ".config.dart", ".mocks.dart")
SKIP_PARTS = {"build", ".dart_tool", ".git", "node_modules", "ephemeral"}


def load(name: str) -> Language:
    if name == "language_pack":
        return importlib.import_module("tree_sitter_language_pack").get_language("dart")
    if name == "dart":
        return Language(importlib.import_module("tree_sitter_dart").language())
    if name == "dart_orchard":
        return Language(importlib.import_module("tree_sitter_dart_orchard").language())
    raise SystemExit(f"grammar không biết: {name}")


def dart_files(dirs):
    files, gen = [], 0
    for d in dirs:
        for p in sorted(Path(d).rglob("*.dart")):
            if SKIP_PARTS & set(p.parts):
                continue
            if p.name.endswith(GENERATED):
                gen += 1
                continue
            files.append(p)
    return files, gen


def is_test_path(p: Path) -> bool:
    return bool({"test", "integration_test"} & set(p.parts)) or p.name.endswith("_test.dart")


def text(n):
    return n.text.decode("utf-8", "replace")


def walk(n):
    stack = [n]
    while stack:
        x = stack.pop()
        yield x
        stack.extend(reversed(x.children))


def error_snippets(root, src_lines):
    out = []
    for n in walk(root):
        if n.type == "ERROR" or n.is_missing:
            line = n.start_point[0]
            out.append((line + 1, src_lines[line].strip()[:70] if line < len(src_lines) else ""))
    return out


def callee_chain(arg_part):
    """Dart tree-sitter không có call_expression: lời gọi là chuỗi anh em identifier + selector... + argument_part."""
    parts, sib = [], arg_part.parent
    # arg_part nằm trong selector; selector là anh em của identifier/selector trước nó.
    sel = arg_part.parent
    if sel is None or sel.type != "selector":
        return None
    prev = sel.prev_sibling
    chain = []
    while prev is not None and prev.type in ("selector", "identifier", "type_identifier", "this", "super"):
        if prev.type == "selector":
            t = text(prev)
            if "(" in t or "[" in t:
                break  # lời gọi/index trước đó, dừng
            chain.append(t.strip())
        else:
            chain.append(text(prev))
            break
        prev = prev.prev_sibling
    if not chain:
        return None
    return "".join(reversed(chain))


def first_string(arg_part):
    for n in walk(arg_part):
        if n.type == "string_literal":
            return text(n).strip("'\"")
    return None


def enclosing_method_name(n):
    p = n.parent
    while p is not None:
        if p.type == "function_body":
            sib = p.prev_sibling
            if sib is not None and sib.type in ("method_signature", "function_signature"):
                ids = [c for c in walk(sib) if c.type == "identifier"]
                return text(ids[0]) if ids else None
        p = p.parent
    return None


def extract(root, path: Path):
    decl = collections.defaultdict(list)
    for n in walk(root):
        t = n.type
        if t in ("class_definition", "mixin_declaration", "enum_declaration", "extension_declaration"):
            name = next((text(c) for c in n.children if c.type in ("identifier", "type_identifier")), "<anon>")
            decl[t].append((name, n.start_point[0] + 1, n.end_point[0] + 1))
        elif t in ("function_signature", "method_signature"):
            body = n.next_sibling
            if body is not None and body.type == "function_body":
                ids = [c for c in walk(n) if c.type == "identifier"]
                if ids:
                    decl["function_or_method"].append((text(ids[0]), n.start_point[0] + 1, body.end_point[0] + 1))
        elif t in ("library_import", "library_export", "part_directive", "part_of_directive"):
            decl[t].append((text(n)[:60], n.start_point[0] + 1, n.end_point[0] + 1))
    calls = collections.defaultdict(list)
    widgets = collections.Counter()
    for n in walk(root):
        if n.type != "argument_part":
            continue
        name = callee_chain(n)
        if not name:
            continue
        line = n.start_point[0] + 1
        if enclosing_method_name(n) == "build" and re.match(r"^[A-Z]\w*$", name):
            widgets[name] += 1
        if re.match(r"^(Navigator\.(push|pop|pushNamed|pushReplacement|pushReplacementNamed|pushAndRemoveUntil)|context\.(go|push|pushNamed|goNamed|pushReplacement)|GoRoute|GoRouter|MaterialApp|CupertinoApp|MaterialApp\.router)$", name):
            calls[name].append((first_string(n), line))
        if is_test_path(path) and name in ("test", "testWidgets", "group", "setUp", "expect"):
            calls[name].append((first_string(n), line))
    routes_map = False
    for n in walk(root):
        if n.type == "named_argument" and text(n).startswith("routes:") and "{" in text(n)[:12]:
            routes_map = True
            break
    return decl, calls, widgets, routes_map


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--grammar", required=True)
    ap.add_argument("dirs", nargs="+")
    a = ap.parse_args()
    lang = load(a.grammar)
    parser = Parser(lang)
    files, gen = dart_files(a.dirs)
    print(f"# grammar={a.grammar} tree-sitter={tree_sitter.__version__ if hasattr(tree_sitter,'__version__') else '?'} abi={lang.abi_version}")
    print(f"files={len(files)} generated_skipped={gen}")

    srcs = {p: p.read_bytes() for p in files}
    total_bytes = sum(len(s) for s in srcs.values())
    t0 = time.perf_counter()
    trees = {p: parser.parse(s) for p, s in srcs.items()}
    dt = time.perf_counter() - t0
    print(f"[Q4] parse {len(files)} file, {total_bytes/1e6:.2f} MB trong {dt:.3f}s -> {len(files)/dt:.0f} file/s, {total_bytes/1e6/dt:.1f} MB/s")

    bad = [p for p, t in trees.items() if t.root_node.has_error]
    print(f"[Q2] file có ERROR/MISSING: {len(bad)}/{len(files)} = {100*len(bad)/max(1,len(files)):.2f}%")
    snippets = collections.Counter()
    where = {}
    for p in bad:
        lines = srcs[p].decode("utf-8", "replace").splitlines()
        for line, s in error_snippets(trees[p].root_node, lines):
            key = re.sub(r"\s+", " ", s)[:50]
            snippets[key] += 1
            where.setdefault(key, f"{p.name}:{line}")
    for k, c in snippets.most_common(5):
        print(f"     {c:4d}x  {k!r}  e.g. {where[k]}")

    D = collections.defaultdict(list)
    C = collections.defaultdict(list)
    W = collections.Counter()
    routes_map_files = []
    tests = collections.Counter()
    for p, t in trees.items():
        decl, calls, widgets, rm = extract(t.root_node, p)
        for k, v in decl.items():
            D[k] += [(f"{p.name}", *x) for x in v]
        for k, v in calls.items():
            C[k] += [(p.name, *x) for x in v]
        W.update(widgets)
        if rm:
            routes_map_files.append(p.name)
    print("[Q3] khai báo:")
    for k in ("class_definition", "mixin_declaration", "enum_declaration", "extension_declaration", "function_or_method",
              "library_import", "library_export", "part_directive"):
        v = D.get(k, [])
        print(f"   {k}: {len(v)}")
        for x in v[:10 if k in ("class_definition", "function_or_method", "library_import") else 3]:
            print(f"        {x}")
    print(f"   widget tạo trong build(): {sum(W.values())} lần, {len(W)} tên khác nhau, top: {W.most_common(10)}")
    print("   lời gọi điều hướng/router/test:")
    for k, v in sorted(C.items()):
        print(f"   {k}: {len(v)}  e.g. {v[:3]}")
    print(f"   MaterialApp(routes: {{...}}) trong {len(routes_map_files)} file: {routes_map_files[:5]}")
    tf = [p for p in files if is_test_path(p)]
    print(f"[Q5] file test nhận diện theo đường dẫn: {len(tf)}; số lời gọi test()/testWidgets(): {len(C.get('test', []))+len(C.get('testWidgets', []))}")


if __name__ == "__main__":
    main()
