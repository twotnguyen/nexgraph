"""Bộ chuyển đổi cho các ngôn ngữ ngoài Dart (đồ thị chung, spec §6.3 mục 3).

Gọi bộ trích xuất đa ngôn ngữ cho từng tệp một vì id của nó (dựa trên tên tệp không kèm thư mục) có thể trùng giữa các thư mục.
Bộ trích xuất này chỉ cho dòng bắt đầu nên `line_end` là ước lượng: dòng lớn nhất trong bằng chứng của các cạnh xuất phát từ nút.
Gọi từng tệp làm `extract()` bỏ mất lời gọi sang tệp khác (nó chỉ phân giải `raw_calls` trong tập tệp được truyền vào),
nên chạy thêm bộ trích xuất của riêng tệp để lấy `raw_calls` và đổi thành `UnresolvedRef(CALLS)` cho `resolver.py` nối.
"""
from __future__ import annotations

import ast
import atexit
import logging
import re
import tempfile
from pathlib import Path

from graphify.extract import _get_extractor, _safe_extract_with_xaml_root, extract

from nexgraph_engine.dart.extractor import FileExtraction
from nexgraph_engine.index.discovery import CONFIG_LANGUAGES, LANGUAGE_BY_EXT, is_batch_language
from nexgraph_engine.ids import file_node_id, node_id
from nexgraph_engine.schema.enums import Confidence, EdgeType, NodeKind, Origin
from nexgraph_engine.store.models import Edge, Node, UnresolvedRef

logger = logging.getLogger(__name__)

_cache_dir: tempfile.TemporaryDirectory | None = None


def _cache_root() -> Path:
    # Một thư mục cache duy nhất cho cả tiến trình (bộ trích xuất cảnh báo khi đổi cache root giữa các lần gọi).
    global _cache_dir
    if _cache_dir is None:
        _cache_dir = tempfile.TemporaryDirectory(prefix="nexgraph-extract-")
        atexit.register(_cache_dir.cleanup)
    return Path(_cache_dir.name)


def reset_cache_root() -> None:
    """"Index lại từ đầu" (W2): bỏ cache AST của bộ trích xuất trong tiến trình này."""
    global _cache_dir
    if _cache_dir is not None:
        _cache_dir.cleanup()
        _cache_dir = None


def _line(loc: str | None) -> int | None:
    m = re.match(r"L(\d+)", loc or "")
    return int(m.group(1)) if m else None


