"""Giai đoạn 2: nối tham chiếu chưa phân giải thành cạnh có bằng chứng.

Nguyên tắc: chỉ tạo cạnh khi có đúng một ứng viên ở mức đầu tiên có ứng viên; nhiều ứng viên thì không đoán.
Điểm: 0,9 (cùng lớp/cùng tệp), 0,8 (tệp đã import), 0,5 (duy nhất trong project). Import khớp đường dẫn là chắc chắn (EXTRACTED).
"""
from __future__ import annotations

import posixpath
import re
from collections import defaultdict
from dataclasses import dataclass
from functools import lru_cache
from pathlib import PurePosixPath

from graphify.extract import _file_node_id

from nexgraph_engine.schema.enums import Confidence, EdgeType, NodeKind, Origin
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.models import Edge, Node, UnresolvedRef

TYPE_KINDS = {NodeKind.CLASS, NodeKind.WIDGET, NodeKind.MIXIN, NodeKind.ENUM}
SAME_SCOPE, IMPORTED, GLOBAL = 0.9, 0.8, 0.5


@dataclass(frozen=True)
class _Hit:
    node: Node
    score: float


def _package_name(pubspec_text: str | None) -> str | None:
    m = re.search(r"^name:\s*([A-Za-z0-9_]+)", pubspec_text or "", re.M)
    return m.group(1) if m else None


@lru_cache(maxsize=200_000)
def _gid(rel_path: str) -> str:
    """Id tệp theo bộ trích xuất đa ngôn ngữ; hàm thuần của đường dẫn nên nhớ lại giữa các lần refresh."""
    return _file_node_id(PurePosixPath(rel_path))


class _Index:
    def __init__(self, nodes: list[Node]) -> None:
        self.by_id = {n.id: n for n in nodes}
        self.files = {n.file for n in nodes if n.kind == NodeKind.FILE and n.file}
        # Bộ trích xuất đa ngôn ngữ (generic.py) đặt tên import là id tệp của nó (`pkg/mod.py` -> `pkg_mod`).
        by_gid: dict[str, list[str]] = defaultdict(list)
        for f in self.files:
            if not f.endswith(".dart"):
                by_gid[_gid(f)].append(f)
        self.file_by_gid = {g: fs[0] for g, fs in by_gid.items() if len(fs) == 1}  # trùng id thì không đoán
        self.types: dict[str, dict[str, list[Node]]] = defaultdict(lambda: defaultdict(list))
        self.funcs: dict[str, dict[str, list[Node]]] = defaultdict(lambda: defaultdict(list))
        self.members: dict[tuple[str, str], dict[str, list[Node]]] = defaultdict(lambda: defaultdict(list))
        self.g_types: dict[str, list[Node]] = defaultdict(list)
        self.g_funcs: dict[str, list[Node]] = defaultdict(list)
        for n in nodes:
            if not n.file:
                continue
            if n.kind in TYPE_KINDS:
                self.types[n.file][n.qualified_name].append(n)
                self.g_types[n.qualified_name].append(n)
            elif n.kind == NodeKind.FUNCTION:
                self.funcs[n.file][n.qualified_name].append(n)
                self.g_funcs[n.qualified_name].append(n)
            elif n.kind == NodeKind.METHOD and "." in n.qualified_name:
                owner, name = n.qualified_name.rsplit(".", 1)
                self.members[(n.file, owner)][n.label].append(n)

    @staticmethod
    def owner_of(src: Node) -> str | None:
        return src.qualified_name.rsplit(".", 1)[0] if src.kind == NodeKind.METHOD and "." in src.qualified_name else None


def _only(cands: list[Node]) -> Node | None:
    return cands[0] if len(cands) == 1 else None


def _levels(levels: list[tuple[list[Node], float]]) -> _Hit | None:
    """Mức đầu tiên có ứng viên quyết định: đúng một thì chọn, nhiều hơn thì bỏ (không đoán)."""
    for cands, score in levels:
        if cands:
            n = _only(cands)
            return _Hit(n, score) if n else None
    return None


SUBSET_MAX_REFS = 20_000  # nhiều tham chiếu hơn mức này (lập chỉ mục đầy đủ) thì nạp cả đồ thị rẻ hơn


