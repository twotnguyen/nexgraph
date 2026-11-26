import threading
from pathlib import Path

import pytest

import nexgraph_engine.pipeline.legacy_indexer as indexer_module
from nexgraph_engine.arch.communities import detect_communities, file_graph
from nexgraph_engine.pipeline.legacy_indexer import Indexer


def write(root: Path, rel: str, text: str) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def clique(root: Path, folder: str, names=("a", "b", "c")) -> None:
    """Ba tệp import chặt lẫn nhau trong một thư mục."""
    for i, n in enumerate(names):
        others = [m for m in names if m != n]
        write(root, f"{folder}/{n}.dart", "".join(f"import '{m}.dart';\n" for m in others) + f"class C{folder.replace('/', '_')}{n.upper()} {{}}\n")


def communities(store):
    return {c["name"]: c for c in store.communities()}


def test_two_clusters_found(tmp_path, index_project):
    root = tmp_path / "proj"
    clique(root, "lib/services")
    clique(root, "lib/ui")
    write(root, "lib/ui/a.dart", "import '../services/a.dart';\n" + (root / "lib/ui/a.dart").read_text(encoding="utf-8"))  # một cầu nối
    store, _, _ = index_project(root)
    got = store.communities()
    assert len(got) == 2
    by_name = {c["name"]: set(c["files"]) for c in got}
    assert by_name == {"services": {f"lib/services/{n}.dart" for n in "abc"}, "ui": {f"lib/ui/{n}.dart" for n in "abc"}}
    # nút ký hiệu mang cùng ma_khoi với tệp của nó
    kid = store.file_community("lib/services/a.dart")
    assert kid is not None
    rows = store.conn.execute("SELECT DISTINCT ma_khoi FROM nut n JOIN tep t USING (ma_tep) "
                              "WHERE t.duong_dan_tuong_doi = 'lib/services/a.dart'").fetchall()
    assert [r["ma_khoi"] for r in rows] == [kid]
    assert store.file_community("lib/ui/b.dart") != kid


def test_deterministic(tmp_path, index_project):
    root = tmp_path / "proj"
    clique(root, "lib/x")
    clique(root, "lib/y")
    store, _, _ = index_project(root)
    first = store.communities()
    assert detect_communities(store) == len(first)
    assert store.communities() == first


def test_cohesion_in_range_and_naming(tmp_path, index_project):
    root = tmp_path / "proj"
    clique(root, "lib/services")
    clique(root, "pkg/services")           # trùng tên thư mục -> hậu tố 2
    write(root, "lib/loose1.dart", "import 'loose2.dart';\nclass L1 {}\n")  # tệp rời không đủ lập cụm trong thư mục có cụm khác
    write(root, "lib/loose2.dart", "import 'loose1.dart';\nclass L2 {}\n")
    store, _, _ = index_project(root)
    got = store.communities()
    assert all(0.0 <= c["cohesion"] <= 1.0 for c in got)
    names = sorted(c["name"] for c in got)
    assert "services" in names and "services 2" in names


def test_community_that_is_part_of_a_directory_is_named_after_its_hub(tmp_path, index_project):
    root = tmp_path / "proj"
    clique(root, "lib", names=("a", "b", "c"))
    clique(root, "lib", names=("x", "y", "z"))   # hai cụm cùng nằm phẳng trong lib/
    store, _, _ = index_project(root)
    got = store.communities()
    assert len(got) == 2
    assert all(c["name"].startswith("Cụm quanh ") for c in got)


def test_no_links_no_communities(tmp_path, index_project):
    root = tmp_path / "proj"
    for i in range(5):
        write(root, f"lib/f{i}.dart", f"class F{i} {{}}\n")
    store, result, _ = index_project(root)
    assert result.state == "hoan_tat" and store.communities() == [] and detect_communities(store) == 0
    assert store.conn.execute("SELECT count(*) FROM khoi_kien_truc").fetchone()[0] == 0


@pytest.mark.parametrize("files", [0, 1])
def test_tiny_projects(tmp_path, index_project, files):
    root = tmp_path / "proj"
    root.mkdir()
    for i in range(files):
        write(root, f"lib/f{i}.dart", "class F {}\n")
    store, result, _ = index_project(root)
    assert result.state == "hoan_tat" and detect_communities(store) == 0
    assert file_graph(store.conn).number_of_nodes() == 0


def test_reindex_replaces_communities(tmp_path, index_project):
    root = tmp_path / "proj"
    clique(root, "lib/a")
    clique(root, "lib/b")
    store, _, _ = index_project(root)
    before = store.communities()
    Indexer(store, root, on_progress=lambda e: None, cancel=threading.Event()).run()
    assert store.communities() == before
    assert store.conn.execute("SELECT count(*) FROM khoi_kien_truc").fetchone()[0] == len(before)


def test_failure_does_not_fail_job(tmp_path, index_project, monkeypatch):
    root = tmp_path / "proj"
    clique(root, "lib/a")
    monkeypatch.setattr(indexer_module, "detect_communities", lambda store: (_ for _ in ()).throw(RuntimeError("boom")))
    events = []
    store, result, _ = index_project(root, on_event=events.append)
    assert result.state == "hoan_tat"
    assert any(e.message and "boom" in e.message for e in events)
