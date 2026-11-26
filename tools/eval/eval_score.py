"""Chấm độ đúng của đồ thị so với nhãn tay (H6 Task 2).

Chạy: uv run --project engine python tools/eval/eval_score.py <graph.db> <labels.csv> [--baseline graph.json] [--details d.json]
In JSON {kind: {tp, fp, fn, precision, recall}} chỉ trong phạm vi các tệp có trong CSV.

CSV, cột cố định: file,kind,source,target,line   (kind: symbol|call|import|inherit|test)
  Khoá symbol = đường dẫn tệp + "::" + tên (phương thức: "Lớp.phương_thức"), vd `service.py::login_user`, `main.py::App.run`.
  symbol : source = khoá symbol, target rỗng.
  call / inherit : source = khoá symbol nơi gọi (hoặc lớp con), target = khoá symbol đích TRONG dự án, line = dòng.
  import : source = đường dẫn tệp, target = đường dẫn tệp đích TRONG dự án, line = dòng.
  test   : source = khoá symbol được test, target = đường dẫn tệp test; line bỏ trống.
  Lời gọi tới thư viện ngoài không gán nhãn và không tính.
Khớp cạnh theo (source, target, line); symbol theo source; test theo (source, target).
"""
import argparse
import csv
import json
import re
from pathlib import Path

from nexgraph_engine.schema.db import open_graph_db

KINDS = ("symbol", "call", "import", "inherit", "test")
# Nút symbol để chấm: bỏ file/thư mục/route (route là khái niệm suy ra, người đọc mã không "thấy" nó).
SYMBOL_NODE_KINDS = ("class", "mixin", "enum", "extension", "function", "method", "test", "widget", "screen")
EDGE_KIND = {"CALLS": "call", "IMPORTS": "import", "INHERITS": "inherit", "IMPLEMENTS": "inherit", "TESTED_BY": "test"}

Fact = tuple  # symbol: (key,)  call/import/inherit: (src, dst, line)  test: (src, dst)


def key_of(id_nut: str) -> str:
    return id_nut.rsplit("#", 1)[0]


def read_labels(path: Path) -> dict[str, set[Fact]]:
    out: dict[str, set[Fact]] = {k: set() for k in KINDS}
    with path.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            kind = row["kind"].strip()
            if kind not in out:
                raise ValueError(f"kind không hợp lệ: {kind!r}")
            out[kind].add(fact_of(kind, row["source"].strip(), row["target"].strip(), row["line"].strip()))
    return out


def fact_of(kind: str, src: str, dst: str, line: str) -> Fact:
    if kind == "symbol":
        return (src,)
    if kind == "test":
        return (src, dst)
    return (src, dst, int(line) if line else None)


def label_files(path: Path) -> set[str]:
    with path.open(encoding="utf-8", newline="") as fh:
        return {row["file"].strip() for row in csv.DictReader(fh)}


def db_facts(db: Path, files: set[str]) -> dict[str, set[Fact]]:
    conn = open_graph_db(db, read_only=True)
    out: dict[str, set[Fact]] = {k: set() for k in KINDS}
    marks = ",".join("?" * len(files))
    for (id_nut,) in conn.execute(
            f"SELECT n.id_nut FROM nut n JOIN tep t USING (ma_tep) WHERE t.duong_dan_tuong_doi IN ({marks})"
            f" AND n.loai_nut IN ({','.join('?' * len(SYMBOL_NODE_KINDS))})", (*files, *SYMBOL_NODE_KINDS)):
        out["symbol"].add((key_of(id_nut),))
    for kind, a_id, a_file, b_id, b_file, line in conn.execute(
            f"SELECT c.loai_canh, a.id_nut, ta.duong_dan_tuong_doi, b.id_nut, tb.duong_dan_tuong_doi, c.dong_bang_chung FROM canh c"
            f" JOIN nut a ON a.ma_nut = c.ma_nut_nguon JOIN tep ta ON ta.ma_tep = a.ma_tep"
            f" JOIN nut b ON b.ma_nut = c.ma_nut_dich LEFT JOIN tep tb ON tb.ma_tep = b.ma_tep"
            f" WHERE c.loai_canh IN ('CALLS','IMPORTS','INHERITS','IMPLEMENTS','TESTED_BY') AND ta.duong_dan_tuong_doi IN ({marks})",
            tuple(files)):
        k = EDGE_KIND[kind]
        if b_file is None:
            continue
        if k == "import":
            out[k].add((a_file, b_file, line))      # IMPORTS có thể trỏ tới symbol: quy về tệp
        elif k == "test":
            out[k].add((key_of(a_id), b_file))
        else:
            out[k].add((key_of(a_id), key_of(b_id), line))
    conn.close()
    return out