def extract_generic(root: Path, rel_path: str, language: str, *, is_test: bool) -> FileExtraction:
    root = Path(root).resolve()  # gốc là symlink thì kết quả lấy từ cache của bộ trích xuất mang id theo đường dẫn khác
    path = root / rel_path
    if not path.is_file():
        return FileExtraction(errors=[("read", f"Không đọc được {rel_path}")])
    try:
        result = extract([path], cache_root=_cache_root(), root=Path(root), parallel=False)
    except Exception as exc:  # bộ trích xuất có thể ném lỗi trên cú pháp lạ; không để job dừng
        logger.warning("Bộ trích xuất lỗi trên %s (%s)", rel_path, language, exc_info=True)
        return FileExtraction(errors=[("extract", f"Bộ trích xuất lỗi: {exc}")])
    if result.get("failed_sources"):
        return FileExtraction(errors=[("extract", f"Bộ trích xuất không đọc được {rel_path} ({language})")])

    fid = file_node_id(rel_path)
    base = path.name
    file_gid = next((n["id"] for n in result["nodes"] if n.get("label") == base), "")
    # Ngôn ngữ có từ trước W2 giữ đúng cách lọc cũ (chỉ node `_callable`) để số node/cạnh không đổi.
    full = language not in _LEGACY_LANGUAGES
    raw = {n["id"]: n for n in result["nodes"] if _keep(n, base, full)}
    raw_edges = result["edges"]

    parent_class: dict[str, str] = {e["target"]: e["source"] for e in raw_edges if e["relation"] == "method"}
    type_sources = {e["source"] for e in raw_edges if e["relation"] in _TYPE_RELATIONS}
    # Thành viên dữ liệu (biến thể enum, hằng trong kiểu) mang tên cha để id không phải phân biệt bằng số dòng.
    data_parent = {e["target"]: e["source"] for e in raw_edges
                   if full and e["relation"] in ("defines", "case_of", "contains") and e["source"] in raw
                   and e["source"] != e["target"]}
    qnames: dict[str, tuple[str, NodeKind]] = {}
    for gid, n in raw.items():
        name = _plain_name(raw, gid)
        if full:
            name = name.replace("::", ".")
        callable_ = bool(n.get("_callable")) or (full and _looks_callable(n))
        if n.get("_callable_class"):
            qnames[gid] = (name, NodeKind.CLASS)
        elif callable_ and gid in parent_class and parent_class[gid] in raw:
            parent = _plain_name(raw, parent_class[gid]).replace("::", ".") if full else _plain_name(raw, parent_class[gid])
            qnames[gid] = (f"{parent}.{name}", NodeKind.METHOD)
        elif callable_:
            qnames[gid] = (name, NodeKind.FUNCTION)
        else:
            kind = _data_kind(n, name, language, gid in type_sources)
            if gid in data_parent:
                name = f"{_plain_name(raw, data_parent[gid]).replace('::', '.')}.{name}"
            qnames[gid] = (name, kind)
    ids: dict[str, str] = {}
    used: set[str] = set()
    first: dict[str, str] = {}  # id NexGraph -> gid đầu tiên mang id đó
    merged: set[str] = set()
    for gid in sorted(qnames, key=lambda g: _line(raw[g].get("source_location")) or 1):
        q, k = qnames[gid]
        nid = node_id(rel_path, q, k)
        if nid in used and k == NodeKind.METHOD:  # overload: gộp một nút như 0.9.92, id không phụ thuộc số dòng
            ids[gid] = nid
            merged.add(gid)
            continue
        if nid in used:  # hàm lồng cùng tên, hoặc khai báo lặp: cùng quy ước `@dòng` với Dart
            at = f"{q}@{_line(raw[gid].get('source_location')) or 1}"
            nid, n = node_id(rel_path, at, k), 1
            while nid in used:  # mã rút gọn: nhiều hàm cùng tên cùng dòng
                n += 1
                nid = node_id(rel_path, f"{at}.{n}", k)
        used.add(nid)
        ids[gid] = nid
        first[nid] = gid

    cross, type_table, scoped_types = _cross_file_calls(path, Path(root), raw, raw_edges, file_gid)
    # line_end ước lượng: dòng lớn nhất trong bằng chứng các cạnh đi ra; lớp bao luôn các phương thức của nó.
    end: dict[str, int] = {gid: _line(raw[gid].get("source_location")) or 1 for gid in raw}
    for e in raw_edges:
        # Ngôn ngữ mức chung: mọi quan hệ có thể thành cạnh (impl/extension tách khỏi thân kiểu) nới khoảng dòng (RB22).
        if e["source"] in end and (full or e["relation"] in ("calls", "imports", "imports_from")):
            end[e["source"]] = max(end[e["source"]], _line(e.get("source_location")) or 0)
    for caller, _, line in cross:
        if caller is not None and caller in end:
            end[caller] = max(end[caller], line)
    for gid in merged:
        end[first[ids[gid]]] = max(end[first[ids[gid]]], end[gid])
    for child, cls in parent_class.items():
        if cls in end and child in end:
            end[cls] = max(end[cls], end[child])

    nodes = [
        Node(id=ids[gid], kind=qnames[gid][1], label=qnames[gid][0].split(".")[-1], qualified_name=qnames[gid][0],
             file=rel_path, line_start=_line(raw[gid].get("source_location")) or 1, line_end=end[gid],
             is_test=is_test, origin=Origin.AST)
        for gid in raw if gid not in merged
    ]
    edges: list[Edge] = []
    refs: list[UnresolvedRef] = []
    labels = {n["id"]: n["label"] for n in result["nodes"] if not n.get("source_file")}
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    shadowed_aliases = _py_shadowed_aliases(path)
    from_lines = {_line(e.get("source_location")) for e in raw_edges if e.get("relation") == "imports_from"}
    from_lines.discard(None)
    # 0.9.112 tách constructor/indexer/operator C# thành nút không `_callable`: lời gọi của chúng thuộc về lớp như 0.9.92.
    owner = {c: p for c, p in parent_class.items() if c not in raw and p in raw}
    for e in raw_edges:
        rel, src, dst, line = e["relation"], owner.get(e["source"], e["source"]), e["target"], _line(e.get("source_location"))
        conf = Confidence.INFERRED if e.get("confidence") == "INFERRED" else Confidence.EXTRACTED
        score = 1.0 if conf == Confidence.EXTRACTED else 0.8
        if rel in ("contains", "method") or (full and rel in ("defines", "case_of")):
            parent = ids.get(src) if rel == "method" or (full and src in ids) else fid
            if parent and dst in ids:
                edges.append(Edge(source=parent, target=ids[dst], type=EdgeType.DEFINES))
        elif full and rel in ("indirect_call", "dispatches_to") and src in ids and dst in ids:
            edges.append(Edge(source=ids[src], target=ids[dst], type=EdgeType.CALLS, confidence=Confidence.INFERRED,
                              confidence_score=0.8, line=line, subtype=rel))
        elif full and rel in _HERITAGE and src in ids and line:
            etype, sub = _HERITAGE[rel]
            if dst in ids:
                edges.append(Edge(source=ids[src], target=ids[dst], type=etype, confidence=conf,
                                  confidence_score=score, line=line, subtype=sub))
            else:
                base_name = (labels.get(dst) or dst).replace("::", ".").split(".")[-1]
                refs.append(UnresolvedRef(source=ids[src], name=base_name, type=etype, line=line, col=0))
        elif full and rel in _REFERENCE_RELATIONS and src in ids and dst in ids and ids[src] != ids[dst]:
            edges.append(Edge(source=ids[src], target=ids[dst], type=_REFERENCE_RELATIONS[rel], confidence=conf,
                              confidence_score=score, line=line, subtype=None if rel == "references" else rel))
        elif rel in ("imports", "imports_from") and line:
            if rel == "imports" and line in from_lines:
                continue
            # id tệp đích của `#include` mất phần mở rộng (`util.h`, `util.cpp` cùng là `cpp_util`): lấy lại đường dẫn gốc
            inc = _C_INCLUDE.match(lines[line - 1]) if line <= len(lines) else None
            name = inc.group(1).strip('"') if inc else dst  # `<...>` giữ ngoặc nhọn: resolver phân biệt include hệ thống với đường dẫn tương đối
            refs.append(UnresolvedRef(source=fid, name=name, type=EdgeType.IMPORTS, line=line, col=0))
        elif rel == "calls" and src in ids and line:
            if dst.partition(".")[0] in shadowed_aliases:
                continue  # `models.User()` với `models` là biến/tham số che bí danh mô-đun (M1)
            foreign = _foreign_receiver(lines, line, qnames[dst][0].split(".")[-1]) if dst in ids else None
            if foreign and foreign.partition(".")[0] in shadowed_aliases:
                continue  # extractor khớp nhầm `models.User()` vào lớp cục bộ; `models` là biến che (M1)
            if foreign:  # extractor chỉ khớp theo tên: `bcrypt.compare()` không phải phương thức `compare` của lớp này
                refs.append(UnresolvedRef(source=ids[src], name=f"{foreign}.{qnames[dst][0].split('.')[-1]}", type=EdgeType.CALLS,
                                          line=line, col=0))
            elif dst in ids:
                edges.append(Edge(source=ids[src], target=ids[dst], type=EdgeType.CALLS, confidence=conf,
                                  confidence_score=score, line=line,
                                  subtype="construct" if qnames[dst][1] == NodeKind.CLASS else None))
            else:
                refs.append(UnresolvedRef(source=ids[src], name=dst, type=EdgeType.CALLS, line=line, col=0))
        elif rel == "inherits" and src in ids and line:
            # lớp cha ở tệp khác là nút giữ chỗ id viết thường; tên thật nằm ở nhãn, dạng `mod.Base` lấy phần cuối
            base = (labels.get(dst) or dst).split(".")[-1]
            refs.append(UnresolvedRef(source=ids[src], name=base, type=EdgeType.INHERITS, line=line, col=0))
    # Ngôn ngữ mức chung: lời gọi không rõ hàm gọi sẽ được batch_calls nối đúng hàm; không gán cho cả tệp.
    batch = is_batch_language(language)
    refs += [UnresolvedRef(source=fid if c is None else ids[c], name=name, type=EdgeType.CALLS, line=line, col=0)
             for c, name, line in cross if not (batch and c is None)]
    if path.suffix in _TS_SUFFIXES:
        have = {(r.source, r.name, r.type) for r in refs}
        for gid, (_, kind) in qnames.items():
            if kind == NodeKind.CLASS:
                line = _line(raw[gid].get("source_location")) or 1
                for rtype, name in _ts_heritage(lines, line):
                    if (ids[gid], name, rtype) not in have:
                        refs.append(UnresolvedRef(source=ids[gid], name=name, type=rtype, line=line, col=0))
    bindings = {fid: type_table} if type_table else {}
    bindings.update({ids[gid]: types for gid, types in scoped_types.items() if gid in ids and types})
    return FileExtraction(nodes=nodes, edges=edges, refs=refs, bindings=bindings)


