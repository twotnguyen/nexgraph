"""Đo lập chỉ mục một thư mục project (đồ thị ghi vào thư mục tạm, không đụng thư mục project).

Chạy: uv run --project engine python tools/bench/bench_index.py <thư-mục-project> [--repeat N]
In: thời gian hai giai đoạn, số tệp/nút/cạnh theo loại, tham chiếu chưa phân giải, RAM đỉnh, thời gian mở lại.
"""
import argparse
import platform
import resource
import sys
import tempfile
import threading
import time
from pathlib import Path

from nexgraph_engine.pipeline.legacy_indexer import Indexer, ProgressEvent, index_workers
from nexgraph_engine.core.schema.db import open_graph_db
from nexgraph_engine.storage.store.graph_store import GraphStore


def peak_rss_mb() -> float:
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return rss / (1024 * 1024) if sys.platform == "darwin" else rss / 1024  # macOS: byte, Linux: KiB


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("project", type=Path)
    ap.add_argument("--repeat", type=int, default=1, help="lập chỉ mục N lần (lần 2 trở đi là chạy lại, không cache)")
    ap.add_argument("--tracemalloc", action="store_true", help="in top 10 dòng cấp phát bộ nhớ")
    args = ap.parse_args()
    if args.tracemalloc:
        import tracemalloc
        tracemalloc.start()
    root = args.project.resolve()

    with tempfile.TemporaryDirectory(prefix="ng-bench-") as tmp:
        db = Path(tmp) / "graph.db"
        conn = open_graph_db(db)
        store = GraphStore(conn)
        store.init_project(root.name, (root / ".git").exists())
        for i in range(args.repeat):
            marks: dict[str, float] = {}

            def on_progress(e: ProgressEvent) -> None:
                marks.setdefault(e.state, time.perf_counter())

            t0 = time.perf_counter()
            result = Indexer(store, root, on_progress=on_progress, cancel=threading.Event()).run()
            t_end = time.perf_counter()
            structure = marks.get("resolve", t_end) - t0
            resolve = t_end - marks.get("resolve", t_end)
            print(f"[lần {i + 1}] trạng thái={result.state} tổng={t_end - t0:.2f}s "
                  f"(giai đoạn 1={structure:.2f}s, giai đoạn 2={resolve:.2f}s)")
        stats = store.stats()
        conn.close()
        t0 = time.perf_counter()
        ro = open_graph_db(db, read_only=True)
        GraphStore(ro).stats()
        reopen = time.perf_counter() - t0
        ro.close()
        size_mb = db.stat().st_size / 1e6

    workers = index_workers(stats["files"], False)
    print(f"project: {root}  máy: {platform.machine()} / Python {platform.python_version()}  tiến trình={workers}")
    print(f"tệp={stats['files']} ngôn ngữ={stats['languages']}")
    print(f"nút={sum(stats['nodes_by_kind'].values())} {stats['nodes_by_kind']}")
    print(f"cạnh={sum(stats['edges_by_type'].values())} {stats['edges_by_type']}")
    print(f"tham chiếu chưa phân giải={stats['unresolved']}")
    print(f"RAM đỉnh={peak_rss_mb():.0f} MB  graph.db={size_mb:.1f} MB  mở lại (chỉ đọc + stats)={reopen * 1000:.0f} ms")
    if args.tracemalloc:
        snapshot = tracemalloc.take_snapshot()
        top_stats = snapshot.statistics("lineno")
        print("[tracemalloc top 10]")
        for stat in top_stats[:10]:
            print(" ", stat)


if __name__ == "__main__":
    main()
