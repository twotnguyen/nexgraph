"""Ngữ cảnh của việc chạy nền: cờ huỷ, báo tiến độ, đổi trạng thái chờ (ADR 0026 pha 4b: tách khỏi `index/jobs.py`
để tầng phân tích, ví dụ `semantic`, dùng được mà không phụ thuộc tầng điều phối)."""
from __future__ import annotations

import threading
from collections.abc import Callable


class TaskCancelled(Exception):
    """`work` ném lỗi này (hoặc bất kỳ lỗi nào sau khi `cancel` đã bật) để job kết thúc ở `cancelled`."""


class TaskContext:
    """Truyền vào `work` của `start_task`: cờ huỷ và hàm báo tiến độ."""

    def __init__(self, cancel: threading.Event, report: Callable[[int, int, str], None],
                 set_state: Callable[[str], None] | None = None) -> None:
        self.cancel = cancel
        self._report = report
        self._set_state = set_state

    def progress(self, done: int, total: int, message: str) -> None:
        self._report(done, total, message)

    def set_state(self, state: str) -> None:
        """Chỉ đổi giữa `running` và `waiting_llm`; trạng thái kết thúc do JobManager đặt."""
        if state not in ("running", "waiting_llm"):
            raise ValueError(state)
        if self._set_state is not None:
            self._set_state(state)