def _cross_file_calls(path: Path, root: Path, raw: dict, raw_edges: list[dict], file_gid: str = "") -> tuple[list[tuple[str | None, str, int]], dict[str, str], dict[str, dict[str, str]]]:
    """Lời gọi chưa nối, bảng kiểu TS toàn tệp và các bảng kiểu theo callable."""
    extractor = _get_extractor(path)
    if extractor is None:
        return [], {}, {}
    # shortcut: parse tệp lần hai (lập chỉ mục chậm ~60% với TS/Python, đo 2026-11-12), đổi sang chỉ dùng kết quả riêng tệp khi tầng S chạm 60 s.
    try:
        per_file = _safe_extract_with_xaml_root(extractor, path, root)
    except Exception:  # lỗi ở lần đọc thứ hai không được làm mất kết quả của lần đầu
        logger.warning("Không đọc lại được %s để lấy lời gọi liên tệp", path, exc_info=True)
        return [], {}, {}
    # Id trong kết quả riêng tệp mang tiền tố đường dẫn tuyệt đối; id của extract() là đuôi của nó.
    by_suffix = sorted(raw, key=len, reverse=True)
    done = {(e["source"], _line(e.get("source_location")), _plain_name(raw, e["target"]))  # extract() đã nối
            for e in raw_edges if e["relation"] == "calls" and e["target"] in raw}
    out: list[tuple[str | None, str, int]] = []
    scoped_types = _ts_scoped_types(path, raw) if path.suffix in _TS_SUFFIXES else {}
    python = path.suffix in _PY_SUFFIXES
    source = path.read_bytes() if python else b""
    if python:
        scoped_types.update(_py_scoped_types(source, raw))
    aliases = _py_module_aliases(source) if python else {}
    shadowed_aliases = _py_shadowed_aliases(path) if python else set()
    if aliases:
        # Tên mô-đun bị biến cục bộ/tham số che: bỏ bí danh và bỏ luôn lời gọi kiểu `models.User()`
        # (ưu tiên chính xác hơn độ phủ — Minor #34 M1).
        aliases = {name: module for name, module in aliases.items() if name not in shadowed_aliases}
    per_file_fid = next((n["id"] for n in per_file.get("nodes", []) if n.get("label") == path.name), None)
    for rc in per_file.get("raw_calls") or []:
        caller_nid = rc.get("caller_nid") or ""
        if caller_nid == per_file_fid or (file_gid and (
            caller_nid == file_gid
            or caller_nid.endswith("_" + file_gid)
            or caller_nid.endswith("_" + file_gid + "_" + path.suffix.lstrip("."))
        )):
            caller = None
        else:
            caller = next((g for g in by_suffix if caller_nid == g or caller_nid.endswith("_" + g)), None)
            if caller is None:
                continue
        line, callee, recv = _line(rc.get("source_location")), rc.get("callee"), rc.get("receiver")
        if not line or not callee:
            continue
        if rc.get("_python_receiver_shadowed") and recv in shadowed_aliases:
            # Bộ trích xuất cũng thấy receiver trùng tên biến/tham số: không đoán đó là mô-đun (M1).
            continue
        if not recv and rc.get("is_member_call"):
            recv = _call_receiver(source, rc)  # `self.repo.save()` / `app.models.User()`: receiver bị extractor ẩn
        if recv in ("self", "this"):
            name = f"this.{callee}"
        elif recv:
            if recv in shadowed_aliases:
                continue  # biến/tham số trùng tên mô-đun: không đoán đó là mô-đun (M1)
            name = f"{aliases.get(recv, recv)}.{callee}"  # `import pkg.mod as m` → m.x thành pkg.mod.x
        elif rc.get("is_member_call"):
            continue  # `X().m()`: không biết kiểu của receiver, không đoán
        else:
            name = callee
        if (caller, line, callee) in done:
            continue
        out.append((caller, name, line))
    tbl = per_file.get("ts_type_table", {}).get("table") or {}
    types = {str(k): str(v) for k, v in tbl.items() if isinstance(k, str) and isinstance(v, str)}
    scoped_names = {name for names in scoped_types.values() for name in names}
    types = {name: type_name for name, type_name in types.items() if name not in scoped_names}
    return out, types, scoped_types


