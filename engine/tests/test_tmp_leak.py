"""MIN-tmp-leak: engine không để lại thư mục trong thư mục tạm của máy sau khi xong việc."""
import gc
import subprocess
import sys
import tempfile
from pathlib import Path

from nexgraph_engine.api.services import Services


def test_test_tmp_is_inside_pytest_basetemp(tmp_path_factory):
    """Thư mục tạm trong lúc chạy test (cả tiến trình con) nằm trong basetemp của pytest, nên được pytest
    xoay vòng thay vì dồn lại trong thư mục tạm của máy (test_grammars từng để lại ~50 thư mục mỗi lượt)."""
    base = tmp_path_factory.getbasetemp()
    assert Path(tempfile.gettempdir()).resolve().is_relative_to(base.resolve())
    child = subprocess.run([sys.executable, "-I", "-c", "import tempfile; print(tempfile.gettempdir())"],
                           capture_output=True, text=True, check=True).stdout.strip()
    assert Path(child).resolve().is_relative_to(base.resolve())


def test_services_without_data_dir_removes_its_temp_dir(watched_tmp):
    """`Services(None)` tự tạo thư mục dữ liệu tạm: phải xoá khi tắt, và cả khi app bị bỏ mà không tắt
    (TestClient không dùng `with` thì lifespan không chạy)."""
    services = Services(None)
    owned = services.data_dir
    assert owned.parent == watched_tmp and owned.is_dir()
    services.shutdown()
    assert not owned.exists()

    dropped = Services(None).data_dir
    gc.collect()
    assert not dropped.exists()
