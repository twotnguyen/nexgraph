"""Đo hiệu năng toàn bộ trên một dự án (H6 Task 3). Dự án được CHÉP sang thư mục tạm; thư mục gốc không bị đụng.

Chạy: uv run --project engine python tools/bench/bench_all.py <thư-mục-project> [--repeat 3] [--index-repeat N] --out perf.json
Mỗi chỉ số: {median, min, max, n} (ms, trừ khi tên có hậu tố khác). Hàm chưa có thì ghi null.
Chạy từ gốc repo (script dùng `git` để ghi commit của repo). Cần `if __name__ == "__main__"` vì lập chỉ mục dùng ProcessPoolExecutor.
"""
import argparse
import json
import os
import platform
import shutil
import statistics
import subprocess
import sys
import tempfile
import threading
import time
from datetime import date
from pathlib import Path

try:  # Unix: đo RSS đỉnh của tiến trình cha và con
    import resource
except ImportError:  # Windows không có module này (ENG-04)
    resource = None

from nexgraph_engine.arch.builder import build_view
from nexgraph_engine.index.discovery import discover
from nexgraph_engine.pipeline.legacy_indexer import Indexer
from nexgraph_engine.pipeline.legacy_refresh import refresh_project
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.search import search

IGNORE = shutil.ignore_patterns(".git", ".nexgraph", "node_modules", "build", ".dart_tool", "__pycache__", ".venv", "venv")


def peak_rss_mb() -> float | None:
    if resource is None:  # Windows: PSAPI thay cho getrusage
        return _windows_peak_rss_mb()
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return rss / (1024 * 1024) if sys.platform == "darwin" else rss / 1024


def _windows_peak_rss_mb() -> float | None:
    """RSS đỉnh của tiến trình hiện tại qua `GetProcessMemoryInfo` (không cần thêm thư viện)."""
    try:
        from ctypes import Structure, byref, c_size_t, c_ulong, sizeof, windll

        class _ProcessMemoryCounters(Structure):
            _fields_ = [("cb", c_ulong), ("PageFaultCount", c_ulong),
                        ("PeakWorkingSetSize", c_size_t), ("WorkingSetSize", c_size_t),
                        ("QuotaPeakPagedPoolUsage", c_size_t), ("QuotaPagedPoolUsage", c_size_t),
                        ("QuotaPeakNonPagedPoolUsage", c_size_t), ("QuotaNonPagedPoolUsage", c_size_t),
                        ("PagefileUsage", c_size_t), ("PeakPagefileUsage", c_size_t)]

        counters = _ProcessMemoryCounters()
        counters.cb = sizeof(counters)
        ok = windll.psapi.GetProcessMemoryInfo(windll.kernel32.GetCurrentProcess(), byref(counters),
                                               sizeof(counters))
        return counters.PeakWorkingSetSize / (1024 * 1024) if ok else None
    except (AttributeError, ImportError, OSError, ValueError):  # nền tảng khác Windows: không đo được
        return None


def peak_children_rss_mb() -> float | None:
    """RSS lớn nhất của MỘT tiến trình con đã kết thúc (worker lập chỉ mục); tổng thật <= cha + số worker x giá trị này."""
    if resource is None:  # Windows không lấy được RSS đỉnh của tiến trình con đã thoát
        return None
    rss = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    return rss / (1024 * 1024) if sys.platform == "darwin" else rss / 1024


def _rounded(value: float | None) -> int | None:
    return round(value) if value is not None else None


def stat(xs: list[float]) -> dict:
    return {"median": round(statistics.median(xs), 2), "min": round(min(xs), 2), "max": round(max(xs), 2), "n": len(xs)}


def sh(*args: str, cwd: Path | None = None) -> str:
    try:
        return subprocess.run(args, cwd=cwd, capture_output=True, text=True, encoding="utf-8", timeout=20).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def machine() -> dict:
    if sys.platform == "darwin":
        cpu, ncpu, mem = sh("sysctl", "-n", "machdep.cpu.brand_string", "hw.ncpu", "hw.memsize").splitlines()[:3]
        os_ = "macOS " + sh("sw_vers", "-productVersion")
        return {"cpu": cpu, "ncpu": int(ncpu), "ram_gb": round(int(mem) / 2**30, 1), "os": os_, "python": platform.python_version()}
    return {"cpu": platform.processor() or platform.machine(), "ncpu": os.cpu_count(), "ram_gb": None,
            "os": platform.platform(), "python": platform.python_version()}


def timed(fn) -> tuple[object, float]:
    t = time.perf_counter()
    out = fn()
    return out, (time.perf_counter() - t) * 1000


def top_degree_node(conn) -> str | None:
    row = conn.execute(
        "SELECT n.id_nut FROM nut n JOIN (SELECT ma_nut, count(*) d FROM (SELECT ma_nut_nguon AS ma_nut FROM canh"
        " UNION ALL SELECT ma_nut_dich FROM canh) GROUP BY ma_nut ORDER BY d DESC LIMIT 1) t ON t.ma_nut = n.ma_nut").fetchone()
    return row[0] if row else None


def one_index(root: Path, db: Path) -> tuple[GraphStore, float, object]:
    conn = open_graph_db(db)
    store = GraphStore(conn)
    store.init_project(root.name, False)
    t0 = time.perf_counter()
    result = Indexer(store, root, on_progress=lambda e: None, cancel=threading.Event()).run()
    if result.state != "hoan_tat" and result.state != "done":
        print(f"CẢNH BÁO: lập chỉ mục kết thúc ở trạng thái {result.state}", file=sys.stderr)
    return store, (time.perf_counter() - t0) * 1000, result


