#!/usr/bin/env python3
"""Đọc `[project].version` từ pyproject.toml bằng TOML parser chuẩn (tomllib).

Script CI `scripts/ci/check-version.mjs` gửi nguyên nội dung tệp qua stdin và
nhận version trên stdout — nhờ vậy parser theo dòng không còn cơ hội đọc nhầm
`version = "..."` nằm trong chuỗi nhiều dòng của trường khác (vd. description).

Cần Python >= 3.11 vì `tomllib` chỉ có trong stdlib từ bản đó. Ghi/đọc qua
`sys.stdout.buffer` / `sys.stdin.buffer` để không phụ thuộc code page của
Windows (Node luôn giải mã UTF-8).
"""

import sys

try:
    import tomllib
except ModuleNotFoundError:  # Python < 3.11
    sys.stderr.write("requires Python 3.11+ (tomllib) to read [project].version\n")
    sys.exit(1)


def fail(message: str) -> int:
    sys.stderr.buffer.write((message + "\n").encode("utf-8"))
    return 1


def main() -> int:
    raw = sys.stdin.buffer.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        return fail(f"tệp TOML không phải UTF-8: {exc}")
    try:
        data = tomllib.loads(text)
    except tomllib.TOMLDecodeError as exc:
        return fail(f"TOML không hợp lệ: {exc}")
    project = data.get("project")
    version = project.get("version") if isinstance(project, dict) else None
    if not isinstance(version, str) or not version:
        return fail("không thấy version dạng chuỗi trong bảng [project]")
    sys.stdout.buffer.write((version + "\n").encode("utf-8"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