def baseline_facts(path: Path, files: set[str]) -> dict[str, set[Fact]]:
    """Đồ thị trích xuất gốc (graph.json): nút theo (source_file, nhãn), cạnh theo cặp nút, KHÔNG có dòng.

    Chỉ nút gọi được (`_callable`: hàm, lớp, phương thức) tính là symbol; phương thức mang tên lớp (`Lớp.phương_thức`)
    qua cạnh `method`. Đích không có tệp (thư viện ngoài) bị bỏ, giống nhãn tay không tính lời gọi ra ngoài.
    """
    data = json.loads(path.read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in data["nodes"]}
    links = data.get("links") or data.get("edges") or []
    owner = {e["target"]: e["source"] for e in links if e.get("relation") == "method"}
    out: dict[str, set[Fact]] = {k: set() for k in KINDS}

    def key(n: dict) -> str:
        label = re.sub(r"\(\)$", "", n["label"]).lstrip(".")
        cls = nodes.get(owner.get(n["id"], ""))
        return f"{n['source_file']}::{re.sub(r'\(\)$', '', cls['label']).lstrip('.') + '.' if cls else ''}{label}"

    for n in nodes.values():
        if n.get("source_file") in files and n.get("_callable"):
            out["symbol"].add((key(n),))
    for e in links:
        a, b = nodes.get(e["source"]), nodes.get(e["target"])
        if not a or not b or a.get("source_file") not in files or not b.get("source_file"):
            continue
        rel = e.get("relation", "")
        if rel == "calls":
            out["call"].add((key(a), key(b), None))
        elif rel in ("imports", "imports_from"):
            out["import"].add((a["source_file"], b["source_file"], None))
        elif rel in ("inherits", "extends", "implements"):
            out["inherit"].add((key(a), key(b), None))
    return out


def score(labels: dict[str, set[Fact]], found: dict[str, set[Fact]], *, ignore_line: bool = False) -> tuple[dict, dict]:
    def norm(k: str, facts: set[Fact]) -> set[Fact]:
        return {(f[0], f[1], None) for f in facts} if ignore_line and k in ("call", "import", "inherit") else facts

    result: dict[str, dict] = {}
    details: dict[str, dict] = {}
    # NexGraph nối TESTED_BY từ lớp tới tệp test, nhãn tay thường ở mức phương thức: báo thêm mức tệp (tệp nguồn, tệp test).
    labels = {**labels, "test_file": {(f[0].split("::")[0], f[1]) for f in labels["test"]}}
    found = {**found, "test_file": {(f[0].split("::")[0], f[1]) for f in found["test"]}}
    for k in (*KINDS, "test_file"):
        lab, got = norm(k, labels[k]), norm(k, found[k])
        tp, fp, fn = len(lab & got), len(got - lab), len(lab - got)
        result[k] = {"tp": tp, "fp": fp, "fn": fn,
                     "precision": round(tp / (tp + fp), 3) if tp + fp else None,
                     "recall": round(tp / (tp + fn), 3) if tp + fn else None}
        details[k] = {"fp": sorted(map(list, got - lab), key=str), "fn": sorted(map(list, lab - got), key=str)}
    return result, details


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("db", type=Path)
    ap.add_argument("labels", type=Path)
    ap.add_argument("--baseline", type=Path, default=None, help="graph.json của công cụ trích xuất gốc; bỏ qua cột dòng khi chấm")
    ap.add_argument("--details", type=Path, default=None, help="ghi danh sách fp/fn để phân loại nguyên nhân")
    ap.add_argument("--ignore-line", action="store_true", help="khớp cạnh theo cặp nút như đồ thị gốc (để so cùng điều kiện)")
    args = ap.parse_args()
    labels, files = read_labels(args.labels), label_files(args.labels)
    if args.baseline:
        result, details = score(labels, baseline_facts(args.baseline, files), ignore_line=True)
    else:
        result, details = score(labels, db_facts(args.db, files), ignore_line=args.ignore_line)
    print(json.dumps(result, indent=2))
    if args.details:
        args.details.write_text(json.dumps(details, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
