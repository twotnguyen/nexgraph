"""Lớp ``graphify_view``: nạp lười đồ thị ``.nexgraph/graph.json`` và gọi thẳng hàm vendor.

ADR 0025 mục 2: 11 tool trùng tên trong MCP ``nexgraph`` phải chạy **đúng như bản gốc**
— cùng đầu vào, cùng tham số, cùng văn bản đầu ra (sau khi đổi tên hiển thị). Vì vậy
mỗi thân hàm ở đây là bản chép 1:1 của ``_tool_*`` trong ``graphify/serve.py``
(dòng 3143–3403), gọi đúng các helper module-level của vendor; không viết lại thuật toán.

Đồ thị networkx nạp lười bằng chính ``graphify.serve._load_graph`` (kèm dựng
``communities`` như ``serve()`` làm), cache theo ``(đường dẫn, mtime_ns, size)``,
nhả sau :data:`IDLE_TTL_SECONDS` giây không dùng, có khoá luồng.

Phần NexGraph thêm (bằng chứng tệp:dòng, độ mới, vùng ảnh hưởng…) không nằm ở đây.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover - chỉ để gợi ý kiểu, không nạp networkx khi khởi động
    import networkx as nx

OUT_DIR_NAME = ".nexgraph"
GRAPH_JSON_NAME = "graph.json"
IDLE_TTL_SECONDS = 600.0

#: Thứ tự thay thế quan trọng: ``graphify-out`` trước để không bị ``graphify`` nuốt mất.
_REBRAND_PAIRS = (
    ("graphify-out", OUT_DIR_NAME),
    ("Graphify", "NexGraph"),
    ("GRAPHIFY", "NEXGRAPH"),
    ("graphify", "nexgraph"),
)


def rebrand_text(text: str) -> str:
    """Đổi tên nguồn trong văn bản hiển thị sang NexGraph (ADR 0025 mục 3).

    Chỉ đổi ở lớp đầu ra — mã vendor giữ nguyên để còn thay thư mục vendor được.
    """
    for old, new in _REBRAND_PAIRS:
        text = text.replace(old, new)
    return text


class VendorToolError(Exception):
    """Lỗi tool do vendor phát ra (``graphify.serve.ToolError``) — server đổi thành lỗi tool MCP."""


@dataclass
class LoadedGraph:
    """Đồ thị vendor đã nạp cho một ``graph.json``, kèm cộng đồng dựng từ thuộc tính nút."""

    G: "nx.Graph"
    communities: dict[int, list[str]]
    graph_path: Path
    root: Path


def graph_json_path(project: Path) -> Path:
    """``<project>/.nexgraph/graph.json`` — vị trí NexGraph lưu đồ thị kiểu vendor."""
    return Path(project) / OUT_DIR_NAME / GRAPH_JSON_NAME


class GraphView:
    """Nạp lười + cache + nhả đồ thị của **một** tệp ``graph.json``; an toàn luồng."""

    def __init__(self, graph_path: Path, *, idle_ttl: float = IDLE_TTL_SECONDS,
                 clock: Any = time.monotonic) -> None:
        self.graph_path = Path(graph_path)
        self.root = self.graph_path.parent.parent
        self._idle_ttl = float(idle_ttl)
        self._clock = clock
        self._lock = threading.RLock()
        self._entry: LoadedGraph | None = None
        self._key: tuple[int, int] | None = None
        self._last_used = 0.0
        self._timer: threading.Timer | None = None
        self.loads = 0  # số lần nạp thật (test dùng)

    # -- trạng thái ---------------------------------------------------------
    @property
    def is_loaded(self) -> bool:
        with self._lock:
            return self._entry is not None

    def release(self) -> None:
        """Nhả đồ thị ngay (test và khi tắt server)."""
        with self._lock:
            self._entry = None
            self._key = None
            timer, self._timer = self._timer, None
        if timer is not None:
            timer.cancel()

    # -- nạp ---------------------------------------------------------------
    def get(self) -> LoadedGraph | None:
        """Đồ thị đã nạp, hoặc ``None`` khi chưa có ``graph.json`` (R-N3: rơi về NexGraph)."""
        try:
            stat = self.graph_path.stat()
        except OSError:
            self.release()
            return None
        key = (stat.st_mtime_ns, stat.st_size)
        with self._lock:
            now = self._clock()
            if self._entry is not None and self._key == key:
                if now - self._last_used <= self._idle_ttl:
                    self._last_used = now
                    return self._entry
                self._drop_locked()  # quá hạn rảnh → nhả rồi nạp lại
            entry = self._load_locked()
            if entry is None:
                return None
            self._entry, self._key, self._last_used = entry, key, now
            self._arm_timer_locked()
            return entry

    def _drop_locked(self) -> None:
        self._entry = None
        self._key = None

    def _load_locked(self) -> LoadedGraph | None:
        """Nạp bằng đúng hàm vendor; lỗi tệp hỏng/thiếu → coi như chưa có đồ thị."""
        from graphify import serve as vendor_serve

        try:
            G = vendor_serve._load_graph(str(self.graph_path))
        except (SystemExit, OSError, ValueError):
            # _load_graph gọi sys.exit(1) khi tệp hỏng/thiếu: MCP không được chết theo.
            self._drop_locked()
            return None
        try:
            vendor_serve._get_trigram_index(G)  # vendor làm nóng chỉ mục ngay sau khi nạp
        except Exception:  # pragma: no cover - chỉ mục là tối ưu, không phải điều kiện đúng
            pass
        self.loads += 1
        resolved = self.graph_path.resolve()
        return LoadedGraph(G=G, communities=vendor_serve._communities_from_graph(G),
                           graph_path=resolved, root=resolved.parent.parent)

    # -- nhả sau khi rảnh ---------------------------------------------------
    def _arm_timer_locked(self) -> None:
        if self._timer is not None:
            return
        # Chỉ một hẹn giờ sống tại một thời điểm; khi bắn nó tự hẹn lại nếu còn được dùng.
        timer = threading.Timer(self._idle_ttl, self._expire)
        timer.daemon = True
        self._timer = timer
        timer.start()

    def _expire(self) -> None:
        with self._lock:
            self._timer = None
            if self._entry is None:
                return
            idle = self._clock() - self._last_used
            if idle >= self._idle_ttl:
                self._drop_locked()
                return
            delay = max(0.001, self._idle_ttl - idle)
            timer = threading.Timer(delay, self._expire)
            timer.daemon = True
            self._timer = timer
        timer.start()


_VIEWS: dict[Path, GraphView] = {}
_VIEWS_LOCK = threading.Lock()


def view_for(project: Path) -> GraphView:
    """``GraphView`` dùng chung cho một dự án (cache theo đường dẫn ``graph.json`` đã resolve)."""
    path = graph_json_path(Path(project)).resolve()
    with _VIEWS_LOCK:
        view = _VIEWS.get(path)
        if view is None:
            view = GraphView(path)
            _VIEWS[path] = view
        return view


def clear_views() -> None:
    """Nhả mọi đồ thị đã cache (test, hoặc khi engine đổi dự án)."""
    with _VIEWS_LOCK:
        views = list(_VIEWS.values())
        _VIEWS.clear()
    for view in views:
        view.release()


def load_for(project: Path) -> LoadedGraph | None:
    return view_for(project).get()

