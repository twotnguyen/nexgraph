import shutil
import sqlite3
import tempfile
from importlib import resources
from pathlib import Path

from graphify.extract import extract

from nexgraph_engine.schema.db import load_sql


def run_selftest() -> dict:
    """Extract một file mẫu đóng gói sẵn bằng bộ trích xuất đa ngôn ngữ để kiểm tra bản đóng gói."""
    src = resources.files("nexgraph_engine.resources.selftest").joinpath("hello.py")
    with tempfile.TemporaryDirectory(prefix="ng-selftest-") as tmp:
        # Chép ra thư mục tạm vì package có thể nằm trong bản đóng gói chỉ đọc.
        target = Path(tmp) / "hello.py"
        with resources.as_file(src) as p:
            shutil.copyfile(p, target)
        result = extract([target], cache_root=Path(tmp), root=Path(tmp), parallel=False)
    nodes = len(result["nodes"])
    # Kiểm tệp .sql có trong bản đóng gói và SQLite hiểu được schema (FTS5 contentless_delete).
    schema_ok = True
    try:
        sqlite3.connect(":memory:").executescript(load_sql("graph"))
    except sqlite3.Error:
        schema_ok = False
    return {"ok": nodes >= 2 and schema_ok, "nodes": nodes, "sqlite": sqlite3.sqlite_version}
