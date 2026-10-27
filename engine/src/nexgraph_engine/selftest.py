import shutil
import tempfile
from importlib import resources
from pathlib import Path

from graphify.extract import extract


def run_selftest() -> dict:
    """Extract một file mẫu đóng gói sẵn bằng Graphify để kiểm tra bản đóng gói."""
    src = resources.files("nexgraph_engine.resources.selftest").joinpath("hello.py")
    with tempfile.TemporaryDirectory(prefix="ng-selftest-") as tmp:
        # Chép ra thư mục tạm vì package có thể nằm trong bản đóng gói chỉ đọc.
        target = Path(tmp) / "hello.py"
        with resources.as_file(src) as p:
            shutil.copyfile(p, target)
        result = extract([target], cache_root=Path(tmp), root=Path(tmp), parallel=False)
    nodes = len(result["nodes"])
    return {"ok": nodes >= 2, "nodes": nodes}
