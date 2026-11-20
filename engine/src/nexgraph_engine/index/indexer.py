"""Lập chỉ mục hai giai đoạn: đọc cấu trúc rồi phân giải tham chiếu."""
from __future__ import annotations

import os
import sqlite3
import subprocess
import threading
import time
from collections.abc import Callable
from concurrent.futures import ProcessPoolExecutor, wait
from concurrent.futures.process import BrokenProcessPool
from contextlib import suppress
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
from nexgraph_engine.flows.build import rebuild_flows
from nexgraph_engine.index.generic import extract_generic
from nexgraph_engine.index.resolver import _package_name, resolve_references
from nexgraph_engine.schema.enums import EdgeType, NodeKind
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.models import Edge, FileRec, Node, RunState, UnresolvedRef
from nexgraph_engine.subprocesses import run_captured

COMMIT_EVERY = 100
EXTRACTION_BATCH_SIZE = 16
WORKER_PROGRESS_TIMEOUT_SECONDS = 20
IS_WINDOWS = os.name == "nt"


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


def index_workers(n_files: int, include_media: bool) -> int:
    # Media/ít tệp luôn chạy đơn luồng: override không được trả sớm bỏ qua điều kiện này.
    if n_files < 200 or include_media:
        return 1
    override = os.environ.get("NEXGRAPH_INDEX_WORKERS")
    if override:
        try:
            val = int(override)
            if val >= 1:
                return val
        except ValueError:
            pass
    # Windows spawn có thể trì hoãn cả lô đầu đến hết timeout; đọc ngay trong tiến trình engine mặc định.
    if IS_WINDOWS:
        return 1
    cpus = os.cpu_count() or 1
    if cpus <= 2:
        return 1
    return min(cpus - 1, 8)


def _extract_batch(root: Path, files: list[DiscoveredFile], transcript_dir: Path | None) -> list[ExtractedFile]:
    return [extract_file(root, f, transcript_dir=transcript_dir, cancel=None) for f in files]


def _git_head(root: Path) -> str | None:
    if not (root / ".git").exists():
        return None
    try:
        out = run_captured(["git", "rev-parse", "HEAD"], cwd=root, timeout=10)
        sha = out.stdout.decode("ascii", "replace").strip()
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
    if f.language == "image":  # chỉ là nút tệp; nội dung ảnh có khi chạy phân tích AI (W9)
        return ExtractedFile(rec, [file_node], [], [], {}, [])
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
        total = 0
        try:
            files = list(discover(self.root, subdir=self.subdir, exclude=self.exclude,
                                  include_docs=self.include_docs, include_media=self.include_media))
            total = len(files)
            store.set_run_state(run_id, "cau_truc", files_done=0, files_total=total)
            store.clear_graph()
            self.on_progress(ProgressEvent("structure", 0, total))
            if not self._structure(run_id, files):
                return self._finish(run_id, "huy", t0, ProgressEvent("cancelled", 0, total))
            store.set_run_state(run_id, "phan_giai", files_done=total)
            self.on_progress(ProgressEvent("resolve", total, total))
            if self.cancel.is_set():
                return self._finish(run_id, "huy", t0, ProgressEvent("cancelled", total, total))
            pubspec = self.root / "pubspec.yaml"
            name = _package_name(pubspec.read_text(encoding="utf-8", errors="replace") if pubspec.is_file() else None)
            resolve_references(store, package_name=name)
            derive_tested_by(store)
            try:
                rebuild_flows(store, self.root)
            except sqlite3.Error:
                raise
            except Exception as exc:
                store.conn.rollback()
                self.on_progress(ProgressEvent("resolve", total, total, f"Không dựng được luồng: {exc}"))
            try:
                detect_communities(store)
            except sqlite3.Error:
                raise
            except Exception as exc:  # khối cộng đồng chỉ là phần phụ: lỗi ở đây không làm hỏng lần lập chỉ mục
                store.conn.rollback()
                self.on_progress(ProgressEvent("resolve", total, total, f"Không phát hiện được cụm: {exc}"))
            store.snapshot_baseline()
            store.set_run_state(run_id, "hoan_tat", files_done=total)
            self.on_progress(ProgressEvent("done", total, total))
            return self._result(run_id, "hoan_tat", t0)
        except Exception as exc:  # không để job làm sập engine; ghi lỗi vào lần lập chỉ mục
            if self.cancel.is_set():
                return self._finish(run_id, "huy", t0, ProgressEvent("cancelled", 0, total))
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

    def _structure(self, run_id: int, files: list[DiscoveredFile]) -> bool:
        store, root = self.store, self.root
        total = len(files)
        store.add_nodes([Node(id=REPOSITORY_ID, kind=NodeKind.REPOSITORY, label=root.name or "project",
                              qualified_name=".")])
        dirs: set[str] = set()
        contains: list[tuple[str, str]] = []
        batch_count = (total + EXTRACTION_BATCH_SIZE - 1) // EXTRACTION_BATCH_SIZE
        workers = min(index_workers(total, self.include_media), batch_count)
        if IS_WINDOWS:
            workers = min(workers, 61)  # giới hạn ProcessPoolExecutor trên Windows

        def _consume(i: int, f: DiscoveredFile, x: ExtractedFile) -> None:
            store.add_file(run_id, x.rec)
            store.add_nodes(x.nodes)
            store.add_edges(x.edges)
            store.add_unresolved(x.refs)
            if x.bindings:
                store.add_bindings(x.bindings)
            for kind, detail in x.errors:
                store.add_file_error(f.rel_path, kind, detail)

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

        consumed = 0
        if workers > 1:
            executor: ProcessPoolExecutor | None = None
            try:
                executor = ProcessPoolExecutor(max_workers=workers)
                batches = [executor.submit(_extract_batch, self.root, files[offset:offset + EXTRACTION_BATCH_SIZE],
                                           self.transcript_dir) for offset in range(0, total, EXTRACTION_BATCH_SIZE)]
                for batch in batches:
                    deadline = time.monotonic() + WORKER_PROGRESS_TIMEOUT_SECONDS
                    while not batch.done() and not self.cancel.is_set() and time.monotonic() < deadline:
                        wait((batch,), timeout=0.2)
                    if not batch.done() or self.cancel.is_set():
                        break
                    for extracted in batch.result():
                        if self.cancel.is_set():
                            return False
                        _consume(consumed + 1, files[consumed], extracted)
                        consumed += 1
            except (BrokenProcessPool, OSError):
                # Worker có thể không khởi động được hoặc bị hệ điều hành chặn.
                pass
            finally:
                if executor is not None and consumed < total:
                    # Python 3.12 chưa có terminate_workers() trên executor.
                    for process in list((executor._processes or {}).values()):
                        with suppress(OSError):
                            process.terminate()
                if executor is not None:
                    executor.shutdown(wait=False, cancel_futures=True)
            if consumed < total and not self.cancel.is_set():
                self.on_progress(ProgressEvent("structure", consumed, total,
                                               "Bộ trích xuất song song gián đoạn. Đang đọc tiếp các tệp còn lại."))

        # Nếu worker treo, tiếp tục đọc tuần tự từ tệp đầu tiên chưa ghi.
        for i in range(consumed, total):
            if self.cancel.is_set():
                return False
            f = files[i]
            x = extract_file(self.root, f, transcript_dir=self.transcript_dir, cancel=self.cancel)
            _consume(i + 1, f, x)

        store.add_edges(Edge(source=a, target=b, type=EdgeType.CONTAINS) for a, b in contains)
        store.commit()
        return True
