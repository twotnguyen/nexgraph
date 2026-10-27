"""Tham số lan truyền ảnh hưởng (spec §5.6). Tinh chỉnh bằng dữ liệu ở kế hoạch con 7; đây là nơi duy nhất chứa trọng số."""

WEIGHTS: dict[str, float] = {
    "CALLS": 1.0, "INHERITS": 0.9, "IMPLEMENTS": 0.9, "TESTED_BY": 0.7,
    "REFERENCES": 0.6, "USES_TYPE": 0.6, "IMPORTS": 0.5,
}
DECAY = 0.6
MAX_DEPTH = 2
MIN_SCORE = 0.2
MAX_IMPACTED = 200
MAX_CHANGED_NODES = 2000
MAX_FAN_IN = 1000