def _ts_scoped_types(path: Path, raw: dict) -> dict[str, dict[str, str]]:
    """Đọc tham số và local `new` TS theo callable, không cho phép rò giữa các hàm."""
    try:
        from tree_sitter import Language, Parser
        import tree_sitter_typescript

        source = path.read_bytes()
        language = tree_sitter_typescript.language_tsx if path.suffix.lower() == ".tsx" else tree_sitter_typescript.language_typescript
        parser = Parser(Language(language()))
        tree = parser.parse(source)
    except Exception:
        logger.warning("Không đọc được kiểu theo hàm của %s", path, exc_info=True)
        return {}
    by_line: dict[int, list[str]] = {}
    for gid, node in raw.items():
        line = _line(node.get("source_location"))
        if line:
            by_line.setdefault(line, []).append(gid)
    out: dict[str, dict[str, str]] = {}
    callable_types = {"function_declaration", "generator_function_declaration", "method_definition",
                      "function_expression", "generator_function", "arrow_function"}

    def text(node) -> str:
        return source[node.start_byte:node.end_byte].decode("utf-8")

    def bare_type(annotation) -> str | None:
        names = [child for child in annotation.children if child.type == "type_identifier"]
        others = [child for child in annotation.children if child.is_named and child.type != "type_identifier"]
        return text(names[0]) if len(names) == 1 and not others else None

    def bindings_for(node) -> dict[str, str]:
        types: dict[str, str] = {}
        params = node.child_by_field_name("parameters")
        for param in params.named_children if params is not None else ():
            pattern, annotation = param.child_by_field_name("pattern"), param.child_by_field_name("type")
            if pattern is not None and pattern.type == "identifier" and annotation is not None:
                type_name = bare_type(annotation)
                if type_name:
                    types[text(pattern)] = type_name
        stack = list(node.children)
        while stack:
            child = stack.pop()
            if child is not node and child.type in callable_types:
                continue
            if child.type == "variable_declarator":
                name, value = child.child_by_field_name("name"), child.child_by_field_name("value")
                ctor = value.child_by_field_name("constructor") if value is not None and value.type == "new_expression" else None
                if name is not None and name.type == "identifier" and ctor is not None and ctor.type in ("identifier", "type_identifier"):
                    types[text(name)] = text(ctor)
            stack.extend(child.children)
        return types

    stack = [tree.root_node]
    while stack:
        node = stack.pop()
        if node.type == "class_declaration":
            name, body = node.child_by_field_name("name"), node.child_by_field_name("body")
            gids = [gid for gid, raw_node in raw.items()
                    if raw_node.get("_callable_class") and name is not None and _plain_name(raw, gid) == text(name)]
            if len(gids) == 1 and body is not None:
                fields: dict[str, str] = {}
                for member in body.named_children:
                    member_name = member.child_by_field_name("name")
                    if member.type == "method_definition" and member_name is not None and text(member_name) == "constructor":
                        params = member.child_by_field_name("parameters")
                        for param in params.named_children if params is not None else ():
                            pattern, annotation = param.child_by_field_name("pattern"), param.child_by_field_name("type")
                            is_field = any(c.type in ("accessibility_modifier", "readonly") for c in param.children)
                            type_name = bare_type(annotation) if annotation is not None else None
                            if is_field and pattern is not None and pattern.type == "identifier" and type_name:
                                fields[text(pattern)] = type_name
                if fields:
                    out[gids[0]] = fields
        if node.type in callable_types:
            gids = by_line.get(node.start_point[0] + 1, [])
            types = bindings_for(node)
            if len(gids) == 1 and types:
                out[gids[0]] = types
        stack.extend(node.children)
    return out


