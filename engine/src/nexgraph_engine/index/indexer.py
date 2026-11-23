"""Lập chỉ mục hai giai đoạn: đọc cấu trúc rồi phân giải tham chiếu."""
from __future__ import annotations

import logging
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
from nexgraph_engine.index.extra_sources import ExtraSources, ingest_sources
from nexgraph_engine.index.discovery import DOC_LANGUAGES, DiscoveredFile, discover, is_batch_language, sha256_file
from nexgraph_engine.impact.tested_by import derive_tested_by
from nexgraph_engine.flows.build import rebuild_flows
from nexgraph_engine.index.generic import extract_generic
from nexgraph_engine.index.batch_calls import batch_cross_file_calls
from nexgraph_engine.index.generic import reset_cache_root
from nexgraph_engine.index.resolver import _package_name, resolve_references
from nexgraph_engine.schema.enums import EdgeType, NodeKind
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.models import Edge, FileRec, Node, RunState, UnresolvedRef
from nexgraph_engine.subprocesses import run_captured

logger = logging.getLogger(__name__)

RACY_SECONDS = 2  # mtime gần hiện tại hơn mức này thì luôn băm lại (hai lần sửa trong cùng một giây)

COMMIT_EVERY = 100
EXTRACTION_BATCH_SIZE = 16
WORKER_PROGRESS_TIMEOUT_SECONDS = 20
FILE_EXTRACT_TIMEOUT_SECONDS = 60  # fallback tuần tự: quá hạn một tệp thì bỏ qua tệp đó
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


def index_workers(n_files: int, include_media: bool, requested: int | None = None) -> int:
    # Media/ít tệp luôn chạy đơn luồng: override không được trả sớm bỏ qua điều kiện này.
    if n_files < 200 or include_media:
        return 1
    if requested:  # số tiến trình người dùng chọn trong Tuỳ chọn index (W2)
        return requested
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


def _extract_one(root: Path, f: DiscoveredFile, transcript_dir: Path | None) -> ExtractedFile:
    return extract_file(root, f, transcript_dir=transcript_dir, cancel=None)


def _extract_batch(root: Path, files: list[DiscoveredFile], transcript_dir: Path | None) -> list[ExtractedFile]:
    return [_extract_one(root, f, transcript_dir) for f in files]


def _kill_pool(executor: ProcessPoolExecutor) -> None:
    """Dừng tiến trình con đang treo rồi đóng executor (Python 3.12 chưa có terminate_workers())."""
    for process in list((executor._processes or {}).values()):
        with suppress(OSError):
            process.terminate()
    executor.shutdown(wait=False, cancel_futures=True)


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
    path = f.location(root)
    try:
        sha = sha256_file(path)
        # Media chỉ cần mã băm (đã đọc theo luồng); không nạp tệp tới 500 MB vào RAM.
        source = None if f.oversized or f.language == "media" else path.read_bytes()
        read_error = None
    except OSError as exc:
        sha, source, read_error = "0" * 64, None, f"Không đọc được tệp: {exc}"
    # Băm ngay sau lần ghi (cùng giây) thì chưa chắc là bản cuối: ghi mtime 0 để lần sau băm lại (như git).
    rec = FileRec(f.rel_path, f.language, f.size, f.mtime if time.time() - f.mtime >= RACY_SECONDS else 0, sha, f.is_test)
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
            elif f.language == "google_workspace":
                if transcript_dir is None:
                    return ExtractedFile(rec, [file_node], [], [], {}, [("extract", "Thiếu thư mục lưu nội dung đã xuất")])
                text = media.google_text(path, sha, transcript_dir)
            else:
                text = doc_text(path, f.language)
            x: FileExtraction = extract_document(f.rel_path, text, file_id=file_node.id)
        elif f.language == "dart":
            x = extract_dart(f.rel_path, source, is_test=f.is_test)
        else:
            x = extract_generic(root, f.rel_path, f.language, is_test=f.is_test)
    except Exception as exc:  # lỗi trích xuất một tệp không được dừng cả job
        logger.warning("Không trích xuất được %s", f.rel_path, exc_info=True)
        return ExtractedFile(rec, [file_node], [], [], {}, [("extract", f"{type(exc).__name__}: {exc}")])
    return ExtractedFile(rec, [file_node, *x.nodes], list(x.edges), list(x.refs), dict(x.bindings), list(x.errors))


