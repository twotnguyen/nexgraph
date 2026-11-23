"""Quy tắc nguồn được phép đưa vào công cụ AI, độc lập với tuổi của đồ thị."""
from __future__ import annotations

import os
import re
import stat
from pathlib import Path, PurePosixPath, PureWindowsPath

from pathspec import GitIgnoreSpec

from graphify.detect import _AMBIGUOUS_SENSITIVE_DIRS, _CREDENTIAL_STORE_DIRS, _is_sensitive

from nexgraph_engine.errors import ApiError

MAX_MODEL_SOURCE_BYTES = 5 * 1024 * 1024
MAX_IGNORE_BYTES = 1024 * 1024
_BLOCKED = {".git", ".nexgraph", ".npmrc", ".netrc", ".kube", ".dart_tool", "node_modules", "build"}
_PREFIXES = (".env", "credentials", "id_rsa", "id_ed25519", "id_ecdsa", "id_dsa")
_SUFFIXES = (".pem", ".key")
# Khoá cluster/cloud: `graphify.detect._is_sensitive` bỏ qua slug nhiều từ (`service-account-prod.json`) và không
# biết `kubeconfig`, nên policy chặn thêm theo tên (re-review #52 Important 3). `.kube/config` chặn qua `_BLOCKED`.
_CLOUD_CREDENTIAL_NAMES = (
    re.compile(r"^kubeconfig.*$"),                          # kubeconfig, kubeconfig.yaml, kubeconfig-prod.yaml
    re.compile(r"^.+\.kubeconfig$"),                        # prod.kubeconfig
    re.compile(r"^service[._-]?account.*\.(json|ya?ml|toml)$"),  # service-account-prod.json
    re.compile(r"^.+[-_]sa[-_]key.*\.json$"),               # prod-sa-key.json, *-sa-key*.json
    re.compile(r"^gcp-.+\.json$"),                          # gcp-nexgraph.json
)
# Không có miễn trừ theo tên: tài liệu `docs/secrets.md` cũng là nguồn bị loại. Che bằng regex không bao giờ kín,
# nên nó không được làm hàng rào duy nhất cho tệp có tên nhạy cảm (quyết định lead, re-review #52 vòng 3).


def protected_source() -> ApiError:
    return ApiError(403, "protected_source", "Nguồn bị loại khỏi ngữ cảnh AI")


def safe_project_path(root: Path, name: str) -> Path:
    path = PurePosixPath(name)
    if (not path.parts or path.is_absolute() or "\\" in name or PureWindowsPath(name).drive
            or ".." in path.parts or (os.name == "nt" and ":" in name)):
        raise ApiError(400, "bad_path", "Đường dẫn phải là đường dẫn tương đối nằm trong dự án")
    try:
        canonical_root = root.resolve()
        resolved = (canonical_root / name).resolve()
    except (ValueError, OSError, RuntimeError) as exc:
        raise ApiError(400, "bad_path", "Đường dẫn tệp không hợp lệ") from exc
    if not resolved.is_relative_to(canonical_root):
        raise ApiError(403, "outside_project", "Tệp nằm ngoài thư mục dự án")
    return resolved


def _blocked_name(parts: tuple[str, ...]) -> bool:
    for part in (p.lower() for p in parts):
        if (part in _BLOCKED or part.startswith(_PREFIXES) or part.endswith(_SUFFIXES)
                or any(pattern.match(part) for pattern in _CLOUD_CREDENTIAL_NAMES)):
            return True
    return False


def _identity(st: os.stat_result) -> tuple[int, int, int, int]:
    return (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns)


def _unchanged(before: os.stat_result, after: os.stat_result) -> bool:
    return _identity(before) == _identity(after) and before.st_ctime_ns == after.st_ctime_ns


