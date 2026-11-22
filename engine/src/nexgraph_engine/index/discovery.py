"""Quét thư mục project: chọn tệp mã cần phân tích, bỏ tệp sinh tự động, thư mục build và mọi symlink."""
from __future__ import annotations

import hashlib
import os
import re
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path, PureWindowsPath

import pathspec
from graphify.detect import DOC_EXTENSIONS as _GRAPHIFY_DOC_EXTS
from graphify.extract import _get_extractor
from graphify.rcfile import activate_language_overrides
from graphify.extractors.json_config import _CONFIG_JSON_NAMES

from nexgraph_engine.docs import media as _media

# Thư mục luôn bỏ (spec §5.5); `.nexgraph/` là dữ liệu của chính NexGraph.
# `.git`/`.nexgraph` không bao giờ lập chỉ mục; các mục còn lại (và thư mục ẩn nói chung) chỉ bị bỏ mặc định —
# người dùng chọn rõ một package trong đó (monorepo) thì vẫn đi vào.
ALWAYS_SKIP_DIRS = frozenset({".git", ".nexgraph"})
SKIP_DIRS = frozenset({"build", ".dart_tool", "node_modules", "dist", "__pycache__", ".venv", "venv"})
GENERATED_SUFFIXES = (".g.dart", ".freezed.dart", ".gr.dart", ".config.dart", ".mocks.dart",
                      "_generated.dart", ".pb.dart")
# Tệp đã rút gọn/nhúng: không có cấu trúc đọc được, chỉ làm phình đồ thị (spec §5.5).
MINIFIED_SUFFIXES = (".min.js", ".min.mjs", ".min.cjs", ".min.css", ".bundle.js", ".bundle.mjs",
                     ".bundle.css", "-min.js", "-min.css")

# Tên cố định cho các ngôn ngữ có từ trước W2 (giữ dữ liệu cũ). Ngôn ngữ khác lấy từ extractor của graphify.
LANGUAGE_BY_EXT = {
    ".dart": "dart", ".py": "python",
    ".ts": "typescript", ".tsx": "typescript", ".mts": "typescript", ".cts": "typescript",
    ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".cs": "csharp", ".cshtml": "csharp", ".razor": "csharp",
    ".go": "go", ".java": "java",  # mức chung (spec §6.3 kịch bản 3): cấu trúc và lời gọi cùng tệp của extractor gốc
}
FULL_SUPPORT = frozenset({"dart", "python", "typescript", "javascript", "csharp"})
# Tài liệu và media chỉ vào graph khi người dùng bật trong Tuỳ chọn index (F10 mục 6a).
DOC_LANGUAGE_BY_EXT = {".md": "markdown", ".mdx": "markdown", ".qmd": "markdown", ".skill": "markdown",
                       ".txt": "text", ".rst": "text", ".j2": "text", ".jinja": "text", ".jinja2": "text",
                       ".html": "html", ".htm": "html", ".docx": "docx", ".xlsx": "xlsx", ".pdf": "pdf"}
MEDIA_EXTS = frozenset({".mp3", ".wav", ".m4a", ".ogg", ".mp4", ".mov", ".webm", ".mkv"})
IMAGE_EXTS = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"})  # nút tệp; nội dung chỉ có khi chạy AI (W9)
# Lối tắt Google Workspace: vào graph khi bật "Tài liệu" và máy có `gws` (W6); chữ được xuất và cache như bản chép lời.
GOOGLE_WORKSPACE_EXTS = frozenset({".gdoc", ".gsheet", ".gslides"})
DOC_LANGUAGES = frozenset({*DOC_LANGUAGE_BY_EXT.values(), "media", "image", "google_workspace"})
# JSON chỉ là code khi là cấu hình/manifest: JSON dữ liệu (fixture, dataset) làm phình đồ thị (graphify #1224).
_CONFIG_JSON_PREFIXES = ("tsconfig", "jsconfig")
# Tệp cấu hình chỉ vào graph khi bật "Tệp cấu hình" trong Tuỳ chọn index (W2), để index mặc định giữ nguyên kết quả.
CONFIG_LANGUAGES = frozenset({"json", "yaml", "package_manifest", "mcp_config"})
MAX_MEDIA_BYTES = 500_000_000
_TEST_DIRS = frozenset({"test", "tests", "__tests__", "integration_test"})
_TEST_SUFFIXES = ("_test.dart", "_test.py", ".test.ts", ".spec.ts", ".test.tsx", ".spec.tsx",
                  ".test.js", ".spec.js", "_test.go", "Test.java", "Tests.java", "Test.cs", "Tests.cs",
                  "_spec.rb", "_test.rb", "Test.kt", "Tests.kt", "_test.rs", "Test.php", "Tests.swift")


@dataclass(frozen=True)
class DiscoveredFile:
    rel_path: str
    language: str
    size: int
    mtime: int
    is_test: bool
    oversized: bool
    path: str | None = None  # đường dẫn thật khi tệp thuộc gốc phụ `sources/` (nằm ngoài dự án)

    def location(self, root: Path) -> Path:
        return Path(self.path) if self.path else Path(root) / self.rel_path


