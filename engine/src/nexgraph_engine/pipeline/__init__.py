"""Đường lập chỉ mục chính của NexGraph: pipeline của mã vendor (ADR 0023, đợt N2-E2).

Bốn tầng, tách được để test riêng:

- `mode`: chọn `graphify` (mặc định) hay `legacy` (bộ trích xuất cũ, R-N3).
- `runner`: chạy từng bước vendor trong tiến trình con, đọc stdout/stderr thành dòng tiến độ, huỷ được.
- `child`: tiến trình con — đặt `GRAPHIFY_OUT`, đổi `sys.argv`, gọi `main()` của vendor (không sửa vendor).
- `job`: nối vào job lập chỉ mục (nạp `graph.json` bằng `graphify_import`), refresh tăng dần, hậu xử lý đổi tên.
"""
from nexgraph_engine.pipeline.mode import GRAPHIFY, LEGACY, PIPELINE_ENV, pipeline_mode
from nexgraph_engine.pipeline.rebrand import rebrand_exported, rebrand_text
from nexgraph_engine.pipeline.runner import (
    FULL_STEPS, INCREMENTAL_STEPS, PipelineResult, Step, StepResult, child_argv, run_pipeline, run_step,
    spawn_and_wait,
)

__all__ = [
    "FULL_STEPS", "GRAPHIFY", "INCREMENTAL_STEPS", "LEGACY", "PIPELINE_ENV", "PipelineResult", "Step",
    "StepResult", "child_argv", "pipeline_mode", "rebrand_exported", "rebrand_text", "run_pipeline",
    "run_step", "spawn_and_wait",
]
