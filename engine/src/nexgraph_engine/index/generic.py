"""Bộ chuyển đổi cho các ngôn ngữ ngoài Dart (đồ thị chung, spec §6.3 mục 3).

Gọi bộ trích xuất đa ngôn ngữ cho từng tệp một vì id của nó (dựa trên tên tệp không kèm thư mục) có thể trùng giữa các thư mục.
Bộ trích xuất này chỉ cho dòng bắt đầu nên `line_end` là ước lượng: dòng lớn nhất trong bằng chứng của các cạnh xuất phát từ nút.
Gọi từng tệp làm `extract()` bỏ mất lời gọi sang tệp khác (nó chỉ phân giải `raw_calls` trong tập tệp được truyền vào),
nên chạy thêm bộ trích xuất của riêng tệp để lấy `raw_calls` và đổi thành `UnresolvedRef(CALLS)` cho `resolver.py` nối.
"""
from __future__ import annotations

import atexit
import re
import tempfile
from pathlib import Path

from graphify.extract import _get_extractor, _safe_extract_with_xaml_root, extract

from nexgraph_engine.dart.extractor import FileExtraction
from nexgraph_engine.ids import file_node_id, node_id
from nexgraph_engine.schema.enums import Confidence, EdgeType, NodeKind, Origin
from nexgraph_engine.store.models import Edge, Node, UnresolvedRef

_cache_dir: tempfile.TemporaryDirectory | None = None


def _cache_root() -> Path:
    # Một thư mục cache duy nhất cho cả tiến trình (bộ trích xuất cảnh báo khi đổi cache root giữa các lần gọi).
    global _cache_dir
    if _cache_dir is None:
        _cache_dir = tempfile.TemporaryDirectory(prefix="nexgraph-extract-")
        atexit.register(_cache_dir.cleanup)
    return Path(_cache_dir.name)


def _line(loc: str | None) -> int | None:
    m = re.match(r"L(\d+)", loc or "")
    return int(m.group(1)) if m else None


def extract_generic(root: Path, rel_path: str, language: str, *, is_test: bool) -> FileExtraction:
    path = Path(root) / rel_path
    if not path.is_file():
        return FileExtraction(errors=[("read", f"Không đọc được {rel_path}")])
    try:
        result = extract([path], cache_root=_cache_root(), root=Path(root), parallel=False)
    except Exception as exc:  # bộ trích xuất có thể ném lỗi trên cú pháp lạ; không để job dừng
        return FileExtraction(errors=[("extract", f"Bộ trích xuất lỗi: {exc}")])
    if result.get("failed_sources"):
        return FileExtraction(errors=[("extract", f"Bộ trích xuất không đọc được {rel_path} ({language})")])

    fid = file_node_id(rel_path)
    base = path.name
    file_gid = next((n["id"] for n in result["nodes"] if n.get("label") == base), "")
    raw = {n["id"]: n for n in result["nodes"] if n.get("label") != base and n.get("_callable")}
    raw_edges = result["edges"]

    parent_class: dict[str, str] = {e["target"]: e["source"] for e in raw_edges if e["relation"] == "method"}
    qnames: dict[str, tuple[str, NodeKind]] = {}
    for gid, n in raw.items():
        name = _plain_name(raw, gid)
        if n.get("_callable_class"):
            qnames[gid] = (name, NodeKind.CLASS)
        elif gid in parent_class and parent_class[gid] in raw:
            qnames[gid] = (f"{_plain_name(raw, parent_class[gid])}.{name}", NodeKind.METHOD)
        else:
            qnames[gid] = (name, NodeKind.FUNCTION)
    ids: dict[str, str] = {}
    used: set[str] = set()
    for gid in sorted(qnames, key=lambda g: _line(raw[g].get("source_location")) or 1):
        q, k = qnames[gid]
        nid = node_id(rel_path, q, k)
        if nid in used:  # hàm lồng cùng tên, hoặc khai báo lặp: cùng quy ước `@dòng` với Dart
            at = f"{q}@{_line(raw[gid].get('source_location')) or 1}"
            nid, n = node_id(rel_path, at, k), 1
            while nid in used:  # mã rút gọn: nhiều hàm cùng tên cùng dòng
                n += 1
                nid = node_id(rel_path, f"{at}.{n}", k)
        used.add(nid)
        ids[gid] = nid

    cross, type_table = _cross_file_calls(path, Path(root), raw, raw_edges, file_gid)
    # line_end ước lượng: dòng lớn nhất trong bằng chứng các cạnh đi ra; lớp bao luôn các phương thức của nó.
    end: dict[str, int] = {gid: _line(raw[gid].get("source_location")) or 1 for gid in raw}
    for e in raw_edges:
        if e["source"] in end and e["relation"] in ("calls", "imports", "imports_from"):
            end[e["source"]] = max(end[e["source"]], _line(e.get("source_location")) or 0)
    for caller, _, line in cross:
        if caller is not None and caller in end:
            end[caller] = max(end[caller], line)
    for child, cls in parent_class.items():
        if cls in end and child in end:
            end[cls] = max(end[cls], end[child])

    nodes = [
        Node(id=ids[gid], kind=qnames[gid][1], label=qnames[gid][0].split(".")[-1], qualified_name=qnames[gid][0],
             file=rel_path, line_start=_line(raw[gid].get("source_location")) or 1, line_end=end[gid],
             is_test=is_test, origin=Origin.AST)
        for gid in raw
    ]
    edges: list[Edge] = []
    refs: list[UnresolvedRef] = []
    labels = {n["id"]: n["label"] for n in result["nodes"] if not n.get("source_file")}
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    from_lines = {_line(e.get("source_location")) for e in raw_edges if e.get("relation") == "imports_from"}
    from_lines.discard(None)
    for e in raw_edges:
        rel, src, dst, line = e["relation"], e["source"], e["target"], _line(e.get("source_location"))
        conf = Confidence.INFERRED if e.get("confidence") == "INFERRED" else Confidence.EXTRACTED
        score = 1.0 if conf == Confidence.EXTRACTED else 0.8
        if rel in ("contains", "method"):
            parent = ids.get(src) if rel == "method" else fid
            if parent and dst in ids:
                edges.append(Edge(source=parent, target=ids[dst], type=EdgeType.DEFINES))
        elif rel in ("imports", "imports_from") and line:
            if rel == "imports" and line in from_lines:
                continue
            refs.append(UnresolvedRef(source=fid, name=dst, type=EdgeType.IMPORTS, line=line, col=0))
        elif rel == "calls" and src in ids and line:
            foreign = _foreign_receiver(lines, line, qnames[dst][0].split(".")[-1]) if dst in ids else None
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
    refs += [UnresolvedRef(source=fid if c is None else ids[c], name=name, type=EdgeType.CALLS, line=line, col=0) for c, name, line in cross]
    if path.suffix in _TS_SUFFIXES:
        have = {(r.source, r.name, r.type) for r in refs}
        for gid, (_, kind) in qnames.items():
            if kind == NodeKind.CLASS:
                line = _line(raw[gid].get("source_location")) or 1
                for rtype, name in _ts_heritage(lines, line):
                    if (ids[gid], name, rtype) not in have:
                        refs.append(UnresolvedRef(source=ids[gid], name=name, type=rtype, line=line, col=0))
    bindings = {fid: type_table} if type_table else {}
    return FileExtraction(nodes=nodes, edges=edges, refs=refs, bindings=bindings)


