"""Ẩn nút và bằng chứng từ nguồn bị loại, kể cả khi CSDL vẫn còn chỉ mục cũ."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from nexgraph_engine.query.source_policy import SourcePolicy, protected_source
from nexgraph_engine.schema.enums import NodeKind
from nexgraph_engine.store.graph_store import GraphStore

MODEL_AUDIENCE_HEADER = "X-NexGraph-Audience"
_OMIT = object()
_PATH_FIELDS = ("file", "path", "old_path")
_NODE_REFS = ("source", "target", "caller")
# Khi một nút chính bị ẩn, bỏ cả bản ghi để nhãn, tên hoặc điểm của nó cũng không lộ.
_REQUIRED_RECORDS = {"node", "entry", "edge", "evidence", "flow", "parent", "community"}


class ModelGraph:
    def __init__(self, store: GraphStore, root: Path, *, source: SourcePolicy | None = None) -> None:
        self.store = store
        self.source = source if source is not None else SourcePolicy(root, store.last_exclude())
        self._nodes: dict[str, bool] = {}
        self._groups: dict[str, bool] = {}
        self._flows: dict[int, bool] = {}

    def allows_node(self, node_id: str) -> bool:
        if node_id not in self._nodes:
            node = self.store.get_node(node_id)
            if node is None:
                self._nodes[node_id] = True  # đường truy vấn trả lỗi not found như cũ
            else:
                file = node.file
                directory = node.kind == NodeKind.DIRECTORY
                if directory:
                    file = node.id.removesuffix("#directory")
                self._nodes[node_id] = file is None or self.source.allows(file, directory=directory)
        return self._nodes[node_id]

    def _allows_block(self, ref: str) -> bool:
        kind, _, value = ref.partition(":")
        if kind in ("dir", "file"):
            return self.source.allows(value, directory=kind == "dir")
        if kind == "more" and value:
            return self._allows_block(value)
        if kind != "com" or not value.isascii() or not value.isdigit() or len(value) > 10:
            return True
        if ref not in self._groups:
            rows = self.store.conn.execute(
                "SELECT DISTINCT t.duong_dan_tuong_doi FROM nut n JOIN tep t ON n.ma_tep = t.ma_tep"
                " WHERE n.ma_khoi = ?", (int(value),))
            self._groups[ref] = all(self.source.allows(row[0]) for row in rows)
        return self._groups[ref]

    def _allows_ref(self, ref: str) -> bool:
        """`source`/`target` có thể là mã nút (`tệp.py::hàm#function`) hoặc id khối (`file:tệp.py`)."""
        return self._allows_block(ref) if ref.partition(":")[0] in ("dir", "file", "more", "com") \
            else self.allows_node(ref)

    def _allows_flow(self, flow_id: int) -> bool:
        if flow_id not in self._flows:
            rows = self.store.conn.execute(
                "SELECT DISTINCT n.id_nut FROM buoc_luong b JOIN nut n"
                " ON n.ma_nut = b.ma_nut OR n.ma_nut = b.ma_nut_goi WHERE b.ma_luong = ?", (flow_id,))
            self._flows[flow_id] = all(self.allows_node(row[0]) for row in rows)
        return self._flows[flow_id]

    def filter(self, payload: Any) -> Any:
        result = self._filter(payload)
        if result is _OMIT:
            raise protected_source()
        return result

    def filter_tour(self, payload: dict) -> dict:
        """Chuyến tham quan là danh sách bước rời: bỏ bước có nút hoặc luồng dùng nguồn bị loại.

        `body` của bước luồng nhắc tên symbol ở bước cuối, nên phải xét cả luồng chứ không chỉ `node.file`.
        """
        steps = []
        for step in payload.get("steps", []):
            node = step.get("node")
            if isinstance(node, dict) and isinstance(node.get("file"), str) and not self.source.allows(node["file"]):
                continue
            flow_id = step.get("flow_id")
            if isinstance(flow_id, int) and not self._allows_flow(flow_id):
                continue
            steps.append(step)
        # `TourPanel` hiển thị chính `order`; bỏ bước xong phải đánh số lại 1..n, không để nhảy 5, 6.
        return {**payload, "steps": [{**step, "order": index} for index, step in enumerate(steps, 1)]}

    def filter_cycles(self, payload: dict) -> dict:
        """Chu trình là danh sách tên tệp trần: chỉ giữ chu trình mà mọi thành viên đều được phép.

        Giữ một phần chu trình sẽ lộ tên tệp bị loại, nên bỏ cả chu trình và đếm lại `total`.
        Nhận cả `{"cycles": [...]}` lẫn `{"cycles": {"cycles": [...]}}` (báo cáo lồng một lớp).
        """
        inner = payload.get("cycles")
        if isinstance(inner, dict):
            return {**payload, "cycles": self.filter_cycles(inner)}
        cycles = [cycle for cycle in payload.get("cycles", [])
                  if all(self.source.allows(name) for name in cycle.get("files", []))]
        return {**payload, "cycles": cycles, "total": len(cycles)}

    def _filter(self, value: Any) -> Any:
        if isinstance(value, list):
            return [safe for item in value if (safe := self._filter(item)) is not _OMIT]
        if not isinstance(value, dict):
            return value

        for key in _PATH_FIELDS:
            path = value.get(key)
            if isinstance(path, str) and not self.source.allows(path):
                return _OMIT
        for key in _NODE_REFS:
            ref = value.get(key)
            if isinstance(ref, str) and not self._allows_ref(ref):
                return _OMIT
        for key in ("id", "from", "to"):
            ref = value.get(key)
            if isinstance(ref, str) and not self._allows_block(ref):
                return _OMIT
        node_id = value.get("id")
        if value.get("kind") == "directory" and isinstance(node_id, str) and not self.allows_node(node_id):
            return _OMIT
        if "entry" in value and isinstance(node_id, int) and node_id > 0 and not self._allows_flow(node_id):
            return _OMIT

        filtered: dict = {}
        for key, original in value.items():
            if key == "unconnected" and isinstance(original, list):
                safe = [node_id for node_id in original if self.allows_node(node_id)]
            else:
                safe = self._filter(original)
            if safe is _OMIT:
                if key in _REQUIRED_RECORDS:
                    return _OMIT
                continue
            filtered[key] = safe

        if "steps" in value and isinstance(value["steps"], list) and len(filtered["steps"]) != len(value["steps"]):
            return _OMIT  # Luồng có lỗ hổng không phải bằng chứng cho đường thực thi.
        for key in ("nodes", "flows"):
            if isinstance(filtered.get(key), list) and len(filtered[key]) != len(value[key]):
                if isinstance(value.get("total"), int):
                    filtered["total"] = len(filtered[key])
                if "truncated" in value:
                    filtered["truncated"] = True
        return filtered