class Indexer:
    def __init__(self, store: GraphStore, root: Path, *, on_progress: Callable[[ProgressEvent], None],
                 cancel: threading.Event, subdir: str | None = None, exclude: list[str] | None = None,
                 include_docs: bool = False, include_media: bool = False, transcript_dir: Path | None = None,
                 include_config: bool = False, workers: int | None = None, force: bool = False,
                 sources_dir: Path | None = None, sources: ExtraSources | None = None) -> None:
        self.store, self.root, self.on_progress, self.cancel = store, Path(root), on_progress, cancel
        self.sources = sources
        self.subdir, self.exclude = subdir, exclude or []
        self.include_docs, self.include_media, self.transcript_dir = include_docs, include_media, transcript_dir
        self.include_config, self.workers, self.force = include_config, workers, force
        self.sources_dir = sources_dir
        self._file_errors: list[tuple[str, str, str]] = []  # (tệp, loại, chi tiết) để báo cho người dùng

    def run(self) -> RunResult:
        t0 = time.time()
        store = self.store
        run_id = store.begin_run(commit_sha=_git_head(self.root), subdir=self.subdir, exclude=self.exclude,
                                 include_docs=self.include_docs, include_media=self.include_media,
                                 include_config=self.include_config)
        total = 0
        try:
            files = list(discover(self.root, subdir=self.subdir, exclude=self.exclude,
                                  include_docs=self.include_docs, include_media=self.include_media,
                                  include_config=self.include_config, sources_dir=self.sources_dir))
            if self.force:
                reset_cache_root()
            total = len(files)
            store.set_run_state(run_id, "cau_truc", files_done=0, files_total=total)
            store.clear_graph()
            self.on_progress(ProgressEvent("structure", 0, total))
            if not self._structure(run_id, files):
                return self._finish(run_id, "huy", t0, ProgressEvent("cancelled", 0, total))
            if total and len({rel for rel, _k, _d in self._file_errors}) >= total:
                # Không đọc được tệp nào: công bố đồ thị rỗng là nói dối người dùng, phải báo lỗi.
                message = self._failure_message() or f"Không đọc được tệp nào trong {total} tệp"
                store.conn.rollback()
                store.set_run_state(run_id, "loi", error=message)
                store.commit()
                self.on_progress(ProgressEvent("error", 0, 0, message))
                return self._result(run_id, "loi", t0)
            if self.sources is not None and self.sources.any():
                self.on_progress(ProgressEvent("structure", total, total, "Đang đọc nguồn bổ sung"))
                ingest_sources(store, run_id, self.root, self.sources, subdir=self.subdir, exclude=self.exclude,
                               cancel=self.cancel)
            store.set_run_state(run_id, "phan_giai", files_done=total)
            self.on_progress(ProgressEvent("resolve", total, total))
            if self.cancel.is_set():
                return self._finish(run_id, "huy", t0, ProgressEvent("cancelled", total, total))
            add_batch_calls(store, self.root, [(f.rel_path, f.language) for f in files if is_batch_language(f.language)],
                            cancel=self.cancel)
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
            self.on_progress(ProgressEvent("done", total, total, self._failure_message()))
            return self._result(run_id, "hoan_tat", t0)
        except Exception as exc:  # không để job làm sập engine; ghi lỗi vào lần lập chỉ mục
            if self.cancel.is_set():
                return self._finish(run_id, "huy", t0, ProgressEvent("cancelled", 0, total))
            store.conn.rollback()
            store.set_run_state(run_id, "loi", error=f"{type(exc).__name__}: {exc}")
            self.on_progress(ProgressEvent("error", 0, 0, str(exc)))
            return self._result(run_id, "loi", t0)

    def _failure_message(self) -> str | None:
        """Câu cảnh báo cho người dùng khi một phần tệp không đọc/trích xuất được."""
        if not self._file_errors:
            return None
        files = list(dict.fromkeys(rel for rel, _k, _d in self._file_errors))
        first_rel, _kind, detail = self._file_errors[0]
        return f"{len(files)} tệp không đọc được hoặc lỗi trích xuất (ví dụ {first_rel}: {detail})"

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
        workers = min(index_workers(total, self.include_media, self.workers), batch_count)
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
                if kind in ("read", "extract"):
                    self._file_errors.append((f.rel_path, kind, detail))

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
            batches = []
            try:
                executor = ProcessPoolExecutor(max_workers=workers)
                batches = [executor.submit(_extract_batch, self.root, files[offset:offset + EXTRACTION_BATCH_SIZE],
                                           self.transcript_dir) for offset in range(0, total, EXTRACTION_BATCH_SIZE)]
            except (BrokenProcessPool, OSError, RuntimeError):
                # Worker có thể không khởi động được hoặc bị hệ điều hành chặn; các tệp chưa xong
                # sẽ được đọc tiếp ở nhánh fallback tuần tự bên dưới.
                logger.warning("Bộ trích xuất song song gián đoạn; đọc tiếp tuần tự", exc_info=True)
                if executor is not None:
                    _kill_pool(executor)
                executor, batches = None, []
            if executor is not None:
                try:
                    for batch in batches:
                        deadline = time.monotonic() + WORKER_PROGRESS_TIMEOUT_SECONDS
                        while not batch.done() and not self.cancel.is_set() and time.monotonic() < deadline:
                            wait((batch,), timeout=0.2)
                        if not batch.done() or self.cancel.is_set():
                            break
                        try:
                            extracted_batch = batch.result()
                        except (BrokenProcessPool, OSError, RuntimeError):
                            # Chỉ lỗi của pool bị bắt ở đây; lỗi trong `_consume`/`on_progress` phải nổi lên.
                            if self.cancel.is_set():
                                return False
                            _kill_pool(executor)
                            executor = None
                            self.on_progress(ProgressEvent(
                                "structure", consumed, total,
                                "Không dùng được tiến trình trích xuất; đang đọc trong tiến trình chính."))
                            break
                        # Ngoài `try` của pool: lỗi của callback/ghi CSDL không được nuốt (Minor #27 N2).
                        for extracted in extracted_batch:
                            if self.cancel.is_set():
                                return False
                            _consume(consumed + 1, files[consumed], extracted)
                            consumed += 1
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

        # Nếu worker song song treo/gãy, đọc tiếp từ tệp đầu tiên chưa ghi. Mỗi tệp chạy trong tiến trình con
        # để tệp treo không treo cả engine; chỉ khi không dùng được tiến trình con mới đọc trong tiến trình chính.
        executor: ProcessPoolExecutor | None = None
        isolated = workers > 1
        try:
            i = consumed
            while i < total:
                if self.cancel.is_set():
                    return False
                f = files[i]
                x = None
                pool = executor
                if isolated and pool is None:
                    try:
                        pool = executor = ProcessPoolExecutor(max_workers=1)
                    except (BrokenProcessPool, OSError):
                        isolated = False
                        self.on_progress(ProgressEvent(
                            "structure", i, total,
                            "Không tạo được tiến trình trích xuất; đang đọc trong tiến trình chính."))
                if pool is not None:
                    try:
                        future = pool.submit(_extract_one, self.root, f, self.transcript_dir)
                    except (BrokenProcessPool, OSError, RuntimeError):
                        # Hết fd/process hay bị chính sách chặn (OSError), pool đã hỏng hoặc đã đóng
                        # (BrokenProcessPool/RuntimeError): bỏ pool và đọc tệp này ngay trong tiến trình chính.
                        _kill_pool(pool)
                        executor, isolated = None, False
                        self.on_progress(ProgressEvent(
                            "structure", i, total,
                            "Không dùng được tiến trình trích xuất; đang đọc trong tiến trình chính."))
                    else:
                        deadline = time.monotonic() + FILE_EXTRACT_TIMEOUT_SECONDS
                        while not future.done() and not self.cancel.is_set() and time.monotonic() < deadline:
                            wait((future,), timeout=0.1)
                        if future.done():
                            try:
                                x = future.result()
                            except (BrokenProcessPool, OSError, RuntimeError):
                                _kill_pool(pool)
                                executor, isolated = None, False
                                self.on_progress(ProgressEvent(
                                    "structure", i, total,
                                    "Không dùng được tiến trình trích xuất; đang đọc trong tiến trình chính."))
                        else:  # quá hạn hoặc bị huỷ: dừng tiến trình con, bỏ qua tệp và đi tiếp
                            _kill_pool(pool)
                            executor = None
                            if self.cancel.is_set():
                                return False
                            self.on_progress(ProgressEvent(
                                "structure", i + 1, total,
                                f"Bỏ qua {f.rel_path}: trích xuất quá {FILE_EXTRACT_TIMEOUT_SECONDS:g} giây"))
                            i += 1
                            continue
                if x is None:
                    x = extract_file(self.root, f, transcript_dir=self.transcript_dir, cancel=self.cancel)
                _consume(i + 1, f, x)
                i += 1
        finally:
            if executor is not None:
                executor.shutdown(wait=False, cancel_futures=True)

        store.add_edges(Edge(source=a, target=b, type=EdgeType.CONTAINS) for a, b in contains)
        store.commit()
        return True


