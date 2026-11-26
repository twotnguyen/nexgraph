"""Tiến trình con: chạy một bước của pipeline vendor với `GRAPHIFY_OUT` đã đặt (NG-PIPE-1).

Vendor đọc `GRAPHIFY_OUT` một lần lúc import (`graphify.paths`), nên biến phải có trước khi import
`graphify.__main__`. Không sửa mã vendor: chỉ đổi `sys.argv`, thư mục làm việc và biến môi trường.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path


def run_vendor(root: Path, out_dir: Path, vendor_args: list[str]) -> int:
    """Chạy `graphify <vendor_args>` trong `root`, đầu ra ở `out_dir`; trả mã thoát của vendor."""
    if not vendor_args:
        print("pipeline-run: thiếu lệnh cho pipeline", file=sys.stderr)
        return 2
    root, out_dir = Path(root).resolve(), Path(out_dir).resolve()
    if not root.is_dir():
        print(f"pipeline-run: không phải thư mục dự án: {root}", file=sys.stderr)
        return 2
    os.environ["GRAPHIFY_OUT"] = str(out_dir)
    os.environ.setdefault("GRAPHIFY_BACKEND", "none")
    os.environ["PYTHONIOENCODING"] = "utf-8"
    os.chdir(root)
    previous_argv = sys.argv
    sys.argv = ["graphify", *vendor_args]
    try:
        from graphify.__main__ import main as vendor_main

        vendor_main()
    except SystemExit as exc:  # CLI vendor thoát bằng SystemExit ở mọi nhánh
        code = exc.code
        if code is None:
            return 0
        return code if isinstance(code, int) else 1
    finally:
        sys.argv = previous_argv
    return 0
