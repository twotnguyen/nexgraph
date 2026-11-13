"""Lập chỉ mục hai giai đoạn: cấu trúc (nhanh, dùng được ngay) rồi phân giải tham chiếu."""
from __future__ import annotations

import subprocess
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from nexgraph_engine.arch.communities import detect_communities
from nexgraph_engine.dart.extractor import FileExtraction, extract_dart
from nexgraph_engine.ids import REPOSITORY_ID, directory_node_id, file_node_id
from nexgraph_engine.docs import media
from nexgraph_engine.docs.extract import extract_document
from nexgraph_engine.docs.text import doc_text
from nexgraph_engine.index.discovery import DOC_LANGUAGES, DiscoveredFile, discover, sha256_file
from nexgraph_engine.impact.tested_by import derive_tested_by
from nexgraph_engine.index.generic import extract_generic
from nexgraph_engine.index.resolver import _package_name, resolve_references
from nexgraph_engine.schema.enums import EdgeType, NodeKind
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.models import Edge, FileRec, Node, RunState, UnresolvedRef

COMMIT_EVERY = 100


@dataclass(frozen=True)
class ProgressEvent:
    state: Literal["structure", "resolve", "done", "cancelled", "error"]
    files_done: int
    files_total: int
    message: str | None = None


@dataclass(frozen=True)
class RunResult:
    run_id: int
    state: RunState
    nodes: int
    edges: int
    unresolved: int
    seconds: float


def _git_head(root: Path) -> str | None:
    if not (root / ".git").exists():
        return None
    try:
        out = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True, timeout=10)
        sha = out.stdout.strip()
        return sha if out.returncode == 0 and 40 <= len(sha) <= 64 else None
    except (OSError, subprocess.SubprocessError):
        return None


@dataclass(frozen=True)
class ExtractedFile:
    """Kết quả đọc và trích xuất một tệp; `nodes[0]` luôn là nút tệp."""
    rec: FileRec
    nodes: list[Node]
    edges: list[Edge]
    refs: list[UnresolvedRef]
    bindings: dict[str, dict[str, str]]
    errors: list[tuple[str, str]]


def extract_file(root: Path, f: DiscoveredFile, *, transcript_dir: Path | None = None,
                 cancel: threading.Event | None = None) -> ExtractedFile:
    """Đọc và trích xuất một tệp (dùng chung cho lập chỉ mục đầy đủ và cập nhật tăng dần). Không ghi CSDL."""
    path = Path(root) / f.rel_path
    try:
        sha = sha256_file(path)
        # Media chỉ cần mã băm (đã đọc theo luồng); không nạp tệp tới 500 MB vào RAM.
        source = None if f.oversized or f.language == "media" else path.read_bytes()
        read_error = None
    except OSError as exc:
        sha, source, read_error = "0" * 64, None, f"Không đọc được tệp: {exc}"
    rec = FileRec(f.rel_path, f.language, f.size, f.mtime, sha, f.is_test)
    file_node = Node(id=file_node_id(f.rel_path), kind=NodeKind.FILE, label=f.rel_path.rsplit("/", 1)[-1],
                     qualified_name=f.rel_path, file=f.rel_path, is_test=f.is_test)
    if f.oversized:
        return ExtractedFile(rec, [file_node], [], [], {}, [("oversized", f"{f.size} byte vượt giới hạn")])
    if read_error or (source is None and f.language != "media"):
        return ExtractedFile(rec, [file_node], [], [], {}, [("read", read_error or "Không đọc được tệp")])
    try:
        if f.language in DOC_LANGUAGES:
            if f.language == "media":
                if transcript_dir is None or not media.has_whisper():
                    return ExtractedFile(rec, [file_node], [], [], {}, [("extract", media.MISSING_WHISPER)])
                text = media.transcript_for(path, sha, transcript_dir, cancel=cancel)
            else:
                text = doc_text(path, f.language)
            x: FileExtraction = extract_document(f.rel_path, text, file_id=file_node.id)
        elif f.language == "dart":
            x = extract_dart(f.rel_path, source, is_test=f.is_test)
        else:
            x = extract_generic(root, f.rel_path, f.language, is_test=f.is_test)
    except Exception as exc:  # lỗi trích xuất một tệp không được dừng cả job
        return ExtractedFile(rec, [file_node], [], [], {}, [("extract", f"{type(exc).__name__}: {exc}")])
    return ExtractedFile(rec, [file_node, *x.nodes], list(x.edges), list(x.refs), dict(x.bindings), list(x.errors))