def _candidate_nodes(store: GraphStore, pending: list[tuple[int, UnresolvedRef]],
                     bindings: dict[str, dict[str, str]]):
    """Các nút mà lần phân giải này có thể chạm tới.

    Mọi tra cứu trong `_Index` đều theo khoá chính xác (tên đầy đủ của kiểu/hàm, nhãn của phương thức, id nút nguồn),
    và mọi khoá đều rút ra từ tên tham chiếu, kiểu biến đã ghi hoặc lớp chứa nút nguồn. Nạp đúng các nút mang những
    tên đó cho cùng kết quả với nạp cả đồ thị, mà không phải dựng 215.000 đối tượng mỗi lần cập nhật một tệp.
    """
    if len(pending) > SUBSET_MAX_REFS:
        return store.all_nodes()
    names: set[str] = set()
    for _, ref in pending:
        names.add(ref.source)
        raw = ref.name
        for prefix in ("mixin:", "on:"):
            if raw.startswith(prefix):
                raw = raw[len(prefix):]
        for form in (raw, raw.replace("()", ""), raw.replace("::", ".")):
            names.add(form)
            names.update(form.split("."))
    for owner in store.pending_ref_owners():
        names.add(owner)
        names.add(owner.rsplit(".", 1)[0])
    for table in bindings.values():
        names.update(table.values())
    return store.nodes_for_names(names)


