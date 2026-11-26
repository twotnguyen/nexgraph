"""Trích xuất cấu trúc, import, kế thừa và lời gọi từ một tệp Dart bằng Tree-sitter.

Grammar Dart không có `call_expression`: lời gọi là chuỗi anh em `identifier` + `selector`... + `selector`
chứa `argument_part`. Hàm này chỉ trích xuất; việc nối tham chiếu
thành cạnh nằm ở index/resolver.py.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache

import tree_sitter_dart
from tree_sitter import Language, Node as TsNode, Parser

from nexgraph_engine.core.ids import file_node_id, node_id
from nexgraph_engine.core.schema.enums import EdgeType, NodeKind
from nexgraph_engine.storage.store.models import Edge, Node, UnresolvedRef

WIDGET_BASES = frozenset({"StatelessWidget", "StatefulWidget", "ConsumerWidget", "ConsumerStatefulWidget",
                          "HookWidget", "HookConsumerWidget"})
TEST_CALLS = frozenset({"test", "testWidgets"})
_NOISE_IN_TESTS = frozenset({"test", "testWidgets", "group", "setUp", "tearDown", "setUpAll", "tearDownAll", "expect"})
_MAX_SIGNATURE = 200


@dataclass(frozen=True)
class FileExtraction:
    nodes: list[Node] = field(default_factory=list)
    edges: list[Edge] = field(default_factory=list)
    refs: list[UnresolvedRef] = field(default_factory=list)
    bindings: dict[str, dict[str, str]] = field(default_factory=dict)
    errors: list[tuple[str, str]] = field(default_factory=list)


@lru_cache(maxsize=1)
def _parser() -> Parser:
    return Parser(Language(tree_sitter_dart.language()))


def _txt(n: TsNode) -> str:
    return n.text.decode("utf-8", "replace")


def _end_line(n: TsNode) -> int:
    row, col = n.end_point
    return row + 1 if col > 0 else max(row, n.start_point[0] + 1)


def _walk(n: TsNode):
    stack = [n]
    while stack:
        x = stack.pop()
        yield x
        stack.extend(reversed(x.children))


def _child(n: TsNode, *types: str) -> TsNode | None:
    return next((c for c in n.children if c.type in types), None)


def _signature_text(start: TsNode, stop_at: TsNode | None, source: bytes) -> str:
    end = stop_at.start_byte if stop_at is not None else start.end_byte
    return re.sub(r"\s+", " ", source[start.start_byte:end].decode("utf-8", "replace")).strip()[:_MAX_SIGNATURE]


def _strip_generics(name: str) -> str:
    while True:
        new = re.sub(r"<[^<>]*>", "", name)
        if new == name:
            return name.strip()
        name = new


_MAX_DOC = 2000


def _clean_doc(raw: str) -> str:
    if raw.startswith("///"):
        return raw[3:].removeprefix(" ").rstrip()
    body = raw.removeprefix("/**").removesuffix("*/")
    return "\n".join(re.sub(r"^\s*\*? ?", "", line).rstrip() for line in body.strip().splitlines()).strip()


def _doc_for(decl: TsNode) -> str | None:
    """Chú thích tài liệu `///` hoặc `/** */` nằm liền kề ngay trước khai báo (chỉ chú thích `//` thường thì không tính)."""
    expected = decl.start_point[0]  # dòng (0-based) mà chú thích phải kết thúc ngay trước
    lines: list[str] = []
    prev = decl.prev_sibling
    while prev is not None:
        if prev.type == "annotation" and prev.end_point[0] + 1 >= expected:
            expected = prev.start_point[0]
        elif prev.type == "documentation_comment" and prev.end_point[0] + 1 == expected:
            lines.append(_clean_doc(_txt(prev)))
            expected = prev.start_point[0]
        else:
            break
        prev = prev.prev_sibling
    doc = "\n".join(reversed(lines)).strip()
    return doc[:_MAX_DOC] or None


def _string_value(n: TsNode) -> str:
    return _txt(n).strip().strip("'\"")


def _callee_name(sel: TsNode) -> tuple[str, TsNode] | None:
    """Tên người được gọi của một `selector` chứa `argument_part`, và nút đặt bằng chứng. None nếu không xác định."""
    parts: list[str] = []
    anchor = sel.prev_sibling
    prev = anchor
    while prev is not None:
        if prev.type == "selector":
            if _child(prev, "argument_part") is not None:
                before = prev.prev_sibling  # `Type(...).m(...)`: người nhận là đối tượng vừa dựng
                if before is not None and before.type == "identifier" and _txt(before)[:1].isupper():
                    parts.append(f"{_txt(before)}()")
                    break
                return None
            t = _txt(prev).strip()
            if "[" in t or not t.startswith((".", "?.")):
                return None
            parts.append(t.lstrip("?"))
            prev = prev.prev_sibling
        elif prev.type in ("identifier", "this", "super"):
            parts.append(_txt(prev))
            break
        else:
            return None
    else:
        return None
    return "".join(reversed(parts)), anchor if anchor is not None else sel


def _first_string_arg(sel: TsNode) -> str | None:
    args = _child(sel.children[0], "arguments") if sel.children else None
    if args is None:
        return None
    first = next((c for c in args.children if c.is_named), None)
    if first is None:
        return None
    lit = first if first.type == "string_literal" else _child(first, "string_literal")
    return _string_value(lit) if lit is not None else None


def _infer_type(expr_nodes: list[TsNode]) -> str | None:
    """Kiểu suy ra từ vế phải dạng `Type(...)`, `const Type(...)` hoặc `await Type(...)`."""
    for i, n in enumerate(expr_nodes):
        if n.type in ("await_expression", "unary_expression", "parenthesized_expression"):
            t = _infer_type(list(n.children))
            if t:
                return t
        if n.type in ("const_object_expression", "new_expression"):
            tid = _child(n, "type_identifier")
            return _txt(tid) if tid is not None else None
        if n.type == "identifier" and _txt(n)[:1].isupper() and i + 1 < len(expr_nodes):
            nxt = expr_nodes[i + 1]
            if nxt.type == "selector" and _child(nxt, "argument_part") is not None:
                return _txt(n)
    return None


def _declared_or_inferred(parent: TsNode, name_node: TsNode, after: list[TsNode]) -> str | None:
    t = _child(parent, "type_identifier")
    if t is not None and t.start_byte < name_node.start_byte:
        return _txt(t)
    return _infer_type(after)


def _param_bindings(sig: TsNode) -> dict[str, str]:
    out: dict[str, str] = {}
    plist = _child(sig, "formal_parameter_list")
    if plist is None:
        return out
    for p in _walk(plist):
        if p.type == "formal_parameter":
            t, ident = _child(p, "type_identifier"), [c for c in p.children if c.type == "identifier"]
            if t is not None and ident:
                out[_txt(ident[-1])] = _txt(t)
    return out


def _local_bindings(body: TsNode) -> dict[str, str]:
    out: dict[str, str] = {}
    for n in _walk(body):
        if n.type == "initialized_variable_definition":
            ident = _child(n, "identifier")
            if ident is None:
                continue
            after = [c for c in n.children if c.start_byte > ident.start_byte]
            t = _declared_or_inferred(n, ident, after)
            if t:
                out[_txt(ident)] = t
    return out


def _field_bindings(class_body: TsNode) -> dict[str, str]:
    out: dict[str, str] = {}
    for decl in class_body.children:
        if decl.type != "declaration":
            continue
        lst = _child(decl, "initialized_identifier_list")
        if lst is None:
            continue
        for init in lst.children:
            if init.type != "initialized_identifier":
                continue
            ident = _child(init, "identifier")
            if ident is None:
                continue
            after = [c for c in init.children if c.start_byte > ident.start_byte]
            t = _declared_or_inferred(decl, ident, after)
            if t:
                out[_txt(ident)] = t
    return out


def extract_dart(rel_path: str, source: bytes, *, is_test: bool) -> FileExtraction:
    if source.startswith(b"\xef\xbb\xbf"):
        source = source[3:]
    tree = _parser().parse(source)
    root = tree.root_node
    fid = file_node_id(rel_path)

    nodes: list[Node] = []
    edges: list[Edge] = []
    refs: list[UnresolvedRef] = []
    bindings: dict[str, dict[str, str]] = {}
    scopes: dict[int, str] = {}  # start_byte của function_body -> id nút hàm/method
    used_ids: set[str] = set()

    def add_node(kind: NodeKind, qname: str, label: str, n_start: TsNode, n_end: TsNode, sig: str | None,
                 parent_id: str) -> str:
        nid = node_id(rel_path, qname, kind)
        if nid in used_ids:  # getter/setter trùng tên hoặc khai báo lặp
            nid = node_id(rel_path, f"{qname}@{n_start.start_point[0] + 1}", kind)
        used_ids.add(nid)
        nodes.append(Node(id=nid, kind=kind, label=label, qualified_name=qname, file=rel_path,
                          line_start=n_start.start_point[0] + 1, line_end=_end_line(n_end), is_test=is_test,
                          signature=sig, doc=_doc_for(n_start)))
        edges.append(Edge(source=parent_id, target=nid, type=EdgeType.DEFINES))
        return nid

    def add_ref(source_id: str, name: str, type_: EdgeType, at: TsNode) -> None:
        refs.append(UnresolvedRef(source=source_id, name=name, type=type_, line=at.start_point[0] + 1,
                                  col=at.start_point[1]))

    def add_callable(owner: str | None, sig_holder: TsNode, sig: TsNode, body: TsNode | None, parent_id: str,
                     class_binding: dict[str, str] | None) -> None:
        name_node = _child(sig, "identifier")
        if name_node is None:
            return
        name = _txt(name_node) + ("=" if sig.type == "setter_signature" else "")
        qname = f"{owner}.{name}" if owner else name
        kind = NodeKind.METHOD if owner else NodeKind.FUNCTION
        end_node = body if body is not None else sig_holder
        nid = add_node(kind, qname, name, sig_holder, end_node, _signature_text(sig_holder, body, source), parent_id)
        if body is not None:
            scopes[body.start_byte] = nid
            b = {**_param_bindings(sig), **_local_bindings(body)}
            if b:
                bindings[nid] = b

    def handle_members(owner: str, owner_id: str, container: TsNode) -> None:
        kids = container.children
        for i, c in enumerate(kids):
            if c.type == "method_signature":
                sig = next((x for x in c.children if x.type in ("function_signature", "getter_signature",
                                                                  "setter_signature")), None)
                body = kids[i + 1] if i + 1 < len(kids) and kids[i + 1].type == "function_body" else None
                if sig is not None:
                    add_callable(owner, c, sig, body, owner_id, None)
            elif c.type == "declaration":
                sig = next((x for x in c.children if x.type in ("function_signature", "getter_signature")), None)
                if sig is not None:  # khai báo trừu tượng, không thân hàm
                    add_callable(owner, c, sig, None, owner_id, None)

    def handle_type(n: TsNode, kind: NodeKind) -> None:
        ident = _child(n, "identifier")
        body = _child(n, "class_body", "enum_body", "extension_body")
        if kind == NodeKind.EXTENSION:
            target = _child(n, "type_identifier")
            name = _txt(ident) if ident is not None else f"extension on {_txt(target) if target is not None else '?'}"
        elif ident is not None:
            name = _txt(ident)
        else:
            return
        superclass = _child(n, "superclass")
        if kind == NodeKind.CLASS and superclass is not None:
            base = _child(superclass, "type_identifier")
            if base is not None and _txt(base) in WIDGET_BASES:
                kind = NodeKind.WIDGET
        nid = add_node(kind, name, name, n, n, _signature_text(n, body, source), fid)
        if body is not None:
            fb = _field_bindings(body) if body.type == "class_body" else {}
            if fb:
                bindings[nid] = fb
            handle_members(name, nid, body)
        if superclass is not None:
            base = _child(superclass, "type_identifier")
            if base is not None:
                add_ref(nid, _txt(base), EdgeType.INHERITS, base)
            mixins = _child(superclass, "mixins")
            for m in (mixins.children if mixins is not None else []):
                if m.type == "type_identifier":
                    add_ref(nid, f"mixin:{_txt(m)}", EdgeType.INHERITS, m)
        interfaces = _child(n, "interfaces")
        for t in (interfaces.children if interfaces is not None else []):
            if t.type == "type_identifier":
                add_ref(nid, _txt(t), EdgeType.IMPLEMENTS, t)
        if kind == NodeKind.MIXIN:
            on = next((c for c in n.children if c.type == "type_identifier"), None)
            if on is not None:
                add_ref(nid, f"on:{_txt(on)}", EdgeType.INHERITS, on)

    # --- khai báo cấp cao nhất ---------------------------------------------------------
    top = root.children
    for i, n in enumerate(top):
        if n.type == "class_definition":
            handle_type(n, NodeKind.CLASS)
        elif n.type == "mixin_declaration":
            handle_type(n, NodeKind.MIXIN)
        elif n.type == "enum_declaration":
            handle_type(n, NodeKind.ENUM)
        elif n.type == "extension_declaration":
            handle_type(n, NodeKind.EXTENSION)
        elif n.type == "function_signature":
            body = top[i + 1] if i + 1 < len(top) and top[i + 1].type == "function_body" else None
            add_callable(None, n, n, body, fid, None)
        elif n.type == "import_or_export" or n.type == "part_directive":
            kind_prefix = ""
            directive = _child(n, "library_import", "library_export") or n
            if directive.type == "library_export":
                kind_prefix = "export:"
            elif n.type == "part_directive":
                kind_prefix = "part:"
            lit = next((x for x in _walk(directive) if x.type == "string_literal"), None)
            if lit is not None:
                add_ref(fid, kind_prefix + _string_value(lit), EdgeType.IMPORTS, n)

    # --- test(...) trong tệp kiểm thử -------------------------------------------------------
    test_ranges: list[tuple[int, int, str]] = []
    if is_test:
        for sel in (x for x in _walk(root) if x.type == "selector" and _child(x, "argument_part") is not None):
            called = _callee_name(sel)
            if called is None or called[0] not in TEST_CALLS:
                continue
            desc = _first_string_arg(sel)
            base = sel.prev_sibling
            while base is not None and base.prev_sibling is not None:
                base = base.prev_sibling
            if desc is None or base is None:
                continue
            nid = node_id(rel_path, desc, NodeKind.TEST)
            qname = desc if nid not in used_ids else f"{desc}@{base.start_point[0] + 1}"
            nodes.append(Node(id=node_id(rel_path, qname, NodeKind.TEST), kind=NodeKind.TEST, label=desc,
                              qualified_name=qname, file=rel_path, line_start=base.start_point[0] + 1,
                              line_end=_end_line(sel), is_test=True))
            used_ids.add(nodes[-1].id)
            edges.append(Edge(source=fid, target=nodes[-1].id, type=EdgeType.DEFINES))
            test_ranges.append((base.start_byte, sel.end_byte, nodes[-1].id))

    def owner_of(at: TsNode, own_range: tuple[int, int]) -> str | None:
        inner = [r for r in test_ranges if r[0] <= at.start_byte and at.end_byte <= r[1] and (r[0], r[1]) != own_range]
        if inner:
            return min(inner, key=lambda r: r[1] - r[0])[2]
        p = at.parent
        while p is not None:
            if p.type == "function_body" and p.start_byte in scopes:
                return scopes[p.start_byte]
            p = p.parent
        return None

    # --- lời gọi -------------------------------------------------------------------------------
    for n in _walk(root):
        name: str | None = None
        at = n
        if n.type == "selector" and _child(n, "argument_part") is not None:
            called = _callee_name(n)
            if called is None:
                continue
            name, at = called
            first = n.prev_sibling
            while first is not None and first.prev_sibling is not None:
                first = first.prev_sibling
            own = (first.start_byte if first is not None else n.start_byte, n.end_byte)
        elif n.type in ("const_object_expression", "new_expression"):
            tid = _child(n, "type_identifier")
            args = _child(n, "arguments")
            if tid is None or args is None:
                continue
            name = _strip_generics(source[tid.start_byte:args.start_byte].decode("utf-8", "replace")).replace(" ", "")
            own = (n.start_byte, n.end_byte)
        else:
            continue
        if is_test and name in _NOISE_IN_TESTS:
            continue
        src = owner_of(n, own)
        if src is not None:
            add_ref(src, name, EdgeType.CALLS, at)

    errors: list[tuple[str, str]] = []
    if root.has_error:
        bad = next((x for x in _walk(root) if x.type == "ERROR" or x.is_missing), None)
        where = f"dòng {bad.start_point[0] + 1}" if bad is not None else "không rõ vị trí"
        errors.append(("parse_partial" if nodes else "parse_unusable", f"Cú pháp lỗi tại {where}"))
    return FileExtraction(nodes=nodes, edges=edges, refs=refs, bindings=bindings, errors=errors)