class Indexer:
    def __init__(self, store: GraphStore, root: Path, *, on_progress: Callable[[ProgressEvent], None],
                 cancel: threading.Event, subdir: str | None = None, exclude: list[str] | None = None,
                 include_docs: bool = False, include_media: bool = False, transcript_dir: Path | None = None) -> None:
        self.store, self.root, self.on_progress, self.cancel = store, Path(root), on_progress, cancel
        self.subdir, self.exclude = subdir, exclude or []
        self.include_docs, self.include_media, self.transcript_dir = include_docs, include_media, transcript_dir

    def run(self) -> RunResult:
        t0 = time.time()
        store = self.store
        run_id = store.begin_run(commit_sha=_git_head(self.root), subdir=self.subdir, exclude=self.exclude,
                                 include_docs=self.include_docs, include_media=self.include_media)
        try:
            files = list(discover(self.root, subdir=self.subdir, exclude=self.exclude,
                                  include_docs=self.include_docs, include_media=self.include_media))
            total = len(files)
            store.set_run_state(run_id, "cau_truc", files_done=0, files_total=total)
            store.clear_graph()
            self.on_progress(ProgressEvent("structure", 0, total))
            bindings = self._structure(run_id, files)
            if bindings is None:
                return self._finish(run_id, "huy", t0, ProgressEvent("cancelled", 0, total))
            store.set_run_state(run_id, "phan_giai", files_done=total)
            self.on_progress(ProgressEvent("resolve", total, total))
            if self.cancel.is_set():
                return self._finish(run_id, "huy", t0, ProgressEvent("cancelled", total, total))
            pubspec = self.root / "pubspec.yaml"
            name = _package_name(pubspec.read_text(encoding="utf-8", errors="replace") if pubspec.is_file() else None)
            store.add_bindings(bindings)
            resolve_references(store, package_name=name)
            derive_tested_by(store)
            try:
                detect_communities(store)
            except Exception as exc:  # khối cộng đồng chỉ là phần phụ: lỗi ở đây không làm hỏng lần lập chỉ mục
                store.conn.rollback()
                self.on_progress(ProgressEvent("resolve", total, total, f"Không phát hiện được cụm: {exc}"))
            store.snapshot_baseline()
            store.set_run_state(run_id, "hoan_tat", files_done=total)
            self.on_progress(ProgressEvent("done", total, total))
            return self._result(run_id, "hoan_tat", t0)
        except Exception as exc:  # không để job làm sập engine; ghi lỗi vào lần lập chỉ mục
            store.conn.rollback()
            store.set_run_state(run_id, "loi", error=f"{type(exc).__name__}: {exc}")
            self.on_progress(ProgressEvent("error", 0, 0, str(exc)))
            return self._result(run_id, "loi", t0)

    # ------------------------------------------------------------------------------------------------
    def _finish(self, run_id: int, state: RunState, t0: float, event: ProgressEvent) -> RunResult:
        self.store.commit()
        self.store.set_run_state(run_id, state)
        self.on_progress(event)
        return self._result(run_id, state, t0)

    def _result(self, run_id: int, state: RunState, t0: float) -> RunResult:
        s = self.store.stats()
        return RunResult(run_id, state, sum(s["nodes_by_kind"].values()), sum(s["edges_by_type"].values()),
                         s["unresolved"], time.time() - t0)

    def _structure(self, run_id: int, files: list[DiscoveredFile]) -> dict[str, dict[str, str]] | None:
        store, root = self.store, self.root
        total = len(files)
        store.add_nodes([Node(id=REPOSITORY_ID, kind=NodeKind.REPOSITORY, label=root.name or "project",
                              qualified_name=".")])
        dirs: set[str] = set()
        contains: list[tuple[str, str]] = []
        bindings: dict[str, dict[str, str]] = {}
        for i, f in enumerate(files, start=1):
            if self.cancel.is_set():
                return None
            self._index_file(run_id, f, bindings)
            parent = f.rel_path.rpartition("/")[0]
            contains.append((directory_node_id(parent) if parent else REPOSITORY_ID, file_node_id(f.rel_path)))
            while parent and parent not in dirs:
                dirs.add(parent)
                grand = parent.rpartition("/")[0]
                store.add_nodes([Node(id=directory_node_id(parent), kind=NodeKind.DIRECTORY,
                                      label=parent.rsplit("/", 1)[-1], qualified_name=parent)])
                contains.append((directory_node_id(grand) if grand else REPOSITORY_ID, directory_node_id(parent)))
                parent = grand
            if i % COMMIT_EVERY == 0:
                store.commit()
            self.on_progress(ProgressEvent("structure", i, total))
        store.add_edges(Edge(source=a, target=b, type=EdgeType.CONTAINS) for a, b in contains)
        store.commit()
        return bindings

    def _index_file(self, run_id: int, f: DiscoveredFile, bindings: dict[str, dict[str, str]]) -> None:
        store = self.store
        x = extract_file(self.root, f, transcript_dir=self.transcript_dir, cancel=self.cancel)
        store.add_file(run_id, x.rec)
        store.add_nodes(x.nodes)
        store.add_edges(x.edges)
        store.add_unresolved(x.refs)
        bindings.update(x.bindings)
        for kind, detail in x.errors:
            store.add_file_error(f.rel_path, kind, detail)
