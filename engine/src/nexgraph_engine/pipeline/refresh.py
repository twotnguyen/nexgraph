"""NG-PIPE-3 — cập nhật tăng dần bằng cơ chế `update` của vendor + `replace_files` theo manifest (#67).

Spike A1 §3.5: `graph_diff` không dùng được (chậm, thiếu `kind`/`source_file`); `manifest.json` có
`ast_hash` từng tệp nên tập tệp đổi lấy từ đó, rồi thay **cả tệp** trong SQLite (`replace_file`).
`update --no-cluster` của vendor tự trích lại tệp đổi và tệp bị ảnh hưởng (AST cache), nên không
dựng lại cả đồ thị; `export html` vẽ lại `graph.html` từ `graph.json` mới.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

from nexgraph_engine.pipeline.applied import applied_manifest, mark_applied
from nexgraph_engine.pipeline.mode import LEGACY, pipeline_mode
from nexgraph_engine.pipeline.rebrand import rebrand_exported
from nexgraph_engine.pipeline.runner import INCREMENTAL_STEPS, run_step


def use_pipeline_refresh(root: Path) -> bool:
    """Dự án có đồ thị pipeline (`.nexgraph/graph.json`) và không bị ép legacy (R-N3)."""
    return pipeline_mode() != LEGACY and (Path(root) / ".nexgraph" / "graph.json").is_file()


def _read_manifest(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _paths(store) -> set[str]:
    return {row[0] for row in store.conn.execute("SELECT duong_dan_tuong_doi FROM tep")}


def refresh_pipeline(store, root: Path, *, timeout: float | None = None):
    """Chạy `update` rồi nạp lại đúng các tệp manifest báo đổi; trả `RefreshResult` (pipeline=graphify)."""
    from nexgraph_engine.graphify_import import changed_files_from_manifest, replace_files
    from nexgraph_engine.index.source_state import _git_head
    from nexgraph_engine.pipeline.legacy_refresh import RefreshResult

    root = Path(root)
    out = root / ".nexgraph"
    started = time.perf_counter()
    manifest_path = out / "manifest.json"
    # So với manifest ĐÃ NẠP, không với manifest.json: job/refresh dở có thể đã cho nó đi trước graph.db.
    old = applied_manifest(root, _paths(store))

    update = run_step(root, out, INCREMENTAL_STEPS[0], timeout=timeout)
    if update.returncode != 0:
        tail = update.tail[-1] if update.tail else ""
        raise RuntimeError(f"Bước update lỗi (mã {update.returncode})" + (f": {tail}" if tail else ""))

    new = _read_manifest(manifest_path) or {}
    changed = changed_files_from_manifest(old, new)
    if not changed:
        mark_applied(root, new)
        with store.atomic():  # giống refresh cũ: HEAD dịch mà nội dung không đổi vẫn ghi mốc commit
            store.set_last_run_commit(_git_head(root))
        return RefreshResult(0, 0, 0, len(new), round(time.perf_counter() - started, 3), (), pipeline="graphify")

    warnings: list[str] = []
    html = run_step(root, out, INCREMENTAL_STEPS[1], timeout=timeout)
    if html.returncode != 0:
        warnings.append(f"Không vẽ lại được graph.html (mã {html.returncode}); trang cũ được giữ")

    before = _paths(store)
    report = replace_files(store, changed, out / "graph.json", root=root)
    from nexgraph_engine.pipeline.job import rebuild_flows_safely

    if (flow_warning := rebuild_flows_safely(store, root)) is not None:  # tệp đổi làm đổi luồng đi qua nó
        warnings.append(flow_warning)
    with store.atomic():  # như refresh cũ: lần tăng dần ghi commit HEAD (freshness/hook guard so mốc này)
        store.set_last_run_commit(_git_head(root))
    mark_applied(root, new)  # chỉ sau khi graph.db đã chứa manifest mới
    rebrand_exported(out)  # ADR 0025: trang HTML vừa vẽ lại cũng phải sạch tên nguồn
    after = _paths(store)
    added = [path for path in changed if path in after and path not in before]
    modified = [path for path in changed if path in before and path in after]
    removed = [path for path in changed if path in before and path not in after]
    return RefreshResult(
        added=len(added), changed=len(modified), removed=len(removed),
        unchanged=max(0, len(new) - len(changed)), seconds=round(time.perf_counter() - started, 3),
        warnings=tuple(warnings), pipeline="graphify", replaced_files=report.files_changed,
    )