_TS_SUFFIXES = {".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"}
_HEADER_LINES = 8  # tiêu đề lớp (decorator, generic, danh sách implements) hiếm khi dài hơn thế
# shortcut: tách tiêu đề lớp bằng regex trên văn bản; extractor gốc chỉ phát cạnh kế thừa khi lớp cha nằm cùng tập tệp.
# Giới hạn: lớp cha là biểu thức (`extends mixin(A, B)`) bỏ qua. Nâng lên khi đọc cây cú pháp của extractor.
_EXTENDS = re.compile(r"\bextends\s+([\w$.]+)")
_IMPLEMENTS = re.compile(r"\bimplements\s+([^{]+)")


def _strip_generics(text: str) -> str:
    depth, out = 0, []
    for ch in text:
        depth += ch == "<"
        if not depth:
            out.append(ch)
        depth -= ch == ">" and depth > 0
    return "".join(out)


def _ts_heritage(lines: list[str], line: int) -> list[tuple[EdgeType, str]]:
    header = " ".join(lines[line - 1:line - 1 + _HEADER_LINES])
    header = _strip_generics(header.split("{", 1)[0])
    out: list[tuple[EdgeType, str]] = []
    ext = _EXTENDS.search(header)
    if ext:
        out.append((EdgeType.INHERITS, ext.group(1).split(".")[-1]))
    impl = _IMPLEMENTS.search(header)
    if impl:
        out += [(EdgeType.IMPLEMENTS, n.strip().split(".")[-1]) for n in impl.group(1).split(",") if n.strip()]
    return out


