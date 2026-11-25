"""NG-PIPE-1 — chạy pipeline của mã vendor trong tiến trình con.

Vì sao tiến trình con: bước trích xuất giữ cả đồ thị trong RAM (hàng trăm MB tới vài GB trên dự án
lớn — spike A1 §3.1) và có thể treo; chạy riêng thì job huỷ được, RAM nhả khi bước xong, và lỗi
của vendor không kéo sập engine.

Bản đóng gói PyInstaller chạy lại **chính binary engine** (`nexgraph-engine pipeline-run …`) —
`sys.frozen` quyết định argv; bản chạy nguồn dùng `python -m nexgraph_engine.cli`. Không sửa
`engine/src/graphify/**`: tiến trình con chỉ đặt `GRAPHIFY_OUT` rồi gọi `main()` của vendor.
"""
from __future__ import annotations

import os
import re
import signal
import subprocess
import sys
import threading
import time
from collections import deque
from collections.abc import Callable, Iterable, Sequence
from contextlib import suppress
from dataclasses import dataclass, field
from pathlib import Path

PIPELINE_COMMAND = "pipeline-run"
_ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
MAX_LINE = 500
TAIL_LINES = 40


@dataclass(frozen=True)
class Step:
    """Một bước vendor. `fatal`: lỗi bước này làm hỏng cả pipeline (bước xuất HTML thì không)."""

    name: str
    args: tuple[str, ...]
    fatal: bool = True


#: Lần lập chỉ mục đầy đủ: trích xuất mã (code-only, N3-E4 mới thêm bước ngữ nghĩa) → cụm + báo cáo
#: + graph.html → cây → luồng gọi. Bốn bước đều dùng hàm vendor, không tự dựng định dạng nào.
FULL_STEPS: tuple[Step, ...] = (
    Step("extract", ("extract", ".", "--code-only")),
    Step("cluster", ("cluster-only", ".", "--no-label")),
    Step("tree", ("tree",), fatal=False),
    Step("callflow", ("export", "callflow-html"), fatal=False),
)

#: Cập nhật tăng dần: vendor tự so manifest + AST cache; `html` vẽ lại trang từ graph.json mới.
INCREMENTAL_STEPS: tuple[Step, ...] = (
    Step("update", ("update", ".", "--no-cluster")),
    Step("html", ("export", "html"), fatal=False),
)


@dataclass(frozen=True)
class ChildResult:
    returncode: int
    cancelled: bool
    timed_out: bool
    seconds: float
    child_pid: int
    tail: tuple[str, ...] = ()


@dataclass(frozen=True)
class StepResult:
    name: str
    returncode: int
    cancelled: bool
    timed_out: bool
    seconds: float
    tail: tuple[str, ...] = ()


@dataclass
class PipelineResult:
    ok: bool
    cancelled: bool
    out_dir: Path
    steps: list[StepResult] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    seconds: float = 0.0

    @property
    def failure(self) -> StepResult | None:
        return next((step for step in self.steps if step.returncode != 0), None)

    def message(self) -> str | None:
        """Câu lỗi gọn cho job: tên bước + dòng cuối của vendor."""
        step = self.failure
        if step is None:
            return None
        tail = step.tail[-1] if step.tail else ""
        return f"Bước {step.name} lỗi (mã {step.returncode})" + (f": {tail}" if tail else "")


def child_argv(root: Path, out_dir: Path, vendor_args: Sequence[str]) -> list[str]:
    """argv của tiến trình con: chính binary engine, không dựa vào `python -m` ở bản cài."""
    base = [PIPELINE_COMMAND, "--root", str(root), "--out", str(out_dir), *vendor_args]
    if getattr(sys, "frozen", False):
        return [sys.executable, *base]
    return [sys.executable, "-m", "nexgraph_engine.cli", *base]


def clean_env() -> dict[str, str]:
    """Bỏ PYTHONPATH: biến của tiến trình cha (Hermes, pytest…) làm CLI cài riêng chết ở import numpy."""
    return {key: value for key, value in os.environ.items() if key != "PYTHONPATH"}


def child_env(out_dir: Path) -> dict[str, str]:
    """Môi trường tiến trình con: `GRAPHIFY_OUT` tuyệt đối, backend tắt (code-only), UTF-8."""
    env = clean_env()
    env["GRAPHIFY_OUT"] = str(Path(out_dir).resolve())
    env.setdefault("GRAPHIFY_BACKEND", "none")
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    return env


def _pump(stream, tail: deque[str], on_line: Callable[[str], None] | None) -> None:
    try:
        for raw in stream:
            line = _ANSI.sub("", raw).rstrip()
            if not line:
                continue
            line = line[:MAX_LINE]
            tail.append(line)
            if on_line is not None:
                on_line(line)
    except (OSError, ValueError):  # ống đóng khi tiến trình con bị kill
        pass


def _kill_tree(proc: subprocess.Popen) -> None:
    """Dừng cả cây tiến trình con: vendor có thể đã sinh worker (multiprocessing)."""
    if proc.poll() is not None:
        return
    if os.name == "nt":
        with suppress(OSError, subprocess.SubprocessError):
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True, timeout=10)
        with suppress(OSError):
            proc.kill()
        return
    with suppress(ProcessLookupError, PermissionError):
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        with suppress(ProcessLookupError, PermissionError):
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)


