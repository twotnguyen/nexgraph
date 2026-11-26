"""Nguồn ngoài thư mục dự án (W6): repo clone từ URL và nội dung tải từ URL, đều nằm dưới thư mục dữ liệu app."""
from __future__ import annotations

from pathlib import Path

from nexgraph_engine.errors import ApiError

# Mã lỗi ổn định cho các nhánh của `graphify.security.validate_url`, để desktop dịch sang tiếng Việt
# (A3 #8). Thứ tự quan trọng: mẫu cụ thể trước mẫu chung `Blocked URL`.
_URL_ERROR_CODES = (
    ("Blocked URL scheme", "blocked_url_scheme"),
    ("Blocked URL containing embedded credentials", "blocked_url_credentials"),
    ("Blocked URL with an invalid port", "blocked_url_port"),
    ("Blocked URL with port 0", "blocked_url_port"),
    ("Blocked URL without a hostname", "blocked_url_host"),
    ("Blocked cloud metadata endpoint", "blocked_cloud_metadata"),
    ("Blocked private/internal IP", "blocked_private_ip"),
    ("Blocked URL", "blocked_url"),
    ("DNS resolution failed", "dns_failed"),
)


def url_error(exc: ValueError) -> ApiError:
    """Đổi lỗi `validate_url` của graphify thành `ApiError` 400 kèm mã ổn định; giữ nguyên message cũ."""
    message = str(exc)
    code = next((code for prefix, code in _URL_ERROR_CODES if message.startswith(prefix)), "bad_url")
    return ApiError(400, code, message)


def sources_root(data_dir: Path | None, project_id: str | None) -> Path | None:
    """`<data_dir>/sources/<pid>/`: gốc phụ của dự án, hiện trong graph dưới dạng `sources/…`."""
    return Path(data_dir) / "sources" / project_id if data_dir is not None and project_id else None


_INDEX = ".urls.json"  # tên tệp → URL gốc; bắt đầu bằng "." nên discovery bỏ qua


def _read_index(directory: Path) -> dict[str, str]:
    import json
    try:
        data = json.loads((directory / _INDEX).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_index(directory: Path, data: dict[str, str]) -> None:
    import json
    tmp = directory / (_INDEX + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(directory / _INDEX)


def ingest_url(url: str, directory: Path) -> str:
    """Tải `url` qua `graphify.ingest` (guard SSRF, giới hạn kích thước) vào `directory`; trả đường dẫn `sources/<tên>`."""
    from nexgraph_engine.adapters.graphify.ingest import ingest
    out = ingest(url, directory)
    data = _read_index(directory)
    data[out.name] = url
    _write_index(directory, data)
    return f"sources/{out.name}"


def list_sources(directory: Path | None) -> list[dict]:
    if directory is None or not directory.is_dir():
        return []
    urls = _read_index(directory)
    out = []
    for entry in sorted(directory.iterdir(), key=lambda p: p.name):
        if entry.name.startswith(".") or entry.is_symlink() or not entry.is_file():
            continue
        st = entry.stat()
        out.append({"name": entry.name, "file": f"sources/{entry.name}", "size": st.st_size,
                    "added_at": int(st.st_mtime), "url": urls.get(entry.name)})
    return out


def remove_source(directory: Path | None, name: str) -> bool:
    """Xoá một nguồn theo tên (chỉ tên tệp phẳng trong `directory`); False nếu không có."""
    from nexgraph_engine.index.discovery import flat_name
    if directory is None or not flat_name(name):
        return False
    path = directory / name
    if path.is_symlink() or not path.is_file():
        return False
    path.unlink()
    data = _read_index(directory)
    if data.pop(name, None) is not None:
        _write_index(directory, data)
    return True