_C_INCLUDE = re.compile(r'\s*#\s*(?:include|import)\s*("[^"]+"|<[^>]+>)')
_OWN_RECEIVERS = {"this", "self", "cls", "super"}


def _foreign_receiver(lines: list[str], line: int, callee: str) -> str | None:
    """`x.callee(` trên dòng `line` với x không phải this/self: trả x (đoạn cuối của chuỗi receiver), ngược lại None."""
    if not 1 <= line <= len(lines):
        return None
    hit = re.search(rf"([\w$]+(?:\.[\w$]+)*)\.{re.escape(callee)}\s*\(", lines[line - 1])
    if not hit:
        return None
    chain = hit.group(1).split(".")
    return None if chain[-1] in _OWN_RECEIVERS else chain[-1]


_LEGACY_LANGUAGES = frozenset(LANGUAGE_BY_EXT.values())
_TYPE_RELATIONS = frozenset({"method", "inherits", "implements", "mixes_in", "embeds", "case_of"})
_SKIP_META_KINDS = frozenset({"file", "bash_entrypoint"})  # nút đại diện cho chính tệp
# Quan hệ kế thừa của graphify → (EdgeType, loai_con).
_HERITAGE = {"inherits": (EdgeType.INHERITS, None), "implements": (EdgeType.IMPLEMENTS, None),
             "mixes_in": (EdgeType.INHERITS, "mixes_in")}
_REFERENCE_RELATIONS = {"references": EdgeType.REFERENCES, "uses": EdgeType.REFERENCES,
                        "instantiates": EdgeType.REFERENCES, "reads_from": EdgeType.REFERENCES,
                        "writes_to": EdgeType.REFERENCES, "embeds": EdgeType.COMPOSES}
_CONSTANT = re.compile(r"[A-Z][A-Z0-9_]*")


def _keep(n: dict, base: str, full: bool) -> bool:
    if n.get("label") == base:
        return False
    if not full:
        return bool(n.get("_callable"))
    return bool(n.get("source_file")) and (n.get("metadata") or {}).get("kind") not in _SKIP_META_KINDS


def _looks_callable(n: dict) -> bool:
    return n.get("label", "").endswith("()") or "function" in str((n.get("metadata") or {}).get("kind", ""))


