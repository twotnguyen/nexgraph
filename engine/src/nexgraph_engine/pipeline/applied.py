"""Manifest ĐÃ NẠP vào graph.db — mốc so sánh của refresh tăng dần (review #71 vòng 1).

Bước `extract`/`update` của vendor ghi thẳng `.nexgraph/manifest.json` trước khi graph.db đổi. Nếu
job/refresh dừng sau đó (huỷ, timeout, lỗi nạp, lỗi công bố) thì manifest trên đĩa đi trước chỉ mục;
so với nó, refresh sau báo "không đổi" mãi. Vì vậy refresh so với bản chép `manifest.applied.json`,
chỉ ghi khi graph.db đã chứa đúng manifest đó:

- job đầy đủ xoá bản chép lúc bắt đầu, ghi lại SAU khi công bố staging;
- refresh ghi lại sau khi `replace_files` xong.

Không có bản chép (dự án cũ, job dở) → coi mọi tệp đã đổi: refresh nạp lại toàn bộ, không bỏ sót.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

MANIFEST = "manifest.json"
APPLIED_MANIFEST = "manifest.applied.json"


def _out(root: Path) -> Path:
    return Path(root) / ".nexgraph"


def read_manifest(path: Path) -> dict | None:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def forget_applied(root: Path) -> None:
    """Graph.db sắp không còn khớp manifest nào đã biết (job đầy đủ bắt đầu)."""
    try:
        (_out(root) / APPLIED_MANIFEST).unlink()
    except FileNotFoundError:
        pass


def mark_applied(root: Path, manifest: dict | None = None) -> None:
    """Ghi `manifest` (mặc định: manifest.json hiện tại) làm mốc đã nạp; ghi nguyên tử qua tệp tạm."""
    out = _out(root)
    data = manifest if manifest is not None else read_manifest(out / MANIFEST)
    if data is None:
        forget_applied(root)
        return
    tmp = out / f"{APPLIED_MANIFEST}.tmp"
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, out / APPLIED_MANIFEST)


def applied_manifest(root: Path, indexed_paths: set[str]) -> dict:
    """Mốc so sánh của refresh. Thiếu/hỏng → mỗi tệp trong chỉ mục coi như hash lạ (nạp lại hết)."""
    data = read_manifest(_out(root) / APPLIED_MANIFEST)
    if data is not None:
        return data
    return {path: {} for path in indexed_paths}
