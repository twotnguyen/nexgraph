"""NG-PIPE-2 — job lập chỉ mục chạy pipeline vendor rồi nạp `graph.json` vào `graph.db`.

Luồng: chạy `extract → cluster → tree → callflow` (mỗi bước một tiến trình con, xem `runner`),
rồi nạp `graph.json` bằng `graphify_import` của #67 trong bộ nhớ staging của job (job vẫn công bố
nguyên tử như đường cũ: `stage_graph` + `publish_stage`).

Rơi về bộ trích xuất cũ (`legacy`) khi: `NEXGRAPH_PIPELINE=legacy`, hoặc job cần thứ pipeline
code-only chưa làm — thư mục con, nguồn bổ sung, tài liệu/media/cấu hình. Lý do ghi vào kết quả
job (`fallback_reason`) để người dùng biết vì sao đồ thị dựng bằng đường cũ.
"""
from __future__ import annotations

import os
import re
import time
from pathlib import Path

from nexgraph_engine.index.indexer import ProgressEvent
from nexgraph_engine.pipeline.mode import GRAPHIFY, LEGACY, pipeline_mode
from nexgraph_engine.pipeline.rebrand import rebrand_exported
from nexgraph_engine.pipeline.runner import FULL_STEPS, run_pipeline
from nexgraph_engine.graphify_import import import_graph_json

_ERROR_HINT = re.compile(r"AST extraction (?:incomplete|failed)|failed to extract|extract(?:ion)? error", re.I)
_FILE_IN_LINE = re.compile(r"([\w][\w./\\-]*\.[A-Za-z0-9]{1,8})\b")

#: Thư mục NexGraph luôn bỏ khi quét (`index.discovery.SKIP_DIRS`) — vendor code-only không tự bỏ,
#: nên ánh xạ sang `--exclude` (gitignore-style, mẫu không dấu `/` khớp ở mọi cấp). `.nexgraph` là
#: thư mục đầu ra của chính pipeline nên vendor đã bỏ.
DEFAULT_EXCLUDES = ("build", ".dart_tool", "node_modules", "dist", "__pycache__", ".venv", "venv",
                    "vendor", "third_party")


def exclude_args(exclude: list[str] | None = None) -> tuple[str, ...]:
    """Mẫu bỏ qua của NexGraph (mặc định + người dùng chọn) thành tham số `--exclude` của vendor."""
    return tuple(f"--exclude={pattern}" for pattern in (*DEFAULT_EXCLUDES, *(exclude or ())))


def fallback_reason(*, subdir: str | None, sources, include_docs: bool, include_media: bool,
                    include_images: bool, include_config: bool) -> str | None:
    """Lý do đường pipeline không dùng được cho job này (`None` = dùng được)."""
    if subdir:
        return "subdir"
    if sources is not None and sources.any():
        return "sources"
    if include_docs:
        return "include_docs"
    if include_media or include_images:
        return "include_media"
    if include_config:
        return "include_config"
    return None


def step_timeout() -> float | None:
    """`NEXGRAPH_PIPELINE_TIMEOUT` (giây) cho mỗi bước; 0/không đặt = không giới hạn."""
    raw = os.environ.get("NEXGRAPH_PIPELINE_TIMEOUT")
    if not raw:
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    return value if value > 0 else None


def _strip_dot_slash(raw: str) -> str:
    rel = raw.replace("\\", "/")
    while rel.startswith("./"):
        rel = rel[2:]
    return rel


def _record_vendor_errors(store, lines: list[str]) -> list[str]:
    """Dòng lỗi vendor nhắc tới tệp có trong chỉ mục → bảng `loi_phan_tich` (không làm hỏng job)."""
    known = {row[0] for row in store.conn.execute("SELECT duong_dan_tuong_doi FROM tep")}
    recorded: list[str] = []
    for line in lines:
        if not _ERROR_HINT.search(line):
            continue
        for raw in _FILE_IN_LINE.findall(line):
            rel = _strip_dot_slash(raw)
            if rel in known:
                store.add_file_error(rel, "extract", line[:300])
                recorded.append(rel)
    if recorded:
        store.commit()
    return sorted(set(recorded))


def run_index_pipeline(store, root: Path, *, exclude: list[str] | None = None,
                       on_event, cancel) -> dict | None:
    """Chạy pipeline + nạp chỉ mục trong `store` (bản staging của job).

    Trả dict kết quả job, hoặc `None` khi đã huỷ / vendor lỗi — cả hai trường hợp đều đã phát
    sự kiện kết thúc qua `on_event` để `JobManager` không công bố đồ thị dở.
    """
    root = Path(root).resolve()
    out = root / ".nexgraph"
    started = time.perf_counter()
    total = len(FULL_STEPS)

    def progress(done: int, steps_total: int, message: str) -> None:
        on_event(ProgressEvent("structure" if done < 2 else "resolve", done, steps_total, message))

    result = run_pipeline(root, out, steps=FULL_STEPS, on_progress=progress, cancel=cancel,
                          extra_args=exclude_args(exclude), timeout=step_timeout())
    if result.cancelled:
        on_event(ProgressEvent("cancelled", 0, 0))
        return None
    graph_json = out / "graph.json"
    if not result.ok or not graph_json.is_file():
        on_event(ProgressEvent("error", 0, 0, result.message() or "Pipeline không tạo được graph.json"))
        return None

    on_event(ProgressEvent("resolve", total, total, "Đang nạp đồ thị vào chỉ mục"))
    report = import_graph_json(store, root, graph_json)
    rebrand_exported(out)  # ADR 0025: tên hiển thị trong báo cáo/trang HTML, không đổi id/đường dẫn

    vendor_lines = [line for step in result.steps for line in step.tail]
    errors = _record_vendor_errors(store, vendor_lines)
    warnings = [*result.warnings, *vendor_lines[-10:]]
    seconds = round(time.perf_counter() - started, 3)
    on_event(ProgressEvent("done", total, total, f"Đã lập chỉ mục {report.nodes} nút, {report.edges} cạnh"))
    return {
        "pipeline": GRAPHIFY, "fallback_reason": None,
        "files": report.files, "nodes": report.nodes, "edges": report.edges,
        "communities": report.communities, "tested_by": report.tested_by,
        "seconds": seconds, "import_seconds": report.seconds,
        "files_skipped": 0, "skipped": {}, "workers_effective": 1, "fallback_serial": False,
        "parallel_files": 0, "serial_files": 0, "unreadable_paths": [], "unreadable_count": 0,
        "vendor_warnings": warnings[-20:], "vendor_file_errors": errors,
    }


def legacy_result(index_result: dict, reason: str) -> dict:
    """Kết quả job của đường cũ: ghi rõ đường đã chạy và lý do rơi về (R-N3)."""
    return {**index_result, "pipeline": LEGACY, "fallback_reason": reason}


def current_mode() -> str:
    return pipeline_mode()