def _data_kind(n: dict, name: str, language: str, is_type: bool) -> NodeKind:
    """Loại nút không gọi được của ngôn ngữ mức chung (W2): node graphify không có trường kind chung."""
    if is_type:
        return NodeKind.CLASS
    if language == "sql":
        return NodeKind.TABLE
    if language == "terraform":
        return NodeKind.RESOURCE
    if language in CONFIG_LANGUAGES:
        return NodeKind.CONFIG_KEY
    if n.get("label", "").startswith(".") or _CONSTANT.fullmatch(name.split(".")[-1]):
        return NodeKind.VARIABLE
    return NodeKind.TYPE


def _plain_name(raw: dict, gid: str) -> str:
    return re.sub(r"\(\)$", "", raw[gid]["label"]).lstrip(".")


_PY_SUFFIXES = {".py", ".pyi"}


def _call_receiver(source: bytes, rc: dict) -> str | None:
    """Chuỗi receiver của lời gọi Python (`self.repo` trong `self.repo.save()`), từ vị trí byte của extractor."""
    site = rc.get("_python_call_site")
    callee = rc.get("callee") or ""
    if not callee or not isinstance(site, list) or len(site) != 2:
        return None
    chunk = source[site[0]:site[1]].decode("utf-8", "replace")
    idx = chunk.rfind(f".{callee}")
    if idx <= 0:
        return None
    recv = chunk[:idx]
    # `X().m()`, `f().m()`: receiver không phải chuỗi tên → không đoán.
    return recv if re.fullmatch(r"[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*", recv) else None


def _py_module_aliases(source: bytes) -> dict[str, str]:
    """Tên cục bộ của mô-đun Python → đường dẫn mô-đun (`import a.b as m` → m: a.b).

    Chỉ nhận tên viết thường (quy ước mô-đun); `from pkg import Class` không bị đổi thành `pkg.Class`.
    """
    out: dict[str, str] = {}
    for raw_line in source.decode("utf-8", "replace").splitlines():
        line = raw_line.split("#", 1)[0].strip()
        match = re.match(r"import\s+([\w.]+)(?:\s+as\s+(\w+))?$", line)
        if match:
            module, alias = match.group(1), match.group(2)
            if alias and alias[:1].islower():
                out[alias] = module
            continue
        match = re.match(r"from\s+([\w.]+)\s+import\s+(.+)$", line)
        if match and not match.group(1).startswith("."):
            module, names = match.group(1), match.group(2)
            for part in names.split(","):
                bits = [piece.strip() for piece in part.split(" as ")]
                name, alias = bits[0], bits[-1]
                if name and name != "*" and alias[:1].islower():
                    out[alias] = f"{module}.{name}"
    return out


def _py_shadowed_aliases(path: Path) -> set[str]:
    """Bí danh mô-đun Python trùng tên một ràng buộc khác trong tệp (biến/tham số/lớp/hàm)."""
    if path.suffix not in _PY_SUFFIXES:
        return set()
    try:
        source = path.read_bytes()
    except OSError:
        return set()
    return {name for name in _py_module_aliases(source) if name in _py_shadowed_names(source)}


def _py_shadowed_names(source: bytes) -> set[str]:
    """Tên bị ràng buộc trong tệp (gán, tham số, for/with/except, def/class): bí danh mô-đun trùng tên không đáng tin.

    Chỉ thu thập ràng buộc *không* đến từ câu lệnh import — `import a.b as m` / `from a import m` chính là bí danh.
    Thô hơn phạm vi hàm (một tên bị che ở bất kỳ đâu thì bỏ bí danh cho cả tệp) để không tạo cạnh sai (M1).
    """
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return set()
    bound: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            bound.add(node.id)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            bound.add(node.name)
        elif isinstance(node, ast.arg):
            bound.add(node.arg)
        elif isinstance(node, ast.ExceptHandler) and node.name:
            bound.add(node.name)
        elif isinstance(node, (ast.Global, ast.Nonlocal)):
            bound.update(node.names)
    return bound


