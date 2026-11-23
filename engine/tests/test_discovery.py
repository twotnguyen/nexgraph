import os
import sys
import time
from pathlib import Path

import pytest

from nexgraph_engine.index.discovery import discover, is_test_path, language_of, sha256_file


def write(root: Path, rel: str, text: str = "void main() {}\n") -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def rels(root: Path, **kw) -> list[str]:
    return [f.rel_path for f in discover(root, **kw)]


def test_skips_ignored_and_generated(tmp_path):
    for rel in ("build/x.dart", ".dart_tool/y.dart", ".nexgraph/z.dart", "node_modules/m.js", ".git/h.dart",
                "lib/a.g.dart", "lib/b.freezed.dart", "lib/c_generated.dart", "lib/d.pb.dart", "lib/keep.dart"):
        write(tmp_path, rel)
    assert rels(tmp_path) == ["lib/keep.dart"]


def test_respects_gitignore_root_and_nested(tmp_path):
    write(tmp_path, ".gitignore", "secret/\n")
    write(tmp_path, "secret/s.dart")
    write(tmp_path, "lib/.gitignore", "*.tmp.dart\n")
    write(tmp_path, "lib/x.tmp.dart")
    write(tmp_path, "lib/keep.dart")
    write(tmp_path, "other/x.tmp.dart")  # luật của lib/ không áp dụng ngoài lib/
    assert rels(tmp_path) == ["lib/keep.dart", "other/x.tmp.dart"]


def test_nexgraph_dir_ignored(tmp_path):
    write(tmp_path, ".nexgraph/graph.db", "binary")
    write(tmp_path, ".nexgraph/nested/a.dart")
    write(tmp_path, "lib/a.dart")
    assert rels(tmp_path) == ["lib/a.dart"]


