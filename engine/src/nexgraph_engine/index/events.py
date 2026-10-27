"""Kênh sự kiện trong tiến trình: job phát, API (SSE) nhận. Người nhận chậm không được chặn người phát."""
from __future__ import annotations

import threading
from collections import deque

MAX_QUEUE = 1000


class Subscription:
    def __init__(self, bus: "EventBus") -> None:
        self._bus = bus
        self._items: deque[dict] = deque()
        self._cond = threading.Condition()
        self._closed = False

    def _offer(self, event: dict) -> None:
        with self._cond:
            if self._closed:
                return
            if len(self._items) >= MAX_QUEUE:
                # Bỏ job_progress cũ nhất; graph_updated không bao giờ bị bỏ (có thể vượt giới hạn một chút).
                for i, e in enumerate(self._items):
                    if e.get("type") == "job_progress":
                        del self._items[i]
                        break
            self._items.append(event)
            self._cond.notify()

    def get(self, timeout: float | None = None) -> dict | None:
        with self._cond:
            if not self._items and not self._closed:
                self._cond.wait(timeout)
            return self._items.popleft() if self._items else None

    def close(self) -> None:
        with self._cond:
            self._closed = True
            self._items.clear()
            self._cond.notify_all()
        self._bus._remove(self)


class EventBus:
    def __init__(self) -> None:
        self._subs: list[Subscription] = []
        self._lock = threading.Lock()

    def subscribe(self) -> Subscription:
        sub = Subscription(self)
        with self._lock:
            self._subs.append(sub)
        return sub

    def publish(self, event: dict) -> None:
        with self._lock:
            subs = list(self._subs)
        for s in subs:
            s._offer(event)

    def _remove(self, sub: Subscription) -> None:
        with self._lock:
            if sub in self._subs:
                self._subs.remove(sub)
