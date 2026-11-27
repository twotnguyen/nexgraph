"""Đọc, tìm và liệt kê tệp của dự án cho agent, qua cùng chính sách nguồn với `read_code`.

Agent native (Nex) trước đây dùng `read`/`grep`/`glob` của OpenCode: các tool đó đọc thẳng đĩa nên thấy
`.env`, khoá riêng, tệp trong `.gitignore` và tệp người dùng loại khỏi AI. Ba hàm ở đây thay chúng:

- mọi đường dẫn đi qua `SourcePolicy` (tên nhạy cảm, mẫu loại trừ AI, `.gitignore`, biên dự án, cỡ tệp);
- tệp không phải mã nguồn (tài liệu, cấu hình, tệp không rõ loại) được che secret trước khi trả về,
  và `grep` tìm trên bản ĐÃ CHE, nên không dò được giá trị secret bằng biểu thức;
- không theo symlink khi duyệt cây thư mục;
- không cần tệp đã được lập chỉ mục (agent đọc được tệp nó vừa tạo).
"""
from __future__ import annotations

import os
import re
import time
from collections.abc import Iterator
from pathlib import Path
from tempfile import TemporaryDirectory

try:  # Python 3.11+: module công khai sre_* đã deprecated, bản trong `re` giữ nguyên API
    from re import _constants as sre_constants, _parser as sre_parse
except ImportError:  # pragma: no cover
    import sre_constants  # type: ignore[no-redef]
    import sre_parse  # type: ignore[no-redef]

from pathspec import GitIgnoreSpec

from nexgraph_engine.analysis.query.source_policy import SourcePolicy
from nexgraph_engine.core.errors import ApiError
from nexgraph_engine.indexing.docs.secrets import redact_doc_secrets
from nexgraph_engine.indexing.docs.text import doc_text
from nexgraph_engine.indexing.index.discovery import (
    CONFIG_LANGUAGES, DOC_LANGUAGE_BY_EXT, DOC_LANGUAGES, SKIP_DIRS, language_of,
)

MAX_READ_LINES = 2000
MAX_READ_LINE_CHARS = 2000
MAX_GREP_LINE_CHARS = 300
# Chỉ tìm trong 10.000 ký tự đầu của mỗi dòng: dòng dài hơn là mã đã nén/dữ liệu, và giữ chi phí regex có trần.
MAX_GREP_SEARCH_CHARS = 10_000
MAX_GLOB_ALTERNATIVES = 64
MAX_DIR_ENTRIES = 1000
MAX_RESULTS = 500
MAX_SCAN_FILES = 50_000
SCAN_SECONDS = 15.0
_BINARY_PROBE = 8192


def _name(path: str | None) -> str:
    """Đường dẫn tương đối dạng POSIX; rỗng nghĩa là gốc dự án."""
    name = (path or "").strip().replace("\\", "/")
    while name.startswith("./"):
        name = name[2:]
    name = name.rstrip("/")
    return "" if name == "." else name


# Ngôn ngữ mà engine nhận là "code" nhưng thực chất là cấu hình, nơi secret hay nằm (CI, Helm, Terraform,
# `.mcp.json` có token của server MCP, manifest gói có URL registry kèm khoá).
_CONFIG_LANGUAGES = CONFIG_LANGUAGES | {"terraform"}
# Tài liệu nhị phân: đọc bằng cùng bộ chuyển sang chữ như lúc index (`read_code`).
_CONVERTED = ("docx", "xlsx", "pdf")


def _doc_language(name: str) -> str | None:
    return DOC_LANGUAGE_BY_EXT.get(os.path.splitext(name)[1].lower())


def _redacted(name: str) -> bool:
    """Mã nguồn giữ nguyên như `read_code` (để agent sửa được đúng chuỗi); tài liệu, cấu hình và tệp
    không rõ loại thì che secret."""
    language = language_of(name)
    return (language is None or language in DOC_LANGUAGES or language in _CONFIG_LANGUAGES
            or _doc_language(name) is not None)


def _text(policy: SourcePolicy, name: str, path: Path, *, convert: bool = False) -> list[str] | None:
    """Các dòng của tệp chữ đã qua chính sách (và đã che nếu cần); None nếu là tệp nhị phân.

    `convert=True`: docx/xlsx/PDF chuyển sang chữ từ chính các byte đã kiểm (bộ chuyển mở tên tệp, nên
    ghi ra thư mục tạm như `read_code`, không đưa đường dẫn thật cho nó).
    """
    data = policy.read(name, path)
    language = _doc_language(name)
    if convert and language in _CONVERTED:
        with TemporaryDirectory(prefix="nexgraph-ai-doc-") as tmp:
            document = Path(tmp) / f"document.{language}"
            document.write_bytes(data)
            return redact_doc_secrets(doc_text(document, language)).splitlines()
    if b"\0" in data[:_BINARY_PROBE]:
        return None
    text = data.decode("utf-8", errors="replace")
    if _redacted(name):
        # Che cả tệp một lần: khối PEM nhiều dòng chỉ nhận ra được khi thấy đủ khối.
        text = redact_doc_secrets(text)
    return text.splitlines()