def resolve_references(store: GraphStore, *, package_name: str | None, created_out: list[Edge] | None = None) -> tuple[int, int]:
    bindings = store.bindings()
    pending = store.pending_refs()
    idx = _Index(list(_candidate_nodes(store, pending, bindings)))
    resolved: list[int] = []
    new_edges: list[Edge] = []
    imports: dict[str, list[tuple[str, str | None]]] = defaultdict(list)  # tệp -> [(tệp đích, subtype)]
    for src_file, dst_file, st in store.import_edges():  # import đã phân giải ở lần trước (cập nhật tăng dần)
        imports[src_file].append((dst_file, st))

    def edge(ref: UnresolvedRef, target: Node, type_: EdgeType, score: float, subtype: str | None = None,
             exact: bool = False) -> None:
        new_edges.append(Edge(source=ref.source, target=target.id, type=type_, subtype=subtype,
                              confidence=Confidence.EXTRACTED if exact else Confidence.INFERRED,
                              confidence_score=1.0 if exact else score, origin=Origin.RESOLVER,
                              line=ref.line, col=ref.col))

    # --- 1. import/export/part ---------------------------------------------------------------------
    for ref_id, ref in pending:
        if ref.type != EdgeType.IMPORTS:
            continue
        src = idx.by_id.get(ref.source)
        if src is None or not src.file:
            continue
        subtype = None
        uri = ref.name
        for prefix, st in (("export:", "export"), ("part:", "part")):
            if uri.startswith(prefix):
                uri, subtype = uri[len(prefix):], st
        target_rel: str | None = None
        if uri.startswith("package:"):
            m = re.match(r"package:([^/]+)/(.+)", uri)
            if m and package_name and m.group(1) == package_name:
                target_rel = f"lib/{m.group(2)}"
        elif ":" not in uri.split("/")[0]:
            joined = posixpath.normpath(posixpath.join(posixpath.dirname(src.file), uri))
            target_rel = joined if not joined.startswith("..") else None
        if (not target_rel or target_rel not in idx.files) and not src.file.endswith(".dart"):
            target_rel = idx.file_by_gid.get(uri)
        if target_rel and target_rel in idx.files and target_rel != src.file:
            edge(ref, idx.by_id[f"{target_rel}#file"], EdgeType.IMPORTS, 1.0, subtype, exact=True)
            imports[src.file].append((target_rel, subtype))
            resolved.append(ref_id)

    def visible(file: str) -> list[str]:
        out = [t for t, _ in imports.get(file, [])]
        for t, _ in list(imports.get(file, [])):  # export của tệp đã import (một cấp)
            out += [x for x, st in imports.get(t, []) if st == "export"]
        return list(dict.fromkeys(out))

    def find_type(name: str, file: str) -> _Hit | None:
        vis = [n for f in visible(file) for n in idx.types.get(f, {}).get(name, [])]
        return _levels([(idx.types.get(file, {}).get(name, []), SAME_SCOPE), (vis, IMPORTED),
                        (idx.g_types.get(name, []), GLOBAL)])

    # --- 2. kế thừa / triển khai -----------------------------------------------------------------------
    for ref_id, ref in pending:
        if ref.type not in (EdgeType.INHERITS, EdgeType.IMPLEMENTS):
            continue
        src = idx.by_id.get(ref.source)
        if src is None or not src.file:
            continue
        name, subtype = ref.name, None
        for prefix in ("mixin:", "on:"):
            if name.startswith(prefix):
                name, subtype = name[len(prefix):], prefix[:-1]
        hit = find_type(name, src.file)
        if hit and hit.node.id != src.id:
            edge(ref, hit.node, ref.type, hit.score, subtype)
            resolved.append(ref_id)

    # --- 3. lời gọi ---------------------------------------------------------------------------------------
    def member(hit: _Hit, name: str) -> _Hit | None:
        n = _only(idx.members.get((hit.node.file, hit.node.qualified_name), {}).get(name, []))
        return _Hit(n, hit.score) if n else None

    def receiver_type(src: Node, recv: str) -> str | None:
        owner = _Index.owner_of(src)
        owner_id = next((n.id for k in TYPE_KINDS for n in idx.types.get(src.file, {}).get(owner or "", [])
                         if n.kind == k), None) if owner else None
        return (bindings.get(src.id, {}).get(recv)
                or (bindings.get(owner_id, {}).get(recv) if owner_id else None)
                or bindings.get(f"{src.file}#file", {}).get(recv))

    for ref_id, ref in pending:
        if ref.type != EdgeType.CALLS:
            continue
        src = idx.by_id.get(ref.source)
        if src is None or not src.file:
            continue
        parts = ref.name.replace("()", "").split(".")
        file, owner, hit, subtype = src.file, _Index.owner_of(src), None, None
        if len(parts) == 1:
            x = parts[0]
            own = idx.members.get((file, owner), {}).get(x, []) if owner else []
            vis_f = [n for f in visible(file) for n in idx.funcs.get(f, {}).get(x, [])]
            vis_t = [n for f in visible(file) for n in idx.types.get(f, {}).get(x, [])]
            hit = _levels([(own, SAME_SCOPE),
                           (idx.funcs.get(file, {}).get(x, []) + idx.types.get(file, {}).get(x, []), SAME_SCOPE),
                           (vis_f + vis_t, IMPORTED), (idx.g_funcs.get(x, []) + idx.g_types.get(x, []), GLOBAL)])
        elif len(parts) == 2 and parts[0] == "this":
            own = idx.members.get((file, owner), {}).get(parts[1], []) if owner else []
            hit = _levels([(own, SAME_SCOPE)])
        elif len(parts) == 2:
            recv, x = parts
            tname = recv if recv[:1].isupper() else receiver_type(src, recv)
            type_hit = find_type(tname, file) if tname else None
            if type_hit:
                hit = member(type_hit, x)
                if hit is None and recv[:1].isupper():  # `Type.named(...)`: constructor có tên
                    hit, subtype = type_hit, "construct"
        if hit is None:
            continue
        if hit.node.kind in TYPE_KINDS and subtype is None:
            subtype = "construct"
        edge(ref, hit.node, EdgeType.CALLS, hit.score, subtype)
        resolved.append(ref_id)

    # --- 4. tài liệu nhắc tên symbol (F10 6a): chỉ nối khi duy nhất trong cả project ---------------------
    for ref_id, ref in pending:
        if ref.type != EdgeType.DOCUMENTS or ref.source not in idx.by_id:
            continue
        name = ref.name.replace("::", ".")
        if "." in name:
            owner, x = name.rsplit(".", 1)
            cands = [n for (_, o), names in idx.members.items() if o == owner for n in names.get(x, [])]
            hit = _levels([(cands + idx.g_types.get(name, []), IMPORTED)])
        else:
            hit = _levels([(idx.g_types.get(name, []) + idx.g_funcs.get(name, []), GLOBAL)])
        if hit:
            edge(ref, hit.node, EdgeType.DOCUMENTS, hit.score)
            resolved.append(ref_id)

    inserted = store.insert_edges(new_edges)
    created = len(inserted)
    if created_out is not None:
        # Chỉ báo cáo cạnh thật sự được chèn: cạnh trùng (RB16) hoặc vi phạm RB22 đã bị bỏ qua.
        created_out.extend(inserted)
    store.delete_refs(resolved)
    remaining = store.fail_pending_refs()
    store.commit()
    return created, remaining