def language_of(rel_path: str, root: Path | None = None, language_map: dict[str, str] | None = None) -> str | None:
    """Ngôn ngữ code của tệp, None nếu không phải code. `root` cho phép graphify đọc đầu tệp để phân biệt (.h, .m)."""
    ext = os.path.splitext(rel_path)[1].lower()
    if language_map and ext in language_map:
        return language_map[ext]
    if ext in LANGUAGE_BY_EXT:
        return LANGUAGE_BY_EXT[ext]
    name = rel_path.rsplit("/", 1)[-1]
    if ext in _GRAPHIFY_DOC_EXTS or ext in IMAGE_EXTS or ext in MEDIA_EXTS:
        return None
    if ext == ".json" and not _is_config_json_name(name):
        return None
    path = Path(root) / rel_path if root is not None else Path(rel_path)
    try:
        extractor = _get_extractor(path, sniff_headers=root is not None)
    except OSError:
        return None
    return extractor.__name__.removeprefix("extract_") if extractor is not None else None


def _is_config_json_name(name: str) -> bool:
    low = name.lower()
    if "lock" in low:
        return False
    return low in _CONFIG_JSON_NAMES or low.startswith(_CONFIG_JSON_PREFIXES) or low.endswith("mcp.json")


def is_test_path(rel_path: str) -> bool:
    parts = rel_path.split("/")
    name = parts[-1]
    return (bool(_TEST_DIRS & set(parts[:-1])) or name.endswith(_TEST_SUFFIXES)
            or (name.startswith("test_") and name.endswith((".py", ".sh"))))


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _load_ignore(directory: Path) -> pathspec.PathSpec | None:
    gi = directory / ".gitignore"
    try:
        lines = gi.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return None
    return pathspec.PathSpec.from_lines("gitignore", lines)


def _any_pattern(spec: pathspec.PathSpec) -> re.Pattern | None:
    """Một regex gộp mọi mẫu của tệp .gitignore. Không khớp regex này thì không mẫu nào khớp, nên chắc chắn
    không bị bỏ qua; có khớp mới hỏi pathspec (mẫu phủ định `!` cần đúng thứ tự). Phần lớn tệp không khớp gì:
    quét 17.000 tệp với .gitignore 340 dòng nhanh hơn khoảng ba lần."""
    parts = [p.regex.pattern for p in spec.patterns if getattr(p, "regex", None) is not None]
    try:
        return re.compile("|".join(f"(?:{x})" for x in parts)) if parts else None
    except re.error:  # nhóm đặt tên trùng nhau ở bản pathspec khác: dùng đường chậm
        return None


Rule = tuple[str, pathspec.PathSpec, "re.Pattern | None"]  # (thư mục chứa .gitignore, mẫu, regex gộp)


def _ignored(rel: str, rules: list[Rule]) -> bool:
    for base, spec, quick in rules:
        sub = rel[len(base) + 1:] if base else rel
        if quick is not None and not quick.search(sub):
            continue
        if spec.match_file(sub):
            return True
    return False


def _language(root: Path, rel: str, include_docs: bool, include_media: bool,
              language_map: dict[str, str] | None, include_config: bool = False) -> str | None:
    ext = os.path.splitext(rel)[1].lower()
    if include_docs and ext in DOC_LANGUAGE_BY_EXT and not (language_map and ext in language_map):
        return DOC_LANGUAGE_BY_EXT[ext]
    if include_docs and ext in GOOGLE_WORKSPACE_EXTS:
        return "google_workspace" if _media.has_gws() else None
    if include_media and ext in MEDIA_EXTS:
        return "media"
    if include_media and ext in IMAGE_EXTS:
        return "image"
    language = language_of(rel, root, language_map)
    if language in CONFIG_LANGUAGES and not include_config:
        return None
    return language