def _cross_file_calls(path: Path, root: Path, raw: dict, raw_edges: list[dict], file_gid: str = "") -> tuple[list[tuple[str | None, str, int]], dict[str, str]]:
    """Lời gọi `extract()` không nối được trong tệp → ([(id Graphify của nút gọi hoặc None nếu ở mức tệp, tên, dòng)], bảng kiểu TS)."""
    extractor = _get_extractor(path)
    if extractor is None:
        return [], {}
    # shortcut: parse tệp lần hai (lập chỉ mục chậm ~60% với TS/Python, đo 2026-11-12), đổi sang chỉ dùng kết quả riêng tệp khi tầng S chạm 60 s.
    try:
        per_file = _safe_extract_with_xaml_root(extractor, path, root)
    except Exception:  # lỗi ở lần đọc thứ hai không được làm mất kết quả của lần đầu
        return [], {}
    # Id trong kết quả riêng tệp mang tiền tố đường dẫn tuyệt đối; id của extract() là đuôi của nó.
    by_suffix = sorted(raw, key=len, reverse=True)
    done = {(e["source"], _line(e.get("source_location")), _plain_name(raw, e["target"]))  # extract() đã nối
            for e in raw_edges if e["relation"] == "calls" and e["target"] in raw}
    out: list[tuple[str | None, str, int]] = []
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
        if recv in ("self", "this"):
            name = f"this.{callee}"
        elif recv:
            name = f"{recv}.{callee}"
        elif rc.get("is_member_call"):
            continue  # `X().m()`: không biết kiểu của receiver, không đoán
        else:
            name = callee
        if (caller, line, callee) in done:
            continue
        out.append((caller, name, line))
    tbl = per_file.get("ts_type_table", {}).get("table") or {}
    types = {str(k): str(v) for k, v in tbl.items() if isinstance(k, str) and isinstance(v, str)}
    return out, types


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


def _plain_name(raw: dict, gid: str) -> str:
    return re.sub(r"\(\)$", "", raw[gid]["label"]).lstrip(".")