def spawn_and_wait(argv: Sequence[str], *, cwd: Path, env: dict[str, str] | None = None,
                   on_line: Callable[[str], None] | None = None,
                   cancel: threading.Event | None = None, timeout: float | None = None) -> ChildResult:
    """Chạy `argv`, chuyển từng dòng stdout/stderr thành `on_line`, dừng khi `cancel` bật hoặc quá hạn.

    stderr gộp vào stdout để giữ thứ tự dòng như vendor in; 40 dòng cuối giữ lại cho thông báo lỗi.
    """
    started = time.perf_counter()
    tail: deque[str] = deque(maxlen=TAIL_LINES)
    kwargs: dict = {}
    if os.name != "nt":
        kwargs["start_new_session"] = True  # cô lập nhóm tiến trình để kill cả cây
    proc = subprocess.Popen(list(argv), cwd=str(cwd), env=env or clean_env(),
                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, encoding="utf-8", errors="replace", bufsize=1, **kwargs)
    reader = threading.Thread(target=_pump, args=(proc.stdout, tail, on_line), daemon=True,
                              name=f"pipeline-{proc.pid}")
    reader.start()
    cancelled = timed_out = False
    deadline = None if not timeout else time.monotonic() + timeout
    try:
        while proc.poll() is None:
            if cancel is not None and cancel.is_set():
                cancelled = True
                _kill_tree(proc)
                break
            if deadline is not None and time.monotonic() >= deadline:
                timed_out = True
                _kill_tree(proc)
                break
            time.sleep(0.05)
    finally:
        with suppress(subprocess.TimeoutExpired):
            proc.wait(timeout=10)
        reader.join(timeout=5)
        if proc.stdout is not None:
            with suppress(OSError):
                proc.stdout.close()
    return ChildResult(returncode=proc.returncode if proc.returncode is not None else -1,
                       cancelled=cancelled, timed_out=timed_out, seconds=round(time.perf_counter() - started, 3),
                       child_pid=proc.pid, tail=tuple(tail))


def run_step(root: Path, out_dir: Path, step: Step, *, on_line: Callable[[str], None] | None = None,
             cancel: threading.Event | None = None, extra_args: Iterable[str] = (),
             timeout: float | None = None) -> StepResult:
    """Chạy một bước vendor (argv của chính binary engine) trong `<root>`, đầu ra vào `out_dir`."""
    args = (*step.args, *extra_args)
    result = spawn_and_wait(child_argv(Path(root), Path(out_dir), args), cwd=Path(root),
                            env=child_env(out_dir), on_line=on_line, cancel=cancel, timeout=timeout)
    return StepResult(name=step.name, returncode=result.returncode, cancelled=result.cancelled,
                      timed_out=result.timed_out, seconds=result.seconds, tail=result.tail)


def run_pipeline(root: Path, out_dir: Path | None = None, *, steps: Sequence[Step] = FULL_STEPS,
                 on_progress: Callable[[int, int, str], None] | None = None,
                 on_line: Callable[[str, str], None] | None = None,
                 cancel: threading.Event | None = None, extra_args: Iterable[str] = (),
                 timeout: float | None = None) -> PipelineResult:
    """Chạy lần lượt các bước; dừng ngay khi bị huỷ hoặc một bước `fatal` lỗi.

    `on_progress(done, total, message)` báo theo bước (vendor không in tiến độ từng tệp);
    `on_line(step_name, line)` nhận từng dòng thô để job đưa vào sự kiện tiến độ hiện có.
    `extra_args` chỉ áp cho bước nhận đường dẫn quét (`extract`, `update`) — dùng cho mẫu bỏ qua.
    """
    root = Path(root).resolve()
    out = Path(out_dir).resolve() if out_dir is not None else root / ".nexgraph"
    extra = tuple(extra_args)
    total = len(steps)
    started = time.perf_counter()
    result = PipelineResult(ok=False, cancelled=False, out_dir=out)
    try:
        for index, step in enumerate(steps):
            if cancel is not None and cancel.is_set():
                result.cancelled = True
                return result
            if on_progress is not None:
                on_progress(index, total, f"Đang chạy bước {step.name} ({index + 1}/{total})")

            def _line(line: str, _name: str = step.name, _index: int = index) -> None:
                if on_line is not None:
                    on_line(_name, line)
                if on_progress is not None:
                    on_progress(_index, total, line)

            extra_for_step = extra if step.name in ("extract", "update") else ()
            done = run_step(root, out, step, on_line=_line, cancel=cancel, extra_args=extra_for_step, timeout=timeout)
            result.steps.append(done)
            if done.cancelled:
                result.cancelled = True
                return result
            if done.timed_out:
                result.warnings.append(f"Bước {done.name} quá thời gian ({timeout}s) và đã bị dừng")
                return result
            if done.returncode != 0 and step.fatal:
                return result
            if done.returncode != 0:
                result.warnings.append(f"Bước {done.name} lỗi (mã {done.returncode}); bỏ qua phần phụ này")
        result.ok = True
        if on_progress is not None:
            on_progress(total, total, "Pipeline xong")
        return result
    finally:
        result.seconds = round(time.perf_counter() - started, 3)
