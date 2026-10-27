from pathlib import Path

import pytest

from nexgraph_engine.arch.builder import MAX_BLOCKS, UnknownBlock, build_view, files_of_block


def write(root: Path, rel: str, text: str) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


@pytest.fixture
def bookstore(copy_fixture, index_project):
    store, _, _ = index_project(copy_fixture("bookstore_app"))
    return store


def ids(view):
    return [b.id for b in view.blocks]


def link(view, a, b):
    return next((l for l in view.links if l.source == a and l.target == b), None)


def test_bookstore_root_blocks_and_test_arrow(bookstore):
    v = build_view(bookstore.conn)
    assert v.parent is None and set(ids(v)) == {"dir:lib", "dir:test"}
    assert {b.id: b.size for b in v.blocks} == {"dir:lib": 8, "dir:test": 1}
    assert all(b.kind == "directory" and b.drillable for b in v.blocks)
    t = link(v, "dir:test", "dir:lib")
    assert t is not None and t.count >= 1 and "IMPORTS" in t.types  # tệp test import mã trong lib
    assert link(v, "dir:lib", "dir:test") is None


def test_lib_level_blocks(bookstore):
    v = build_view(bookstore.conn, "dir:lib")
    assert v.parent == ("dir:lib", "lib")
    assert set(ids(v)) == {"dir:lib/models", "dir:lib/screens", "dir:lib/services", "dir:lib/widgets",
                           "file:lib/main.dart", "file:lib/router.dart", "file:lib/broken.dart"}
    file_block = next(b for b in v.blocks if b.id == "file:lib/main.dart")
    assert file_block.kind == "file" and file_block.drillable is False and file_block.size == 1
    services = next(b for b in v.blocks if b.id == "dir:lib/services")
    assert services.size == 2 and services.symbols >= 4 and services.label == "services"


def test_links_only_where_real_edges_exist(bookstore):
    v = build_view(bookstore.conn, "dir:lib")
    ss = link(v, "dir:lib/screens", "dir:lib/services")
    assert ss is not None and ss.count >= 2 and {"IMPORTS", "CALLS"} <= set(ss.types)
    assert link(v, "dir:lib/services", "dir:lib/models") is not None   # auth_service import và dựng User
    assert link(v, "dir:lib/models", "dir:lib/screens") is None         # không có cạnh thật thì không có mũi tên
    assert link(v, "dir:lib/models", "dir:lib/services") is None        # chiều ngược lại cũng không
    assert all(l.source != l.target for l in v.links)
    assert all(l.count == sum(l.types.values()) and l.count >= 1 for l in v.links)
    assert {t for l in v.links for t in l.types} <= {"IMPORTS", "CALLS"}


def test_drill_into_directory(bookstore):
    v = build_view(bookstore.conn, "dir:lib/services")
    assert v.parent == ("dir:lib/services", "services")
    assert set(ids(v)) == {"file:lib/services/api_client.dart", "file:lib/services/auth_service.dart"}
    l = link(v, "file:lib/services/auth_service.dart", "file:lib/services/api_client.dart")
    assert l is not None and l.types["IMPORTS"] == 1 and l.types["CALLS"] == 2  # hai lời gọi post
    assert link(v, "file:lib/services/api_client.dart", "file:lib/services/auth_service.dart") is None


def test_flat_directory_uses_communities_and_stays_under_limit(tmp_path, index_project):
    root = tmp_path / "proj"
    for g in "ABC":                                   # 3 nhóm 10 tệp import chặt nhau, đặt phẳng trong lib/
        names = [f"{g.lower()}{i}" for i in range(10)]
        for n in names:
            write(root, f"lib/{n}.dart", "".join(f"import '{m}.dart';\n" for m in names if m != n) + f"class {n.upper()} {{}}\n")
    store, _, _ = index_project(root)
    v = build_view(store.conn)
    assert len(v.blocks) <= MAX_BLOCKS and any(b.kind == "community" for b in v.blocks)
    assert sum(b.size for b in v.blocks) == 30
    com = next(b for b in v.blocks if b.kind == "community")
    inner = build_view(store.conn, com.id)
    assert inner.parent[0] == com.id and all(b.kind == "file" for b in inner.blocks)


