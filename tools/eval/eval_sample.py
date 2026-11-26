"""Chọn mẫu tệp để gán nhãn tay (H6 Task 2). Có hạt giống: cùng --seed cho cùng danh sách.

Chạy: uv run --project engine python tools/eval/eval_sample.py <graph.db> --files 12 --seed 7 --out sample.json
Chọn ngẫu nhiên tệp mã không phải test, không nằm trong thư mục ẩn, có >= 3 symbol; chỉ ghi đường dẫn, không ghi cạnh (người gán nhãn không được nhìn kết quả).
"""
import argparse
import json
import random
from pathlib import Path

from nexgraph_engine.core.schema.db import open_graph_db

SYMBOL_KINDS = ("class", "mixin", "enum", "extension", "function", "method", "test", "widget", "screen")
MIN_SYMBOLS = 3


def sample_files(db: Path, count: int, seed: int) -> list[str]:
    conn = open_graph_db(db, read_only=True)
    marks = ",".join("?" * len(SYMBOL_KINDS))
    rows = conn.execute(
        f"SELECT t.duong_dan_tuong_doi FROM tep t JOIN nut n ON n.ma_tep = t.ma_tep WHERE t.la_kiem_thu = 0"
        f" AND n.la_kiem_thu = 0 AND n.loai_nut IN ({marks}) GROUP BY t.ma_tep HAVING count(*) >= ? ORDER BY t.duong_dan_tuong_doi",
        (*SYMBOL_KINDS, MIN_SYMBOLS)).fetchall()
    conn.close()
    names = [r[0] for r in rows if not any(part.startswith(".") for part in r[0].split("/"))]  # bỏ thư mục ẩn (.agents, .claude…): công cụ của agent, không phải mã dự án
    return sorted(random.Random(seed).sample(names, min(count, len(names))))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("db", type=Path)
    ap.add_argument("--files", type=int, default=12)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    files = sample_files(args.db, args.files, args.seed)
    args.out.write_text(json.dumps({"seed": args.seed, "files": files}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(files)} tệp -> {args.out}")


if __name__ == "__main__":
    main()
