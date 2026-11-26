"""Đo tìm kiếm và kiến trúc (kế hoạch con 3). Chạy:
    uv run --project engine python tools/bench/bench_search_arch.py <thư-mục-project>
    uv run --project engine python tools/bench/bench_search_arch.py --synthetic 6000      # sinh dự án giả để thử ngưỡng project lớn
Đồ thị ghi vào thư mục tạm, không đụng thư mục project.
"""
import argparse
import random
import statistics
import tempfile
import threading
import time
from pathlib import Path

from nexgraph_engine.arch.builder import MAX_BLOCKS, build_view, files_of_block
from nexgraph_engine.arch.evidence import evidence_between
from nexgraph_engine.index.indexer import Indexer, ProgressEvent
from nexgraph_engine.index.scan import scan_project
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.search import search

QUERIES = ["build", "state", "widget", "service", "init", "get", "controller", "login", "user", "dispose"]


def make_synthetic(root: Path, n: int, per_pkg: int = 50) -> None:
    rnd = random.Random(7)
    for i in range(n):
        pkg, idx = divmod(i, per_pkg)
        path = root / "lib" / f"pkg{pkg:03d}" / f"f{idx:03d}.dart"
        path.parent.mkdir(parents=True, exist_ok=True)
        imports = []
        if idx > 0:
            imports.append(f"f{rnd.randrange(idx):03d}.dart")
        if pkg > 0 and rnd.random() < 0.2:
            imports.append(f"../pkg{rnd.randrange(pkg):03d}/f{rnd.randrange(per_pkg):03d}.dart")
        body = "".join(f"import '{m}';\n" for m in imports) + f"class C{pkg}_{idx} {{\n  void run{idx}() {{ }}\n  int get value{idx} => {idx};\n}}\n"
        path.write_text(body, encoding="utf-8")