class SourcePolicy:
    """Một chính sách cho mỗi truy vấn. Mẫu người dùng và .gitignore đều có quyền loại trừ."""

    def __init__(self, root: Path, exclude: list[str] | None = None) -> None:
        self.root = root.resolve()
        try:
            self._exclude = GitIgnoreSpec.from_lines(exclude or [])
        except ValueError as exc:
            raise protected_source() from exc
        self._gitignore: dict[tuple[str, ...], GitIgnoreSpec | None] = {}
        self._known: dict[tuple[str, bool, bool], bool] = {}
        self._root_sensitive = any(p.lower() in _CREDENTIAL_STORE_DIRS | _AMBIGUOUS_SENSITIVE_DIRS for p in self.root.parts)

    def _rules(self, parent: tuple[str, ...]) -> GitIgnoreSpec | None:
        if parent not in self._gitignore:
            path = self.root.joinpath(*parent, ".gitignore")
            try:
                info = path.lstat()
            except FileNotFoundError:
                self._gitignore[parent] = None
                return None
            if stat.S_ISLNK(info.st_mode):
                self._gitignore[parent] = None  # Git không đọc .gitignore qua symlink.
                return None
            if (not stat.S_ISREG(info.st_mode) or info.st_size > MAX_IGNORE_BYTES
                    or not path.resolve().is_relative_to(self.root)):
                raise protected_source()
            with path.open("rb") as stream:
                contents = stream.read(MAX_IGNORE_BYTES + 1)
            if len(contents) > MAX_IGNORE_BYTES:
                raise protected_source()
            self._gitignore[parent] = GitIgnoreSpec.from_lines(contents.decode("utf-8-sig").splitlines())
        return self._gitignore[parent]

    def _excluded(self, parts: tuple[str, ...], *, directory: bool) -> bool:
        if _blocked_name(parts):
            return True
        # Tiêu chí tệp bí mật của công cụ tham chiếu (W9 dùng khi chọn tệp gửi model). Đường dẫn tuyệt đối để đọc được
        # shebang của tệp không có đuôi; nhưng nếu chính thư mục chứa dự án mang tên như `secrets/`, `.aws/` thì xét
        # đường dẫn tương đối, kẻo mọi tệp bị chặn (tệp không đuôi khi đó mất bước đọc shebang, nghiêng về chặn).
        if parts and not directory and _is_sensitive(
                Path(*parts) if self._root_sensitive else self.root.joinpath(*parts)):
            return True
        # Git không đi vào thư mục đã ẩn, kể cả khi tệp con có mẫu phủ định.
        for end in range(1, len(parts) + 1):
            suffix = "/" if end < len(parts) or directory else ""
            if self._exclude.match_file("/".join(parts[:end]) + suffix):
                return True
            for start in range(end):
                rules = self._rules(parts[:start])
                if rules is not None and rules.match_file("/".join(parts[start:end]) + suffix):
                    return True
        return False

    def resolve(self, name: str, *, directory: bool = False) -> Path:
        lexical = PurePosixPath(name).parts
        if _blocked_name(lexical):
            raise protected_source()
        path = safe_project_path(self.root, name)
        canonical = path.relative_to(self.root).parts
        try:
            directory = directory or path.is_dir()
            if (self._excluded(lexical, directory=directory) or (
                    canonical != lexical and self._excluded(canonical, directory=directory))):
                raise protected_source()
        except (OSError, ValueError, RuntimeError) as exc:
            raise protected_source() from exc
        return path

    def allows(self, name: str, *, directory: bool = False) -> bool:
        key = (name, directory)
        if key not in self._known:
            try:
                self.resolve(name, directory=directory)
            except ApiError:
                self._known[key] = False
            else:
                self._known[key] = True
        return self._known[key]

    def read(self, name: str, path: Path) -> bytes:
        """Ràng buộc byte với tệp đã kiểm bằng handle, kể cả nếu đích bị tráo trong lúc mở."""
        try:
            before = path.lstat()
            if not stat.S_ISREG(before.st_mode) or self.resolve(name) != path:
                raise protected_source()
            if before.st_size > MAX_MODEL_SOURCE_BYTES:
                raise ApiError(413, "source_too_large", "Nguồn quá lớn cho ngữ cảnh AI")
            flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
            with os.fdopen(os.open(path, flags), "rb") as stream:
                opened = os.fstat(stream.fileno())
                # Windows có thể báo ctime khác nhau giữa lstat và fstat của cùng tệp.
                if (_identity(opened) != _identity(before)
                        or self.resolve(name) != path):
                    raise protected_source()
                content = stream.read(MAX_MODEL_SOURCE_BYTES + 1)
                if (len(content) != before.st_size or not _unchanged(opened, os.fstat(stream.fileno()))
                        or not _unchanged(before, path.lstat())
                        or self.resolve(name) != path):
                    raise protected_source()
                return content
        except OSError as exc:
            raise protected_source() from exc
