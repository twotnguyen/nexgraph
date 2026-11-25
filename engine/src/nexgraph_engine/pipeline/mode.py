"""Chọn đường lập chỉ mục: pipeline của vendor (mặc định) hay bộ trích xuất cũ.

`NEXGRAPH_PIPELINE=legacy` giữ bộ trích xuất cũ để so sánh và lùi (R-N3); mọi giá trị khác
(hoặc không đặt) dùng pipeline vendor. Đọc biến môi trường ở thời điểm gọi, không ở lúc import,
để test và job đổi được trong cùng tiến trình.
"""
from __future__ import annotations

import os

PIPELINE_ENV = "NEXGRAPH_PIPELINE"
GRAPHIFY = "graphify"
LEGACY = "legacy"


def pipeline_mode() -> str:
    raw = (os.environ.get(PIPELINE_ENV) or "").strip().lower()
    return LEGACY if raw == LEGACY else GRAPHIFY