def test_many_subdirs_merge_into_group(tmp_path, index_project):
    root = tmp_path / "proj"
    for d in range(20):
        for f in range(2):
            write(root, f"lib/d{d:02d}/f{f}.dart", f"class C{d}_{f} {{}}\n")
    store, _, _ = index_project(root)
    v = build_view(store.conn)
    assert len(v.blocks) == MAX_BLOCKS
    group = v.blocks[-1]
    assert group.kind == "group" and group.label == "Khác (9 mục)" and group.id == "more:" and group.size == 18
    assert sum(b.size for b in v.blocks) == 40
    inner = build_view(store.conn, group.id)
    assert len(inner.blocks) == 9 and inner.parent == ("more:", "Khác (9 mục)")
    assert sum(b.size for b in inner.blocks) == 18


def test_group_of_group(tmp_path, index_project):
    root = tmp_path / "proj"
    for d in range(30):
        write(root, f"lib/d{d:02d}/f.dart", f"class C{d} {{}}\n")
    store, _, _ = index_project(root)
    v = build_view(store.conn)
    g1 = v.blocks[-1]
    inner = build_view(store.conn, g1.id)
    assert len(inner.blocks) == MAX_BLOCKS and inner.blocks[-1].id == f"more:{g1.id}"
    assert sum(b.size for b in inner.blocks) == 19
    assert len(build_view(store.conn, inner.blocks[-1].id).blocks) == 8


def test_sizes_are_conserved(bookstore, copy_fixture):
    def check(view, parent_files):
        assert sum(b.size for b in view.blocks) == len(parent_files)
        for b in view.blocks:
            assert sorted(files_of_block(bookstore.conn, b.id)) and len(files_of_block(bookstore.conn, b.id)) == b.size
            if b.drillable:
                check(build_view(bookstore.conn, b.id), files_of_block(bookstore.conn, b.id))
    all_files = [r[0] for r in bookstore.conn.execute("SELECT duong_dan_tuong_doi FROM tep")]
    check(build_view(bookstore.conn), all_files)


def test_empty_and_single_file_projects(tmp_path, index_project):
    empty = tmp_path / "empty"
    empty.mkdir()
    store, _, _ = index_project(empty)
    v = build_view(store.conn)
    assert v.blocks == [] and v.links == [] and v.parent is None
    one = tmp_path / "one"
    write(one, "lib/a.dart", "class A {}\n")
    store2, _, _ = index_project(one)
    v2 = build_view(store2.conn)
    assert [b.id for b in v2.blocks] == ["file:lib/a.dart"] and v2.links == []


def test_unknown_block_raises(bookstore):
    for bad in ("dir:nope", "zzz:1", "com:99999", "com:abc", "more:", "more:dir:lib", "dir:", "file:nope.dart"):
        with pytest.raises(UnknownBlock):
            build_view(bookstore.conn, bad)
        with pytest.raises(UnknownBlock):
            files_of_block(bookstore.conn, bad)
    with pytest.raises(UnknownBlock):
        build_view(bookstore.conn, "file:lib/main.dart")  # khối tệp không đi sâu được
    assert files_of_block(bookstore.conn, "file:lib/main.dart") == ["lib/main.dart"]


def test_unicode_and_spaces_in_block_ids(tmp_path, index_project):
    root = tmp_path / "proj"
    write(root, "lib/màn hình/a.dart", "class A {}\n")
    write(root, "lib/màn hình/b.dart", "import 'a.dart';\nclass B {}\n")
    write(root, "lib/other/c.dart", "class C {}\n")
    store, _, _ = index_project(root)
    v = build_view(store.conn, "dir:lib/màn hình")
    assert {b.id for b in v.blocks} == {"file:lib/màn hình/a.dart", "file:lib/màn hình/b.dart"}
    assert v.links and v.links[0].types == {"IMPORTS": 1}


def test_deterministic_ordering(bookstore):
    assert build_view(bookstore.conn, "dir:lib") == build_view(bookstore.conn, "dir:lib")
