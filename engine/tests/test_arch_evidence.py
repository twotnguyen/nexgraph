from pathlib import Path

import pytest

from nexgraph_engine.arch.builder import UnknownBlock, build_view
from nexgraph_engine.arch.evidence import evidence_between


def write(root: Path, rel: str, text: str) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


@pytest.fixture
def bookstore(copy_fixture, index_project):
    root = copy_fixture("bookstore_app")
    store, _, _ = index_project(root)
    return store, root


def test_evidence_matches_link_count(bookstore):
    store, root = bookstore
    checked = 0
    for parent in (None, "dir:lib", "dir:lib/services"):
        for l in build_view(store.conn, parent).links:
            ev = evidence_between(store.conn, l.source, l.target, limit=200)
            assert len(ev) == l.count
            for se in ev:
                assert se.file and se.edge.line >= 1
                assert se.edge.line <= len((root / se.file).read_text(encoding="utf-8").splitlines())
                assert se.edge.type.value in ("IMPORTS", "CALLS")
            checked += 1
    assert checked >= 5


def test_evidence_is_ordered_and_limited(bookstore):
    store, _ = bookstore
    full = evidence_between(store.conn, "dir:lib/screens", "dir:lib/services", limit=200)
    assert len(full) >= 2
    keys = [(se.file, se.edge.line, se.id) for se in full]
    assert keys == sorted(keys)
    one = evidence_between(store.conn, "dir:lib/screens", "dir:lib/services", limit=1)
    assert [se.id for se in one] == [full[0].id]
    assert [se.id for se in evidence_between(store.conn, "dir:lib/screens", "dir:lib/services", limit=200)] == [se.id for se in full]


def test_evidence_between_group_block(tmp_path, index_project):
    root = tmp_path / "proj"
    imports = {0: "../d15/f.dart", 16: "../d17/f.dart"}   # d15, d16, d17 nằm trong khối gộp (d11..d19)
    for d in range(20):
        head = f"import '{imports[d]}';\n" if d in imports else ""
        write(root, f"lib/d{d:02d}/f.dart", head + f"class C{d} {{}}\n")
        write(root, f"lib/d{d:02d}/h.dart", f"class H{d} {{}}\n")     # mọi thư mục có 2 tệp nên thứ tự theo nhãn
    store, _, _ = index_project(root)
    v = build_view(store.conn)
    group = v.blocks[-1]
    assert group.kind == "group"
    ev = evidence_between(store.conn, "dir:lib/d00", group.id)
    assert [(se.file, se.edge.target) for se in ev] == [("lib/d00/f.dart", "lib/d15/f.dart#file")]
    assert [l.count for l in v.links if l.source == "dir:lib/d00" and l.target == group.id] == [1]
    # liên kết nội bộ trong khối gộp hiện ra khi đi sâu
    inner = build_view(store.conn, group.id)
    assert any(l.source == "dir:lib/d16" and l.target == "dir:lib/d17" for l in inner.links)


def test_unknown_blocks_raise(bookstore):
    store, _ = bookstore
    with pytest.raises(UnknownBlock):
        evidence_between(store.conn, "dir:nope", "dir:lib")
    with pytest.raises(UnknownBlock):
        evidence_between(store.conn, "dir:lib", "zzz:1")
    assert evidence_between(store.conn, "dir:lib/models", "dir:lib/screens") == []