def test_symlink_loop_terminates(tmp_path):
    write(tmp_path, "lib/a.dart")
    try:
        os.symlink(tmp_path, tmp_path / "lib" / "loop", target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("không tạo được symlink")
    start = time.time()
    assert rels(tmp_path) == ["lib/a.dart"]
    assert time.time() - start < 5


def test_symlink_outside_not_followed(tmp_path):
    outside = tmp_path / "outside"
    write(outside, "secret.dart")
    root = tmp_path / "proj"
    write(root, "lib/a.dart")
    try:
        os.symlink(outside / "secret.dart", root / "lib" / "leak.dart")
        os.symlink(outside, root / "lib" / "dir", target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("không tạo được symlink")
    assert rels(root) == ["lib/a.dart"]


def test_oversized_flagged(tmp_path):
    write(tmp_path, "lib/big.dart", "a" * 3_000_000)
    write(tmp_path, "lib/small.dart")
    by = {f.rel_path: f for f in discover(tmp_path)}
    assert by["lib/big.dart"].oversized is True and by["lib/small.dart"].oversized is False


def test_rel_path_forward_slash_unicode_and_metadata(tmp_path):
    write(tmp_path, "lib/screens/màn_hình.dart", "abc")
    (f,) = list(discover(tmp_path))
    assert f.rel_path == "lib/screens/màn_hình.dart" and "\\" not in f.rel_path
    assert f.language == "dart" and f.size == 3 and f.mtime > 0 and f.is_test is False


@pytest.mark.skipif(sys.platform == "win32", reason="Windows không cho dấu \\ trong tên tệp")
def test_backslash_in_name_skipped(tmp_path):
    write(tmp_path, "lib/we\\ird.dart")
    write(tmp_path, "lib/ok.dart")
    assert rels(tmp_path) == ["lib/ok.dart"]


def test_languages_and_unknown_extensions(tmp_path):
    for rel in ("a.dart", "a.py", "a.ts", "a.tsx", "a.js", "a.cs", "a.cshtml", "a.json", "a.md", "a.sql", "a.png"):
        write(tmp_path, rel)
    got = {f.rel_path: f.language for f in discover(tmp_path)}
    assert got == {"a.dart": "dart", "a.py": "python", "a.ts": "typescript", "a.tsx": "typescript",
                   "a.js": "javascript", "a.cs": "csharp", "a.cshtml": "csharp", "a.sql": "sql"}
    assert language_of("x/y.md") is None


@pytest.mark.parametrize("rel,expected", [
    ("test/a_test.dart", True), ("integration_test/x.dart", True), ("lib/a_test.dart", True),
    ("lib/a.dart", False), ("tests/test_x.py", True), ("pkg/test_x.py", True), ("src/a.test.ts", True),
    ("src/a.spec.ts", True), ("src/__tests__/a.ts", True), ("src/latest.dart", False),
])
def test_is_test_path(rel, expected):
    assert is_test_path(rel) is expected


def test_sha256(tmp_path):
    write(tmp_path, "a.dart", "hello")
    assert sha256_file(tmp_path / "a.dart") == "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"


def test_subdir_keeps_rel_paths_from_root(tmp_path):
    write(tmp_path, "lib/a.dart")
    write(tmp_path, "lib/sub/b.dart")
    write(tmp_path, "test/t_test.dart")
    write(tmp_path, "main.dart")
    assert rels(tmp_path, subdir="lib") == ["lib/a.dart", "lib/sub/b.dart"]
    assert rels(tmp_path, subdir="lib/sub") == ["lib/sub/b.dart"]
    assert rels(tmp_path, subdir="nope") == []


def test_parent_gitignore_applies_to_subdir(tmp_path):
    write(tmp_path, ".gitignore", "lib/generated/\n*.skip.dart\n")
    write(tmp_path, "lib/generated/g.dart")
    write(tmp_path, "lib/x.skip.dart")
    write(tmp_path, "lib/keep.dart")
    assert rels(tmp_path, subdir="lib") == ["lib/keep.dart"]


def test_every_graphify_language_is_discovered(tmp_path):
    # W2: ngôn ngữ lấy từ extractor của graphify; 7 ngôn ngữ cũ giữ tên cũ.
    expected = {"a.rs": "rust", "a.go": "go", "a.java": "java", "a.kt": "kotlin", "a.rb": "ruby", "a.php": "php",
                "a.swift": "swift", "a.cpp": "cpp", "a.h": "c", "a.sql": "sql", "a.tf": "terraform", "a.sh": "bash",
                "a.vue": "vue", "a.ex": "elixir", "a.r": "r", "a.erl": "erlang", "a.sol": "solidity",
                "a.vb": "vbnet", "a.pas": "pascal", "a.jl": "julia", "a.ps1": "powershell", "a.yaml": "yaml",
                "package.json": "json", "pyproject.toml": "package_manifest", "a.py": "python", "a.cs": "csharp"}
    for rel in expected:
        write(tmp_path, rel)
    got = {f.rel_path: f.language for f in discover(tmp_path, include_config=True)}
    assert got == expected
    config = {"a.yaml", "package.json", "pyproject.toml"}
    assert {f.rel_path for f in discover(tmp_path)} == set(expected) - config  # mặc định không có tệp cấu hình


def test_data_json_and_lockfiles_are_not_indexed(tmp_path):
    for rel in ("data.json", "fixtures/users.json", "package-lock.json", "package.json", "tsconfig.base.json"):
        write(tmp_path, rel)
    assert sorted(f.rel_path for f in discover(tmp_path, include_config=True)) == ["package.json", "tsconfig.base.json"]


def test_language_map_overrides_extension(tmp_path):
    write(tmp_path, "lib/a.inc")
    assert [f.language for f in discover(tmp_path)] == ["pascal"]
    assert [f.language for f in discover(tmp_path, language_map={".inc": "php"})] == ["php"]
    assert language_of("lib/a.inc", language_map={".inc": "php"}) == "php"


def test_new_doc_and_image_types(tmp_path):
    for rel in ("a.html", "a.qmd", "a.j2", "a.skill", "a.png", "a.svg"):
        write(tmp_path, rel)
    assert {f.rel_path: f.language for f in discover(tmp_path)} == {}
    got = {f.rel_path: f.language for f in discover(tmp_path, include_docs=True, include_media=True)}
    assert got == {"a.html": "html", "a.qmd": "markdown", "a.j2": "text", "a.skill": "markdown",
                   "a.png": "image", "a.svg": "image"}


@pytest.mark.parametrize("rel", ["pkg/a_test.go", "src/FooTest.java", "Foo.Tests/BarTests.cs", "spec/a_spec.rb",
                                 "src/FooTest.kt", "tests/a_test.rs", "test_a.sh"])
def test_is_test_path_other_languages(rel):
    assert is_test_path(rel) is True


def test_graphifyrc_language_overrides_are_honoured(tmp_path):
    # Ánh xạ đuôi tệp theo `.graphifyrc` của dự án (graphify #2961); NexGraph chỉ đọc, không ghi tệp này.
    (tmp_path / ".graphifyrc").write_text("language.inc = php\n")
    (tmp_path / "a.inc").write_text("<?php\nfunction run() { return 1; }\n")
    assert [f.language for f in discover(tmp_path)] == ["php"]
    from nexgraph_engine.index.generic import extract_generic
    assert [n.label for n in extract_generic(tmp_path, "a.inc", "php", is_test=False).nodes] == ["run"]


def test_next_static_and_bundle_files_are_skipped(tmp_path):
    """Bundle Next.js băm tên lọt lưới E3 (#36) bị bỏ (PERF-L mục 3)."""
    for rel in ("plugins/site/_next/static/chunks/1098c2541054fc77.js",
                "plugins/site/_next/static/css/abc123.css",
                "lib/vendor.bundle.js", "lib/app.min.js", "lib/app.js"):
        write(tmp_path, rel)
    assert rels(tmp_path) == ["lib/app.js"]


def test_dense_js_and_css_files_are_skipped_by_bytes_per_line(tmp_path):
    """JS/CSS có byte/dòng > 500 bị bỏ; tệp lớn nhưng nhiều dòng và tệp nhỏ vẫn giữ (PERF-L mục 3)."""
    write(tmp_path, "lib/dense.js", "var x=" + ",".join("1" for _ in range(60_000)) + ";\n")  # ~180 KB, 1 dòng
    write(tmp_path, "lib/dense.css", ".a{color:#fff}" * 20_000 + "\n")                         # ~260 KB, 1 dòng
    write(tmp_path, "lib/normal.js", "".join(f"const v{i} = {i};\n" for i in range(10_000)))   # 140 KB, 10.000 dòng
    write(tmp_path, "lib/small.js", "var a=1;var b=2;\n" * 20)                                 # < 64 KB: không đoán
    write(tmp_path, "lib/long_line.py", 'x = "' + "a" * 400_000 + '"\n')                        # Python: không áp dụng
    assert rels(tmp_path) == ["lib/long_line.py", "lib/normal.js", "lib/small.js"]


def test_discover_reports_skipped_file_counts(tmp_path):
    """Số tệp bị bỏ theo lý do để kết quả job báo cho người dùng (PERF-L mục 3)."""
    write(tmp_path, "plugins/site/_next/static/chunks/a.js")
    write(tmp_path, "lib/x.bundle.js")
    write(tmp_path, "lib/dense.js", "var x=" + ",".join("1" for _ in range(60_000)) + ";\n")
    write(tmp_path, "lib/keep.js", "function a() {}\n")
    stats: dict[str, int] = {}
    assert [f.rel_path for f in discover(tmp_path, skip_stats=stats)] == ["lib/keep.js"]
    assert stats == {"bundle": 2, "dense": 1}


def test_explicitly_chosen_next_static_package_is_indexed(tmp_path):
    """Chọn rõ một package trong `_next/static` (monorepo) thì vẫn lập chỉ mục, như mọi thư mục bị bỏ khác."""
    write(tmp_path, "apps/site/_next/static/chunks/a.js")
    write(tmp_path, "apps/site/src/b.js")
    assert rels(tmp_path) == ["apps/site/src/b.js"]
    assert rels(tmp_path, subdir="apps/site/_next/static") == ["apps/site/_next/static/chunks/a.js"]


def test_skips_default_build_dependency_and_minified_paths(tmp_path):
    for rel in ("dist/app.js", "__pycache__/mod.py", ".venv/lib/x.py", "venv/lib/y.py",
                "lib/app.min.js", "lib/app.min.css", "lib/vendor.bundle.js", "lib/keep.js"):
        write(tmp_path, rel)
    assert rels(tmp_path) == ["lib/keep.js"]


def test_hidden_directories_are_skipped_by_default(tmp_path):
    for rel in (".github/workflows.py", ".config/tool/x.py", ".cache/y.py", "lib/keep.py"):
        write(tmp_path, rel)
    assert rels(tmp_path) == ["lib/keep.py"]
    # Người dùng chọn rõ thư mục ẩn thì vẫn lập chỉ mục được (monorepo chọn package).
    assert rels(tmp_path, subdir=".config") == [".config/tool/x.py"]


def test_user_selected_package_inside_a_default_skip_dir_is_indexed(tmp_path):
    write(tmp_path, "dist/pkg/a.py")
    write(tmp_path, "dist/other/b.py")
    write(tmp_path, "lib/c.py")
    assert rels(tmp_path) == ["lib/c.py"]
    assert rels(tmp_path, subdir="dist/pkg") == ["dist/pkg/a.py"]


def test_vendor_and_third_party_dirs_are_skipped_unless_chosen(tmp_path):
    for rel in ("vendor/lib/x.php", "third_party/y.js", "src/a.ts"):
        write(tmp_path, rel)
    assert rels(tmp_path) == ["src/a.ts"]
    assert rels(tmp_path, subdir="vendor/lib") == ["vendor/lib/x.php"]