def discover(root: Path, *, max_file_bytes: int = 2_000_000, subdir: str | None = None,
             exclude: list[str] | None = None, include_docs: bool = False,
             include_media: bool = False, language_map: dict[str, str] | None = None,
             include_config: bool = False, sources_dir: Path | None = None) -> Iterator[DiscoveredFile]:
    """`sources_dir`: nguồn tải từ URL (`<data_dir>/sources/<pid>/`), vào graph dưới dạng `sources/<tên>`."""
    root = Path(root)
    found: list[DiscoveredFile] = []
    # `.graphifyrc` của dự án (language.inc = php): graphify áp cùng ánh xạ này khi extract() nên hai bên khớp nhau.
    rc_map = {ext: language_of("x" + target) for ext, target in activate_language_overrides(root).items()}
    language_map = {**{k: v for k, v in rc_map.items() if v}, **(language_map or {})}
    # Mẫu người dùng chọn (kiểu .gitignore, tính từ gốc project) áp như một .gitignore ở gốc.
    base_rules: list[Rule] = []
    if exclude:
        user_spec = pathspec.PathSpec.from_lines("gitignore", exclude)
        base_rules = [("", user_spec, _any_pattern(user_spec))]

    def inside(rel_dir: str) -> bool:
        return subdir is None or rel_dir == subdir or rel_dir.startswith(subdir + "/")

    def on_path_to_subdir(rel_dir: str) -> bool:
        return subdir is not None and subdir.startswith(rel_dir + "/")

    def walk(directory: Path, rel_dir: str, rules: list[Rule]) -> None:
        spec = _load_ignore(directory)
        if spec is not None:
            rules = [*rules, (rel_dir, spec, _any_pattern(spec))]
        try:
            entries = sorted(os.scandir(directory), key=lambda e: e.name)
        except OSError:
            return
        for entry in entries:
            if entry.is_symlink() or "\\" in entry.name:
                continue  # không theo symlink (tránh vòng lặp và đọc ngoài project); tên có \ vi phạm RB3
            rel = f"{rel_dir}/{entry.name}" if rel_dir else entry.name
            if entry.is_dir(follow_symlinks=False):
                selected = subdir is not None and (inside(rel) or on_path_to_subdir(rel))
                if entry.name in ALWAYS_SKIP_DIRS:
                    continue
                if not selected and (entry.name in SKIP_DIRS or entry.name.startswith(".")):
                    continue  # mặc định bỏ dist/__pycache__/.venv và thư mục ẩn, trừ nhánh người dùng đã chọn
                if _ignored(rel + "/", rules):
                    continue
                if subdir is None or selected:  # chỉ đi xuống nhánh dẫn tới thư mục con
                    walk(Path(entry.path), rel, rules)
            elif entry.is_file(follow_symlinks=False):
                language = _language(root, rel, include_docs, include_media, language_map, include_config)
                if (not inside(rel_dir) or language is None or entry.name.endswith(GENERATED_SUFFIXES)
                        or entry.name.lower().endswith(MINIFIED_SUFFIXES) or _ignored(rel, rules)):
                    continue
                st = entry.stat(follow_symlinks=False)
                doc = language in DOC_LANGUAGES
                cap = MAX_MEDIA_BYTES if language == "media" else max_file_bytes
                found.append(DiscoveredFile(rel, language, st.st_size, int(st.st_mtime),
                                            not doc and is_test_path(rel), st.st_size > cap))

    walk(root, "", base_rules)
    if sources_dir is not None:
        found += _discover_sources(Path(sources_dir), root, base_rules, max_file_bytes)
    yield from sorted(found, key=lambda f: f.rel_path)


SOURCES_PREFIX = "sources/"


def flat_name(name: str) -> bool:
    """Tên tệp phẳng an toàn trong thư mục nguồn: không ẩn, không có dấu phân cách, ổ đĩa Windows hay `:` (ADS)."""
    return bool(name) and not name.startswith(".") and not any(c in name for c in "/\\:") \
        and not PureWindowsPath(name).drive


def source_path(root: Path, rel: str, sources_dir: Path | None) -> Path | None:
    """Đường dẫn thật của `sources/<tên>` thuộc gốc phụ; None nếu tệp thuộc dự án hoặc không có gốc phụ."""
    name = rel.removeprefix(SOURCES_PREFIX)
    if (sources_dir is None or name == rel or not flat_name(name) or os.path.lexists(Path(root) / rel)):
        return None
    return Path(sources_dir) / name


def _discover_sources(directory: Path, root: Path, rules: list[Rule], max_file_bytes: int) -> list[DiscoveredFile]:
    """Gốc phụ phẳng: người dùng đã chủ động thêm nên luôn nhận tài liệu/ảnh/media, bỏ qua phạm vi thư mục con.
    Đường dẫn trùng một mục có thật trong dự án thì dự án được ưu tiên (cùng quy tắc với `source_path`)."""
    try:
        entries = sorted(os.scandir(directory), key=lambda e: e.name)
    except OSError:
        return []
    out = []
    for entry in entries:
        rel = SOURCES_PREFIX + entry.name
        if (entry.name.startswith(".") or "\\" in entry.name or os.path.lexists(root / rel)
                or not entry.is_file(follow_symlinks=False) or _ignored(rel, rules)):
            continue
        language = _language(directory, entry.name, True, True, None)
        if language not in DOC_LANGUAGES:
            continue
        st = entry.stat(follow_symlinks=False)
        cap = MAX_MEDIA_BYTES if language == "media" else max_file_bytes
        out.append(DiscoveredFile(rel, language, st.st_size, int(st.st_mtime), False, st.st_size > cap,
                                  path=entry.path))
    return out


def is_batch_language(language: str) -> bool:
    """Ngôn ngữ mức chung có lời gọi liên tệp lấy từ extract() cả lô (W2): không phải 5 ngôn ngữ đầy đủ, tài liệu, cấu hình."""
    return language not in FULL_SUPPORT and language not in DOC_LANGUAGES and language not in CONFIG_LANGUAGES
