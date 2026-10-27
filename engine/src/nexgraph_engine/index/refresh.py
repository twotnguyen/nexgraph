"""Lập chỉ mục tăng dần: đối chiếu đĩa với CSDL rồi cập nhật tại chỗ các tệp đổi.

Kết quả phải bằng một lần lập chỉ mục đầy đủ trên cây tệp hiện tại. Hai điều kiện để vậy:
- tham chiếu thất bại của các tệp không đổi được phân giải lại (ký hiệu mới có thể xuất hiện);
- tệp không đổi có cạnh tới ký hiệu vừa biến mất, hoặc tới tên vừa có thêm bản trùng (nay mơ hồ), cũng được
  trích xuất lại (cạnh đã phân giải không lưu lại tên tham chiếu gốc nên không thể chỉ vá cạnh).
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path

from nexgraph_engine.arch.communities import detect_communities
from nexgraph_engine.ids import REPOSITORY_ID, directory_node_id, file_node_id
from nexgraph_engine.impact.tested_by import derive_tested_by
from nexgraph_engine.index.discovery import DiscoveredFile, discover, sha256_file
from nexgraph_engine.index.indexer import ExtractedFile, extract_file
from nexgraph_engine.index.resolver import TYPE_KINDS, _package_name, resolve_references
from nexgraph_engine.schema.enums import EdgeType, NodeKind
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.models import Edge, Node

RACY_SECONDS = 2  # mtime gần hiện tại hơn mức này thì luôn băm lại (hai lần sửa trong cùng một giây)
_RESOLVABLE_KINDS = [k.value for k in (*TYPE_KINDS, NodeKind.FUNCTION)]


@dataclass(frozen=True)
class RefreshResult:
    added: int
    changed: int
    removed: int
    unchanged: int
    seconds: float


def _hash(path: Path) -> str | None:
    try:
        return sha256_file(path)
    except OSError:
        return None


def _ancestors(rel_path: str) -> list[str]:
    out, parent = [], rel_path.rpartition("/")[0]
    while parent:
        out.append(parent)
        parent = parent.rpartition("/")[0]
    return out  # từ sâu nhất lên gốc


def refresh_project(store: GraphStore, root: Path) -> RefreshResult:
    t0 = time.time()
    root = Path(root)
    scope = store.last_scope()
    disk = {f.rel_path: f for f in discover(root, subdir=scope)}
    known = store.file_records()
    now = time.time()

    added = sorted(p for p in disk if p not in known)
    removed = sorted(p for p in known if p not in disk)
    modified: list[str] = []
    touched: list[DiscoveredFile] = []
    for p, f in disk.items():
        k = known.get(p)
        if k is None:
            continue
        if f.size == k.size and f.mtime == k.mtime and abs(now - f.mtime) >= RACY_SECONDS:
            continue
        if _hash(root / p) != k.sha256:
            modified.append(p)
        elif (f.size, f.mtime) != (k.size, k.mtime):
            touched.append(f)
    modified.sort()

    for f in touched:
        store.touch_file(known[f.rel_path].__class__(f.rel_path, f.language, f.size, f.mtime,
                                                     known[f.rel_path].sha256, f.is_test))
    if not (added or removed or modified):
        store.commit()
        return RefreshResult(0, 0, 0, len(disk), time.time() - t0)

    run_id = store.begin_run(files_total=len(added) + len(removed) + len(modified), kind="tang_dan", subdir=scope)
    try:
        store.set_run_state(run_id, "cau_truc")
        sig_before = store.file_graph_signature()
        extracted: dict[str, ExtractedFile] = {p: extract_file(root, disk[p]) for p in (*added, *modified)}
        dependents = _dependents(store, added, removed, modified, extracted, disk)
        for p in dependents:
            extracted[p] = extract_file(root, disk[p])

        for p in removed:
            store.remove_file(p)
        for p in (*modified, *dependents):
            x = extracted[p]
            store.replace_file(run_id, x.rec, x.nodes, x.edges, x.refs, x.bindings, x.errors)
        for p in added:
            x = extracted[p]
            store.add_file(run_id, x.rec)
            store.add_nodes(x.nodes)
            store.add_edges(x.edges)
            store.add_unresolved(x.refs)
            store.add_bindings(x.bindings)
            for kind, detail in x.errors:
                store.add_file_error(p, kind, detail)
            _link_directories(store, p)
        _prune_directories(store, removed)

        store.set_run_state(run_id, "phan_giai")
        store.requeue_failed_refs()
        pubspec = root / "pubspec.yaml"
        resolve_references(store, package_name=_package_name(
            pubspec.read_text(encoding="utf-8", errors="replace") if pubspec.is_file() else None))
        derive_tested_by(store)
        if store.file_graph_signature() != sig_before:
            try:
                detect_communities(store)
            except Exception:  # cộng đồng chỉ là phần phụ
                store.conn.rollback()
        store.set_run_state(run_id, "hoan_tat", files_done=len(added) + len(removed) + len(modified))
    except BaseException as exc:
        store.conn.rollback()
        store.set_run_state(run_id, "loi", error=f"{type(exc).__name__}: {exc}")
        raise
    return RefreshResult(len(added), len(modified), len(removed), len(disk) - len(added) - len(modified),
                         time.time() - t0)


def _dependents(store: GraphStore, added: list[str], removed: list[str], modified: list[str],
                extracted: dict[str, ExtractedFile], disk: dict[str, DiscoveredFile]) -> list[str]:
    """Tệp không đổi nhưng kết quả phân giải có thể đổi vì thay đổi về cấu trúc ở tệp khác."""
    changing = set(added) | set(removed) | set(modified)
    vanished_pks: list[int] = []
    new_names: set[str] = set()
    importers_of: list[str] = []
    for p in removed:
        vanished_pks += store.node_ids_of_file(p).values()
    for p in (*modified, *added):
        old = store.node_ids_of_file(p) if p in modified else {}
        new_nodes = extracted[p].nodes
        new_ids = {n.id for n in new_nodes}
        vanished_pks += [pk for nid, pk in old.items() if nid not in new_ids]
        new_names |= {n.qualified_name for n in new_nodes
                      if n.id not in old and (n.kind in TYPE_KINDS or n.kind == NodeKind.FUNCTION)}
        if p in modified and (store.has_export_edges(p) or any(
                r.type == EdgeType.IMPORTS and r.name.startswith(("export:", "part:")) for r in extracted[p].refs)):
            importers_of.append(file_node_id(p))
    out = store.files_with_edges_into(vanished_pks)
    out |= store.files_with_edges_to_names(sorted(new_names), _RESOLVABLE_KINDS)
    for node_id in importers_of:
        pk = store.conn.execute("SELECT ma_nut FROM nut WHERE id_nut = ?", (node_id,)).fetchone()
        if pk:
            out |= store.files_with_edges_into([pk[0]])
    return sorted(p for p in out if p not in changing and p in disk)


def _link_directories(store: GraphStore, rel_path: str) -> None:
    """Nút thư mục còn thiếu và cạnh CONTAINS cho một tệp mới (giống bước cấu trúc của lập chỉ mục đầy đủ)."""
    parent = rel_path.rpartition("/")[0]
    edges = [Edge(source=directory_node_id(parent) if parent else REPOSITORY_ID, target=file_node_id(rel_path),
                  type=EdgeType.CONTAINS)]
    while parent and store.get_node(directory_node_id(parent)) is None:
        grand = parent.rpartition("/")[0]
        store.add_nodes([Node(id=directory_node_id(parent), kind=NodeKind.DIRECTORY,
                              label=parent.rsplit("/", 1)[-1], qualified_name=parent)])
        edges.append(Edge(source=directory_node_id(grand) if grand else REPOSITORY_ID,
                          target=directory_node_id(parent), type=EdgeType.CONTAINS))
        parent = grand
    store.add_edges(edges)


def _prune_directories(store: GraphStore, removed: list[str]) -> None:
    dirs = sorted({d for p in removed for d in _ancestors(p)}, key=lambda d: -d.count("/"))
    for d in dirs:
        node_id = directory_node_id(d)
        if store.get_node(node_id) is not None and not store.has_outgoing(node_id, EdgeType.CONTAINS):
            store.remove_node(node_id)