def measure(name: str, repeat: int, fn, out: dict) -> None:
    try:
        out[name] = stat([timed(fn)[1] for _ in range(repeat)])
    except ImportError:
        out[name] = None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("project", type=Path)
    ap.add_argument("--repeat", type=int, default=3)
    ap.add_argument("--index-repeat", type=int, default=None, help="mặc định bằng --repeat")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    index_repeat = args.index_repeat or args.repeat
    src = args.project.resolve()
    result: dict = {
        "project": src.name, "project_commit": sh("git", "rev-parse", "HEAD", cwd=src) or None,
        "nexgraph_commit": sh("git", "rev-parse", "HEAD"), "machine": machine(), "date": date.today().isoformat(),
        "repeat": args.repeat, "index_repeat": index_repeat, "metrics": {},
    }
    m = result["metrics"]
    with tempfile.TemporaryDirectory(prefix="ng-bench-all-") as tmp_name:
        tmp = Path(tmp_name)
        root = tmp / "project"
        shutil.copytree(src, root, ignore=IGNORE, symlinks=True)

        stores, index_ms, runs = [], [], []
        for i in range(index_repeat):
            store, ms, run = one_index(root, tmp / f"graph{i}.db")
            index_ms.append(ms)
            runs.append(run)
            if i < index_repeat - 1:
                store.conn.close()
            stores.append(store)
        store = stores[-1]
        db = tmp / f"graph{index_repeat - 1}.db"
        m["index_full_ms"] = stat(index_ms)
        m["peak_rss_after_index_mb"] = _rounded(peak_rss_mb())  # tiến trình cha, tích luỹ qua các lần lặp; KHÔNG gồm worker
        m["worker_peak_rss_mb"] = _rounded(peak_children_rss_mb())  # worker lớn nhất (null nếu không đo được)
        from nexgraph_engine.pipeline.legacy_indexer import index_workers
        m["index_workers"] = index_workers(store.stats()["files"], False)
        # Số worker THẬT SỰ dùng và cờ rơi về tuần tự: thiếu hai số này thì bảng NFR so 1 worker với 8
        # worker mà không ai biết (đúng như A5 đã xảy ra — PERF-L mục 4).
        m["workers_effective"] = runs[-1].workers_effective
        m["fallback_serial"] = runs[-1].fallback_serial
        m["parallel_files"], m["serial_files"] = runs[-1].parallel_files, runs[-1].serial_files
        m["files_skipped"] = runs[-1].files_skipped
        conn = store.conn
        stats = store.stats()
        m["files"], m["nodes"] = stats["files"], sum(stats["nodes_by_kind"].values())
        m["edges"], m["unresolved"] = sum(stats["edges_by_type"].values()), stats["unresolved"]
        m["languages"] = stats["languages"]
        conn.close()
        m["graph_db_mb"] = round(db.stat().st_size / 1e6, 1)

        reopen = []
        for _ in range(args.repeat):
            t = time.perf_counter()
            ro = open_graph_db(db, read_only=True)
            GraphStore(ro).stats()
            reopen.append((time.perf_counter() - t) * 1000)
            ro.close()
        m["reopen_ms"] = stat(reopen)

        conn = open_graph_db(db)
        store = GraphStore(conn)
        r = args.repeat
        measure("search_build_ms", r, lambda: search(conn, "build", limit=30), m)
        measure("arch_root_ms", r, lambda: build_view(conn), m)

        # cập nhật 1 tệp: thêm một dòng trống vào một tệp đã lập chỉ mục (đổi băm, không đổi cú pháp)
        files = [f.rel_path for f in discover(root)]
        target = root / files[len(files) // 2]
        refresh = []
        for _ in range(r):
            with target.open("a", encoding="utf-8") as fh:
                fh.write("\n")
            refresh.append(timed(lambda: refresh_project(store, root))[1])
        m["refresh_one_file_ms"] = stat(refresh)

        try:
            from nexgraph_engine.flows.build import rebuild_flows
            from nexgraph_engine.flows.query import list_flows_json
            measure("rebuild_flows_ms", r, lambda: rebuild_flows(store, root), m)
            measure("list_flows_auth_ms", r, lambda: list_flows_json(store, q="auth"), m)
        except ImportError:
            m["rebuild_flows_ms"] = m["list_flows_auth_ms"] = None
        try:
            from nexgraph_engine.arch.cycles import import_cycles
            from nexgraph_engine.arch.map import build_map
            measure("build_map_400_ms", r, lambda: build_map(conn, None, 400), m)
            measure("import_cycles_ms", r, lambda: import_cycles(conn), m)
        except ImportError:
            m["build_map_400_ms"] = m["import_cycles_ms"] = None
        try:
            from nexgraph_engine.tour.build import build_tour
            measure("build_tour_ms", r, lambda: build_tour(store), m)
        except ImportError:
            m["build_tour_ms"] = None
        try:
            from nexgraph_engine.query.context import build_context
            for question in ("login", "auth", "user"):  # dự án không có "login" thì thử từ khác; ghi lại từ đã dùng
                try:
                    build_context(store, root, question)
                except ValueError:
                    continue
                m["build_context_question"] = question
                measure("build_context_login_ms", r, lambda: build_context(store, root, question), m)
                break
            else:
                m["build_context_login_ms"] = None
        except ImportError:
            m["build_context_login_ms"] = None
        hub = top_degree_node(conn)
        m["top_degree_node"] = hub
        if hub:
            measure("neighbors_top_node_ms", r, lambda: store.neighbors(hub, depth=1, limit=500), m)
        m["peak_rss_total_mb"] = _rounded(peak_rss_mb())
        conn.close()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({k: (v["median"] if isinstance(v, dict) and "median" in v else v) for k, v in m.items() if k != "languages"},
                     ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