_BATCH_FAMILY = {"c": "cpp", "objc": "cpp"}  # header .h nhận diện là c nhưng thuộc cùng chương trình C++


def add_batch_calls(store: GraphStore, root: Path, files: list[tuple[str, str]],
                    cancel: threading.Event | None = None) -> list[Edge]:
    """Thêm cạnh CALLS liên tệp của ngôn ngữ mức chung; lỗi ở bước này không làm hỏng lần index.

    Mỗi ngôn ngữ một lô: gộp chung thì cùng tên (Util.helper của Java và Kotlin) thành mơ hồ và graphify bỏ qua.
    """
    groups: dict[str, list[str]] = {}
    for rel, language in files:
        groups.setdefault(_BATCH_FAMILY.get(language, language), []).append(rel)
    groups = {lang: rels for lang, rels in groups.items() if len(rels) >= 2}
    added: list[Edge] = []
    if not groups:
        return added
    nodes = list(store.all_nodes())
    for rels in groups.values():
        if cancel is not None and cancel.is_set():
            break
        try:
            added += store.insert_edges(batch_cross_file_calls(root, rels, nodes))
        except Exception:  # noqa: BLE001 — graphify có thể ném lỗi trên cú pháp lạ; cạnh từng tệp vẫn còn
            logger.warning("Bỏ lô lời gọi liên tệp của %s", rels[0].rsplit("/", 1)[0] if rels else "?", exc_info=True)
            continue
    return added
