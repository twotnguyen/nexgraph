"""MIN-tmp-leak: engine không để lại thư mục trong thư mục tạm của máy sau khi xong việc."""
import gc
import tempfile

import pytest

from nexgraph_engine.api.services import Services


@pytest.fixture
def watched_tmp(tmp_path, monkeypatch):
    """Thư mục tạm riêng cho cả tiến trình này lẫn worker con (spawn kế thừa biến môi trường)."""
    tmp = tmp_path / "tmp"
    tmp.mkdir()
    for key in ("TMPDIR", "TEMP", "TMP"):
        monkeypatch.setenv(key, str(tmp))
    monkeypatch.setattr(tempfile, "tempdir", None)
    return tmp


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