def _clip(line: str, limit: int) -> str:
    return line if len(line) <= limit else f"{line[:limit]}… (+{len(line) - limit} ký tự)"


def read_file(root: Path, policy: SourcePolicy, path: str, start: int | None = None, end: int | None = None) -> dict:
    """Đọc một tệp chữ (tối đa 2.000 dòng mỗi lần) hoặc liệt kê một thư mục."""
    name = _name(path)
    target = policy.root if not name else policy.resolve(name)  # gốc dự án luôn được phép liệt kê
    if target.is_dir():
        entries: list[str] = []
        truncated = False
        for entry in sorted(os.scandir(target), key=lambda e: e.name):
            rel = f"{name}/{entry.name}" if name else entry.name
            if entry.is_symlink():
                continue
            directory = entry.is_dir(follow_symlinks=False)
            if not policy.allows(rel, directory=directory):
                continue
            if len(entries) >= MAX_DIR_ENTRIES:
                truncated = True
                break
            entries.append(f"{entry.name}/" if directory else entry.name)
        return {"path": name or ".", "kind": "directory", "entries": entries, "truncated": truncated}
    if not target.is_file():
        raise ApiError(404, "file_not_found", f"Không có tệp: {name}")
    first = 1 if start is None else start
    if first < 1 or (end is not None and (end < first or end - first + 1 > MAX_READ_LINES)):
        raise ApiError(400, "bad_param", f"start >= 1, end >= start, tối đa {MAX_READ_LINES} dòng mỗi lần")
    lines = _text(policy, name, target, convert=True)
    if lines is None:
        raise ApiError(415, "binary_file", f"Tệp nhị phân, không đọc dạng chữ được: {name}")
    last = min(len(lines), end if end is not None else first + MAX_READ_LINES - 1)
    shown = lines[first - 1:last]
    return {"path": name, "kind": "file", "start": first, "end": last, "total_lines": len(lines),
            "text": "\n".join(_clip(line, MAX_READ_LINE_CHARS) for line in shown),
            "truncated": end is None and last < len(lines),
            # Hai cờ cho agent: văn bản không phải nguyên bản, đừng ghi đè cả tệp từ nó.
            "redacted": _redacted(name), "clipped": any(len(line) > MAX_READ_LINE_CHARS for line in shown)}


class _Scan:
    """Duyệt cây thư mục theo chính sách, có trần số tệp và thời gian để dự án lớn không treo agent."""

    def __init__(self, root: Path, policy: SourcePolicy) -> None:
        self.root = policy.root
        self.policy = policy
        self.files = 0
        self.truncated = False
        self._deadline = time.monotonic() + SCAN_SECONDS

    def expired(self) -> bool:
        return time.monotonic() > self._deadline

    def walk(self, base: str) -> Iterator[str]:
        start = self.policy.root if not base else self.policy.resolve(base)
        if start.is_file():
            yield base
            return
        if not start.is_dir():
            raise ApiError(404, "file_not_found", f"Không có thư mục hoặc tệp: {base}")
        stack = [base]
        while stack:
            folder = stack.pop()
            try:
                entries = sorted(os.scandir(self.root / folder if folder else self.root), key=lambda e: e.name)
            except OSError:
                continue
            folders: list[str] = []
            for entry in entries:
                if self.files >= MAX_SCAN_FILES or time.monotonic() > self._deadline:
                    self.truncated = True
                    return
                rel = f"{folder}/{entry.name}" if folder else entry.name
                if entry.is_symlink():
                    continue
                if entry.is_dir(follow_symlinks=False):
                    # Thư mục build/phụ thuộc mà lập chỉ mục cũng bỏ: duyệt chúng làm hết trần trước khi tới mã.
                    # Muốn tìm trong đó thì truyền `path` trỏ vào.
                    if entry.name not in SKIP_DIRS and self.policy.allows(rel, directory=True):
                        folders.append(rel)
                elif entry.is_file(follow_symlinks=False) and self.policy.allows(rel):
                    self.files += 1
                    yield rel
            stack.extend(reversed(folders))


def _expand_braces(pattern: str) -> list[str]:
    """`*.{ts,tsx}` → `*.ts`, `*.tsx` (cú pháp .gitignore không có ngoặc nhọn; glob của rg thì có)."""
    match = re.search(r"\{([^{}]*,[^{}]*)\}", pattern)
    if match is None:
        return [pattern]
    out: list[str] = []
    for option in match.group(1).split(","):
        out.extend(_expand_braces(pattern[:match.start()] + option + pattern[match.end():]))
        if len(out) > MAX_GLOB_ALTERNATIVES:
            raise ApiError(400, "bad_param", f"Mẫu có quá {MAX_GLOB_ALTERNATIVES} lựa chọn trong ngoặc nhọn")
    return out


