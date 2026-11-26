"""W2 Task 2: mỗi đuôi code của graphify có tệp mẫu thì phải trích ra symbol (grammar đã được đóng gói)."""
from pathlib import Path

import pytest
from graphify.detect import CODE_EXTENSIONS
from graphify.extract import _get_extractor, extract

FIXTURES = Path(__file__).parents[2] / "third_party" / "graphify" / "tests" / "fixtures"
# Đuôi không cần symbol: tệp dữ liệu/manifest mà fixture upstream không có nội dung trích được.
NO_SYMBOLS = {
    ".json": "fixture upstream là JSON dữ liệu, graphify chỉ trích manifest đã biết",
    ".dmm": "bản đồ DM: chỉ có cạnh `uses` tới kiểu khai báo ở tệp khác",
    ".psd1": "manifest PowerShell: chỉ có cạnh `imports_from`",
}


def _samples() -> dict[str, Path]:
    out: dict[str, Path] = {}
    for p in sorted(FIXTURES.rglob("*")):
        if p.is_file() and p.suffix in CODE_EXTENSIONS and p.suffix not in out and _get_extractor(p):
            out[p.suffix] = p
    return out


@pytest.mark.parametrize("ext,path", sorted(_samples().items()))
def test_every_code_extension_with_fixture_yields_nodes(ext, path, tmp_path):
    if ext in NO_SYMBOLS:
        pytest.skip(NO_SYMBOLS[ext])
    r = extract([path], cache_root=tmp_path, root=path.parent, parallel=False)
    assert len([n for n in r["nodes"] if n.get("label") != path.name]) > 0, f"{ext}: thiếu grammar?"