def pct(xs: list[float], p: float) -> float:
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p * (len(xs) - 1))))]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("project", nargs="?", type=Path)
    ap.add_argument("--synthetic", type=int, default=0)
    args = ap.parse_args()
    tmp_root = tempfile.TemporaryDirectory(prefix="ng-bench-")
    tmp = Path(tmp_root.name)
    if args.synthetic:
        root = tmp / "synthetic"
        t = time.perf_counter()
        make_synthetic(root, args.synthetic)
        print(f"[sinh dữ liệu giả] {args.synthetic} tệp trong {time.perf_counter() - t:.1f}s (dữ liệu sinh, không phải project thật)")
    else:
        root = args.project.resolve()

    t = time.perf_counter()
    scan = scan_project(root)
    print(f"[quét sơ bộ] {scan.files} tệp, large={scan.large}, {time.perf_counter() - t:.2f}s")

    conn = open_graph_db(tmp / "graph.db")
    store = GraphStore(conn)
    store.init_project(root.name, False)
    marks: dict[str, float] = {}
    t0 = time.perf_counter()
    result = Indexer(store, root, on_progress=lambda e: marks.setdefault(e.state, time.perf_counter()), cancel=threading.Event()).run()
    total = time.perf_counter() - t0
    print(f"[lập chỉ mục] {result.state} tổng={total:.2f}s (giai đoạn 1={marks.get('resolve', t0 + total) - t0:.2f}s, "
          f"giai đoạn 2 gồm cộng đồng={t0 + total - marks.get('resolve', t0 + total):.2f}s) "
          f"nút={result.nodes} cạnh={result.edges} cộng đồng={len(store.communities())}")

    # tìm kiếm: 10 truy vấn cố định + 10 nhãn lấy ngẫu nhiên từ dữ liệu
    labels = [n.label for n in store.all_nodes() if n.kind.value in ("class", "method", "function", "widget")]
    rnd = random.Random(3)
    queries = QUERIES + (rnd.sample(labels, min(10, len(labels))) if labels else [])
    times = []
    for q in queries:
        for _ in range(5):
            t = time.perf_counter()
            search(conn, q, limit=30)
            times.append((time.perf_counter() - t) * 1000)
    print(f"[tìm kiếm] {len(queries)} truy vấn x5: p50={statistics.median(times):.1f} ms, p95={pct(times, .95):.1f} ms, max={max(times):.1f} ms")

    # kiến trúc: đi hết cây khối (tối đa độ sâu 6), kiểm số khối ≤ 12, bảo toàn tệp, mũi tên khớp bằng chứng
    t = time.perf_counter()
    root_view = build_view(conn)
    root_ms = (time.perf_counter() - t) * 1000
    views = max_blocks = bad_sizes = bad_links = checked_links = 0
    slowest = (0.0, "")
    stack = [(None, 0)]
    all_files = [r[0] for r in conn.execute("SELECT duong_dan_tuong_doi FROM tep")]
    while stack and views < 400:
        parent, depth = stack.pop()
        t = time.perf_counter()
        v = build_view(conn, parent)
        dt = (time.perf_counter() - t) * 1000
        slowest = max(slowest, (dt, parent or "(gốc)"))
        views += 1
        max_blocks = max(max_blocks, len(v.blocks))
        scope = all_files if parent is None else files_of_block(conn, parent)
        bad_sizes += sum(b.size for b in v.blocks) != len(scope)
        for l in v.links[:3]:  # lấy mẫu 3 mũi tên mỗi màn
            ev = evidence_between(conn, l.source, l.target, limit=200)
            checked_links += 1
            bad_links += len(ev) != min(l.count, 200)
        if depth < 6:
            stack += [(b.id, depth + 1) for b in v.blocks if b.drillable and b.kind != "file"]
    print(f"[kiến trúc] gốc={root_ms:.1f} ms, {len(root_view.blocks)} khối {len(root_view.links)} mũi tên; đã duyệt {views} màn: "
          f"tối đa {max_blocks} khối/màn (giới hạn {MAX_BLOCKS}), màn chậm nhất {slowest[0]:.1f} ms ({slowest[1]}), "
          f"lệch bảo toàn tệp={bad_sizes}, mũi tên lệch bằng chứng={bad_links}/{checked_links}")

    # tỉ lệ cạnh IMPORTS/CALLS bị mất khi gộp ở màn gốc (phải bằng 0)
    owner = {f: b.id for b in root_view.blocks for f in files_of_block(conn, b.id)}
    inter = intra = 0
    for a, b, n in conn.execute(
            "SELECT ts.duong_dan_tuong_doi, td.duong_dan_tuong_doi, count(*) FROM canh c"
            " JOIN nut ns ON ns.ma_nut = c.ma_nut_nguon JOIN nut nd ON nd.ma_nut = c.ma_nut_dich"
            " JOIN tep ts ON ts.ma_tep = ns.ma_tep JOIN tep td ON td.ma_tep = nd.ma_tep"
            " WHERE c.loai_canh IN ('IMPORTS','CALLS') AND ns.ma_tep <> nd.ma_tep GROUP BY 1, 2"):
        if owner.get(a) == owner.get(b):
            intra += n
        else:
            inter += n
    shown = sum(l.count for l in root_view.links)
    print(f"[mất cạnh khi gộp, màn gốc] cạnh liên tệp={inter + intra}: liên khối={inter}, trong cùng khối={intra}, "
          f"tổng đếm trên mũi tên={shown}, thiếu={inter - shown}")
    conn.close()
    t = time.perf_counter()
    ro = open_graph_db(tmp / "graph.db", read_only=True)
    GraphStore(ro).stats()
    print(f"[mở lại] {(time.perf_counter() - t) * 1000:.0f} ms; graph.db={(tmp / 'graph.db').stat().st_size / 1e6:.1f} MB")
    ro.close()
    tmp_root.cleanup()


if __name__ == "__main__":
    main()
