"""`#include "..."` của C/C++ thành cạnh IMPORTS như graphify 0.9.112 (lỗi W12 tìm ra)."""
import threading
from pathlib import Path

import pytest

from nexgraph_engine.index.indexer import Indexer
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.store.graph_store import GraphStore

POLYGLOT = Path(__file__).parent / "fixtures" / "polyglot"

FILES = {
    "c/main.c": '#include "util.h"\n#include "sub/deep.h"\n#include <stdio.h>\n#include "api.h"\n'
                '#include "config.h"\nint main(void) { return util(1) + deep(); }\n',
    "c/util.h": "int util(int x);\n",
    "c/sub/deep.h": "int deep(void);\n",
    "include/api.h": "int api(void);\n",  # chỉ thấy qua -I: khớp theo tên tệp duy nhất trong dự án
    "a/config.h": "#define A 1\n",
    "b/config.h": "#define B 1\n",  # hai tệp cùng tên: không đoán
    "cpp/main.cpp": '#include "util.hpp"\n#include "../c/util.h"\n#include <vector>\n'
                    "int main() { return helper(1); }\n",
    "cpp/util.hpp": "int helper(int x);\n",
    "cpp/util.cpp": '#include "util.hpp"\nint helper(int x) { return x + 1; }\n',
    # `#include <...>`: chỉ nối khi đúng một tệp trong dự án khớp theo đoạn đường dẫn
    "angle/main.c": "#include <c/util.h>\n#include <stdio.h>\n#include <vector>\n#include <boost/asio.hpp>\n"
                    "int main(void) { return 0; }\n",
    "near/main.c": "#include <util.h>\n",
    "a/deep/main.c": "#include <config.h>\n",  # a/config.h gần hơn b/config.h → chọn a/config.h
}


def _index(root: Path, tmp: Path):
    store = GraphStore(open_graph_db(tmp / "g.db"))
    store.init_project("p", has_git=False)
    assert Indexer(store, root, on_progress=lambda e: None, cancel=threading.Event()).run().state == "hoan_tat"
    edges = {tuple(r) for r in store.conn.execute(
        "SELECT a.id_nut, b.id_nut FROM canh c JOIN nut a ON a.ma_nut = c.ma_nut_nguon"
        " JOIN nut b ON b.ma_nut = c.ma_nut_dich WHERE c.loai_canh = 'IMPORTS'")}
    failed = [tuple(r) for r in store.conn.execute(
        "SELECT n.id_nut, t.ten_tham_chieu FROM tham_chieu_chua_phan_giai t JOIN nut n ON n.ma_nut = t.ma_nut_nguon"
        " WHERE loai_tham_chieu = 'IMPORTS' AND trang_thai = 'that_bai'")]
    return edges, failed


@pytest.fixture(scope="module")
def c_project(tmp_path_factory):
    root = tmp_path_factory.mktemp("src")
    for rel, text in FILES.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(text)
    return _index(root, tmp_path_factory.mktemp("db"))


@pytest.mark.parametrize("src,dst", [
    ("c/main.c", "c/util.h"),            # cùng thư mục
    ("c/main.c", "c/sub/deep.h"),        # thư mục con
    ("c/main.c", "include/api.h"),       # tên tệp duy nhất trong dự án
    ("cpp/main.cpp", "cpp/util.hpp"),
    ("cpp/main.cpp", "c/util.h"),        # đường dẫn `..`
    ("cpp/util.cpp", "cpp/util.hpp"),    # cùng tên gốc với tệp nguồn
])
def test_quoted_include_becomes_imports_edge(c_project, src, dst):
    edges, _ = c_project
    assert (f"{src}#file", f"{dst}#file") in edges


def test_system_and_ambiguous_includes_make_no_edge(c_project):
    edges, failed = c_project
    targets = {t for s, t in edges if s == "c/main.c#file"}
    assert not any("config.h" in t for t in targets)
    assert targets == {"c/util.h#file", "c/sub/deep.h#file", "include/api.h#file"}
    assert {t for s, t in edges if s == "cpp/main.cpp#file"} == {"cpp/util.hpp#file", "c/util.h#file"}
    assert ("c/main.c#file", "config.h") in failed


def test_polyglot_cpp_matches_graphify(tmp_path):
    edges, failed = _index(POLYGLOT, tmp_path)
    assert {("cpp/main.cpp#file", "cpp/util.h#file"), ("cpp/util.cpp#file", "cpp/util.h#file")} <= edges
    assert not [f for f in failed if f[0].startswith("cpp/")]


@pytest.mark.parametrize("src,dst", [
    ("angle/main.c", "c/util.h"),       # đúng một tệp có đường dẫn kết thúc bằng `c/util.h`
    ("near/main.c", "c/util.h"),        # `util.h` chỉ có một tệp trong dự án
    ("a/deep/main.c", "a/config.h"),    # hai ứng viên: thư mục gần tệp đang include quyết định
])
def test_angle_include_becomes_imports_edge(c_project, src, dst):
    edges, _ = c_project
    assert (f"{src}#file", f"{dst}#file") in edges


def test_angle_system_headers_make_no_edge(c_project):
    edges, failed = c_project
    assert {t for s, t in edges if s == "angle/main.c#file"} == {"c/util.h#file"}
    assert {("angle/main.c#file", n) for n in ("<stdio.h>", "<vector>", "<boost/asio.hpp>")} <= set(failed)


def test_angle_include_is_never_resolved_relative_to_the_source(c_project):
    """`<c/util.h>` không được hiểu là `angle/c/util.h`; chỉ khớp theo đoạn đường dẫn trong dự án."""
    edges, _ = c_project
    assert not [t for s, t in edges if s == "angle/main.c#file" and t.startswith("angle/")]
