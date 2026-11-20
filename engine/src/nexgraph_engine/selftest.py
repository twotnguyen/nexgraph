import importlib
import shutil
import sqlite3
import tempfile
from importlib import resources
from pathlib import Path

from graphify.extract import extract

from nexgraph_engine.schema.db import load_sql


# Grammar graphify dùng (W2). tree_sitter_vb_dotnet không có wheel cho macOS Intel nên được phép thiếu ở đó.
GRAMMAR_MODULES = tuple(f"tree_sitter_{n}" for n in (
    "bash", "c", "c_sharp", "commonlisp", "cpp", "dart", "dm", "elixir", "embedded_template", "fortran", "go",
    "groovy", "hcl", "java", "javascript", "json", "julia", "kotlin", "language_pack", "lua", "objc", "ocaml",
    "pascal", "php", "powershell", "python", "ruby", "rust", "scala", "solidity", "sql", "swift", "typescript",
    "vb_dotnet", "verilog", "yaml", "zig")) + ("robot",)


def _grammars() -> tuple[list[str], list[str]]:
    ok, missing = [], []
    for mod in GRAMMAR_MODULES:
        try:
            m = importlib.import_module(mod)
            if mod == "tree_sitter_language_pack":  # bản đóng gói chỉ giữ hai binding này (packaging spec)
                m.get_language("erlang"), m.get_language("r")
            ok.append(mod)
        except Exception:  # ImportError hoặc lỗi nạp thư viện native trong bản đóng gói
            missing.append(mod)
    return ok, missing


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
    grammars, missing = _grammars()
    return {"ok": nodes >= 2 and schema_ok, "nodes": nodes, "sqlite": sqlite3.sqlite_version,
            "grammars": grammars, "missing_grammars": missing}
