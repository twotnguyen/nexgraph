"""Đo lập chỉ mục tăng dần và đọc thay đổi (kế hoạch con 4). Chạy:
    uv run python scripts/bench_refresh.py <thư-mục-project>
    uv run python scripts/bench_refresh.py --synthetic 6000
Project được CHÉP sang thư mục tạm (kèm `git init` + commit) rồi mới bị sửa; thư mục gốc không bị đụng.
"""
import argparse
import os
import shutil
import statistics
import subprocess
import tempfile
import threading
import time
from pathlib import Path

from nexgraph_engine.changes.model import read_changes
from nexgraph_engine.impact.analyze import analyze
from nexgraph_engine.index.discovery import discover
from nexgraph_engine.index.indexer import Indexer
from nexgraph_engine.index.refresh import refresh_project
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.store.graph_store import GraphStore

import importlib.util
import sys

_spec = importlib.util.spec_from_file_location("bench_search_arch", Path(__file__).with_name("bench_search_arch.py"))
_bench = importlib.util.module_from_spec(_spec)
sys.modules["bench_search_arch"] = _bench
_spec.loader.exec_module(_bench)

GIT_ENV = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull}


def git(root: Path, *args: str) -> None:
    subprocess.run(["git", "-c", "user.name=b", "-c", "user.email=b@b.b", "-c", "commit.gpgsign=false", *args],
                   cwd=root, env=GIT_ENV, check=True, capture_output=True)


def timed(fn):
    t = time.perf_counter()
    out = fn()
    return out, (time.perf_counter() - t) * 1000


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("project", nargs="?", type=Path)
    ap.add_argument("--synthetic", type=int, default=0)
    args = ap.parse_args()
    tmp_root = tempfile.TemporaryDirectory(prefix="ng-bench-refresh-")
    tmp = Path(tmp_root.name)
    root = tmp / "project"
    if args.synthetic:
        _bench.make_synthetic(root, args.synthetic)
        print(f"[dữ liệu] dự án giả {args.synthetic} tệp (dữ liệu sinh, không phải project thật)")
    else:
        shutil.copytree(args.project, root, ignore=shutil.ignore_patterns(".git", ".nexgraph", "build", ".dart_tool", "node_modules"))
    git(root, "init", "-q", "-b", "main")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "init")

    conn = open_graph_db(tmp / "graph.db")
    store = GraphStore(conn)
    store.init_project("b", True)
    t = time.perf_counter()
    r = Indexer(store, root, on_progress=lambda e: None, cancel=threading.Event()).run()
    full = time.perf_counter() - t
    files = [f.rel_path for f in discover(root) if f.language == "dart" and not f.is_test]
    print(f"[lập chỉ mục đầy đủ] {len(files)} tệp Dart (không test), nút={r.nodes} cạnh={r.edges}: {full:.2f} s")

    def edit(rels: list[str], tag: str) -> None:
        for rel in rels:
            p = root / rel
            p.write_text(p.read_text(encoding="utf-8", errors="replace") + f"\n// {tag}\nvoid {tag}_fn() {{}}\n", encoding="utf-8")

    _, idle = timed(lambda: refresh_project(store, root))
    idle_runs = [timed(lambda: refresh_project(store, root))[1] for _ in range(5)]
    print(f"[refresh không đổi] {statistics.median(idle_runs):.0f} ms (trung vị 5 lần, tối đa {max(idle_runs):.0f} ms)")

    rows = []
    for label, n in (("sửa 1 tệp", 1), ("sửa 50 tệp", 50)):
        times = []
        for k in range(3):
            edit([files[(k * 60 + i) % len(files)] for i in range(n)], f"b{n}_{k}")
            res, ms = timed(lambda: refresh_project(store, root))
            times.append(ms)
        rows.append((label, statistics.median(times), max(times), res.changed))
    new = root / "bench_new.dart"
    new.write_text("class BenchNew { void go() {} }\n", encoding="utf-8")
    _, add_ms = timed(lambda: refresh_project(store, root))
    new.unlink()
    _, del_ms = timed(lambda: refresh_project(store, root))
    for label, med, mx, changed in rows:
        print(f"[refresh {label}] trung vị {med:.0f} ms, tối đa {mx:.0f} ms (đã đổi={changed})")
    print(f"[refresh thêm 1 tệp] {add_ms:.0f} ms; [xoá 1 tệp] {del_ms:.0f} ms")

    def read_and_analyze():
        cs = read_changes(root, store)
        return cs, analyze(conn, cs)

    (cs, rep), ms = timed(read_and_analyze)
    print(f"[đọc thay đổi + vùng ảnh hưởng] {ms:.0f} ms: {len(cs.files)} tệp đổi (git), {len(rep.changed_nodes)} nút đổi, "
          f"{len(rep.impacted)} bị ảnh hưởng, {len(rep.tests)} test, {len(rep.test_gaps)} test gap, truncated={rep.truncated}")
    conn.close()
    t = time.perf_counter()
    ro = open_graph_db(tmp / "graph.db", read_only=True)
    GraphStore(ro).stats()
    print(f"[mở lại] {(time.perf_counter() - t) * 1000:.0f} ms")
    ro.close()
    tmp_root.cleanup()


if __name__ == "__main__":
    main()