def _spec(pattern: str | None, field: str) -> GitIgnoreSpec | None:
    if not pattern:
        return None
    try:
        return GitIgnoreSpec.from_lines(_expand_braces(pattern))
    except ValueError as exc:
        raise ApiError(400, "bad_param", f"Mẫu {field} không hợp lệ: {exc}") from exc


def _relative_to(base: str, rel: str) -> str:
    return rel[len(base) + 1:] if base and rel.startswith(f"{base}/") else rel


def _nested_repeat(items: sre_parse.SubPattern | list, inside: bool = False) -> bool:
    """Lượng từ lặp nhiều lần lồng nhau, hoặc nhánh `|` trong lượng từ: dạng gây quay lui hàm mũ (ReDoS)."""
    for op, arg in items:
        if op in (sre_constants.MAX_REPEAT, sre_constants.MIN_REPEAT, getattr(sre_constants, "POSSESSIVE_REPEAT", None)):
            low, high, body = arg
            many = high is sre_constants.MAXREPEAT or high > 1
            if many and inside:
                return True
            if _nested_repeat(body, inside or many):
                return True
        elif op is sre_constants.BRANCH:
            if inside:
                return True
            if any(_nested_repeat(branch, inside) for branch in arg[1]):
                return True
        elif op is sre_constants.SUBPATTERN:
            if _nested_repeat(arg[-1], inside):
                return True
        elif op in (sre_constants.ASSERT, sre_constants.ASSERT_NOT):
            if _nested_repeat(arg[1], inside):
                return True
    return False


def _compile(pattern: str, literal: bool, case_sensitive: bool) -> re.Pattern[str]:
    """Biểu thức do model đưa vào (có thể từ prompt injection) không được treo engine: `re` không có giới
    hạn thời gian, nên từ chối dạng lượng từ lồng nhau trước khi chạy."""
    flags = 0 if case_sensitive else re.IGNORECASE
    if literal:
        return re.compile(re.escape(pattern), flags)
    try:
        regex = re.compile(pattern, flags)
        nested = _nested_repeat(sre_parse.parse(pattern, flags))
    except re.error as exc:
        raise ApiError(400, "bad_param", f"Biểu thức không hợp lệ: {exc}") from exc
    if nested:
        raise ApiError(400, "bad_param", "Biểu thức có lượng từ lồng nhau hoặc nhánh | trong lượng từ (dễ chạy rất"
                                         " lâu); hãy viết đơn giản hơn hoặc dùng literal=true")
    return regex


def grep(root: Path, policy: SourcePolicy, pattern: str, path: str | None = None, include: str | None = None,
         literal: bool = False, case_sensitive: bool = True, limit: int = 100) -> dict:
    """Tìm biểu thức (hoặc chuỗi) trong nội dung các tệp được phép; trả tệp, dòng và đoạn dòng khớp."""
    if not pattern:
        raise ApiError(400, "bad_param", "Cần biểu thức cần tìm")
    regex = _compile(pattern, literal, case_sensitive)
    wanted = _spec(include, "include")
    limit = max(1, min(limit, MAX_RESULTS))
    base = _name(path)
    scan = _Scan(root, policy)
    matches: list[dict] = []
    truncated = False
    for rel in scan.walk(base):
        if wanted is not None and not wanted.match_file(_relative_to(base, rel)):
            continue
        try:
            # Đường dẫn thật (`resolve`), không ghép chuỗi: `path` có thể là symlink tới thư mục trong dự án.
            lines = _text(policy, rel, policy.resolve(rel))
        except ApiError:  # quá cỡ, bị tráo trong lúc đọc: bỏ qua như rg bỏ tệp không đọc được
            continue
        if lines is None:
            continue
        for number, line in enumerate(lines, 1):
            if number % 2000 == 0 and scan.expired():
                scan.truncated = True
                break
            if regex.search(line, 0, MAX_GREP_SEARCH_CHARS):
                if len(matches) >= limit:
                    truncated = True
                    break
                matches.append({"file": rel, "line": number, "text": _clip(line.strip(), MAX_GREP_LINE_CHARS)})
        if truncated or scan.truncated:
            break
    return {"matches": matches, "truncated": truncated or scan.truncated, "files_scanned": scan.files}


def glob(root: Path, policy: SourcePolicy, pattern: str, path: str | None = None, limit: int = 200) -> dict:
    """Liệt kê tệp được phép khớp mẫu glob (cú pháp .gitignore: `*.ts`, `src/**/*.py`), tính từ `path`."""
    spec = _spec(pattern, "glob")
    if spec is None:
        raise ApiError(400, "bad_param", "Cần mẫu glob")
    limit = max(1, min(limit, MAX_RESULTS))
    base = _name(path)
    scan = _Scan(root, policy)
    files: list[str] = []
    truncated = False
    for rel in scan.walk(base):
        if spec.match_file(_relative_to(base, rel)):
            if len(files) >= limit:
                truncated = True
                break
            files.append(rel)
    return {"files": files, "truncated": truncated or scan.truncated, "files_scanned": scan.files}