def _py_scoped_types(source: bytes, raw: dict) -> dict[str, dict[str, str]]:
    """Kiểu tĩnh của `self.x` theo lớp Python: gán `ClassName(...)`, `self.x: T`, thuộc tính lớp `x: T`.

    Mơ hồ (gán hai kiểu khác nhau) hoặc không suy ra được kiểu → bỏ thuộc tính, resolver không tạo cạnh.
    """
    try:
        from tree_sitter import Language, Parser
        import tree_sitter_python

        parser = Parser(Language(tree_sitter_python.language()))
        tree = parser.parse(source)
    except Exception:
        logger.warning("Không đọc được cây cú pháp Python để lấy kiểu self.x", exc_info=True)
        return {}
    by_line: dict[int, list[str]] = {}
    for gid, node in raw.items():
        line = _line(node.get("source_location"))
        if line:
            by_line.setdefault(line, []).append(gid)

    def text(node) -> str:
        return source[node.start_byte:node.end_byte].decode("utf-8", "replace")

    def type_name(node) -> str | None:
        """`Repo` / `mod.Repo` → `Repo`; `list[Repo]`, `Repo | None`, `None` → None (không đoán)."""
        if node is None:
            return None
        if node.type == "identifier":
            return text(node)
        if node.type == "attribute":
            attr = node.child_by_field_name("attribute")
            return text(attr) if attr is not None else None
        if node.type == "type" and len(node.named_children) == 1:
            return type_name(node.named_children[0])  # `(type (identifier))` của grammar Python
        return None

    def self_attr(node) -> str | None:
        if node is None or node.type != "attribute":
            return None
        obj, attr = node.child_by_field_name("object"), node.child_by_field_name("attribute")
        if obj is not None and obj.type == "identifier" and text(obj) == "self" and attr is not None:
            return text(attr)
        return None

    def fields_of(body) -> dict[str, str]:
        fields: dict[str, str] = {}
        ambiguous: set[str] = set()

        def add(attr: str, typ: str | None) -> None:
            if not typ or attr in ambiguous:
                return
            if attr in fields and fields[attr] != typ:
                fields.pop(attr, None)
                ambiguous.add(attr)
                return
            fields[attr] = typ

        def scan(node) -> None:
            stack = [node]
            while stack:
                current = stack.pop()
                if current is None:
                    continue
                if current.type == "assignment":
                    attr = self_attr(current.child_by_field_name("left"))
                    if attr:
                        annotation = current.child_by_field_name("type")
                        right = current.child_by_field_name("right")
                        if annotation is not None:
                            add(attr, type_name(annotation))
                        elif right is not None and right.type == "call":
                            add(attr, type_name(right.child_by_field_name("function")))
                        elif right is not None and right.type == "identifier":
                            add(attr, local.get(text(right)))
                stack.extend(current.children)

        for member in body.named_children:
            if member.type == "expression_statement":
                for stmt in member.named_children:
                    if stmt.type == "assignment" and stmt.child_by_field_name("type") is not None:
                        left = stmt.child_by_field_name("left")
                        if left is not None and left.type == "identifier":
                            add(text(left), type_name(stmt.child_by_field_name("type")))
                continue
            if member.type != "function_definition":
                continue
            params = member.child_by_field_name("parameters")
            local: dict[str, str] = {}
            for param in params.named_children if params is not None else ():
                name = param.child_by_field_name("name")
                if name is None and param.type == "typed_parameter":
                    name = next((c for c in param.named_children if c.type == "identifier"), None)
                annotation = param.child_by_field_name("type")
                if name is not None and annotation is not None and text(name) != "self":
                    local[text(name)] = type_name(annotation)
            scan(member.child_by_field_name("body"))
        return fields

    out: dict[str, dict[str, str]] = {}
    stack = [tree.root_node]
    while stack:
        node = stack.pop()
        if node.type == "class_definition":
            name, body = node.child_by_field_name("name"), node.child_by_field_name("body")
            gid = next((g for g in by_line.get(node.start_point[0] + 1, [])
                        if raw[g].get("_callable_class") and _plain_name(raw, g) == (text(name) if name else "")), None)
            if gid is not None and body is not None:
                fields = fields_of(body)
                if fields:
                    out[gid] = fields
            continue  # lớp lồng nhau: kiểu của nó do `class_definition` bên trong xử lý
        stack.extend(node.children)
    return out
