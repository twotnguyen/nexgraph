import shutil
import threading
from pathlib import Path

import pytest

from nexgraph_engine.pipeline.legacy_indexer import Indexer
from nexgraph_engine.core.schema.db import open_graph_db
from nexgraph_engine.core.schema.enums import EdgeType, NodeKind
from nexgraph_engine.storage.store.graph_store import GraphStore

FIX = Path(__file__).parents[1] / "fixtures" / "docs_app"


@pytest.fixture
def docs_root(tmp_path):
    root = tmp_path / "Đồ án" / "docs app"
    shutil.copytree(FIX, root)
    return root


def run_index(root: Path, db: Path, **flags) -> GraphStore:
    store = GraphStore(open_graph_db(db))
    store.init_project(root.name, has_git=False)
    result = Indexer(store, root, on_progress=lambda e: None, cancel=threading.Event(), **flags).run()
    assert result.state == "hoan_tat"
    return store


def nodes_of(store, kind):
    return {n.id: n for n in store.all_nodes() if n.kind == kind}


def edges(store, type_: EdgeType) -> dict[tuple[str, str], float]:
    rows = store.conn.execute(
        "SELECT a.id_nut AS s, b.id_nut AS t, c.diem_tin_cay AS score FROM canh c JOIN nut a ON a.ma_nut = c.ma_nut_nguon"
        " JOIN nut b ON b.ma_nut = c.ma_nut_dich WHERE c.loai_canh = ?", (type_.value,))
    return {(r["s"], r["t"]): r["score"] for r in rows}


def test_markdown_headings_become_document_nodes(docs_root, tmp_path):
    store = run_index(docs_root, tmp_path / "g.db", include_docs=True)
    docs = nodes_of(store, NodeKind.DOCUMENT)
    assert "README.md::Cài đặt#document" in docs
    assert "README.md::Cài đặt@13#document" in docs
    defines = edges(store, EdgeType.DEFINES)
    assert ("README.md#file", "README.md::Docs app#document") in defines
    assert ("README.md::Docs app#document", "README.md::Cài đặt#document") in defines


def test_heading_line_range(docs_root, tmp_path):
    store = run_index(docs_root, tmp_path / "g.db", include_docs=True)
    docs = nodes_of(store, NodeKind.DOCUMENT)
    assert (docs["README.md::Docs app#document"].line_start, docs["README.md::Docs app#document"].line_end) == (1, 4)
    assert docs["README.md::Cài đặt@13#document"].line_end == 15


def test_mentions_become_unresolved_documents_refs():
    from nexgraph_engine.indexing.docs.extract import extract_document
    x = extract_document("README.md", (FIX / "README.md").read_text(encoding="utf-8"), file_id="README.md#file")
    refs = {(r.name, r.type, r.source) for r in x.refs}
    assert ("AuthService.login", EdgeType.DOCUMENTS, "README.md::Docs app#document") in refs
    assert ("helper", EdgeType.DOCUMENTS, "README.md::Cài đặt#document") in refs
    assert not any(r.name == "id" for r in x.refs)


def _make_office(root: Path) -> None:
    import docx
    import openpyxl
    d = docx.Document()
    d.add_heading("Hướng dẫn", level=1)
    d.add_paragraph("Gọi AuthService để đăng nhập.")
    d.save(root / "guide.docx")
    wb = openpyxl.Workbook()
    wb.active.title = "Users"
    wb.active.append(["name", "role"])
    wb.save(root / "data.xlsx")


def test_docx_and_xlsx_text(docs_root, tmp_path):
    from nexgraph_engine.indexing.docs.text import doc_text
    _make_office(docs_root)
    assert "Hướng dẫn" in doc_text(docs_root / "guide.docx", "docx")
    assert "Users" in doc_text(docs_root / "data.xlsx", "xlsx")
    store = run_index(docs_root, tmp_path / "g.db", include_docs=True)
    labels = {(n.file, n.label) for n in nodes_of(store, NodeKind.DOCUMENT).values()}
    assert ("guide.docx", "Hướng dẫn") in labels
    assert any(f == "data.xlsx" and "Users" in label for f, label in labels)


def test_pdf_text():
    from nexgraph_engine.indexing.docs.text import doc_text
    assert "AuthService" in doc_text(FIX / "docs" / "spec.pdf", "pdf")


def test_broken_docx_keeps_file_node(docs_root, tmp_path):
    (docs_root / "bad.docx").write_text("not a zip")
    store = run_index(docs_root, tmp_path / "g.db", include_docs=True)
    assert store.file_record("bad.docx") is not None
    assert "bad.docx#file" in {n.id for n in store.all_nodes()}


def test_docs_off_graph_unchanged(docs_root, tmp_path):
    full = run_index(docs_root, tmp_path / "a.db")
    assert not nodes_of(full, NodeKind.DOCUMENT)
    code_only = tmp_path / "code"
    shutil.copytree(docs_root / "lib", code_only / "lib")
    ref = run_index(code_only, tmp_path / "b.db")
    assert len(list(full.all_nodes())) == len(list(ref.all_nodes()))


def test_bridge_marks_documents(docs_root, tmp_path):
    from nexgraph_engine.analysis.bridge.to_nx import build_nx
    store = run_index(docs_root, tmp_path / "g.db", include_docs=True)
    G = build_nx(store).G
    assert G.nodes["README.md::Cài đặt#document"]["file_type"] == "document"
    assert G.nodes["lib/auth.py::AuthService#class"]["file_type"] == "code"


def test_html_headings_become_document_nodes(docs_root, tmp_path):
    (docs_root / "guide.html").write_text("<html><body><h1>Hướng dẫn</h1><p>Mở <b>app</b>.</p>"
                                          "<script>var x=1</script><h2>Cài đặt</h2><p>Chạy.</p></body></html>", encoding="utf-8")
    store = run_index(docs_root, tmp_path / "g.db", include_docs=True)
    docs = nodes_of(store, NodeKind.DOCUMENT)
    assert "guide.html::Hướng dẫn#document" in docs and "guide.html::Cài đặt#document" in docs


def test_image_is_a_file_node_without_error(docs_root, tmp_path):
    (docs_root / "logo.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    store = run_index(docs_root, tmp_path / "g.db", include_docs=True, include_media=True,
                      transcript_dir=tmp_path / "tr")
    assert store.file_record("logo.png") is not None
    errs = store.conn.execute("SELECT count(*) FROM loi_phan_tich e JOIN tep t ON t.ma_tep = e.ma_tep"
                              " WHERE t.duong_dan_tuong_doi = 'logo.png'").fetchone()[0]
    assert errs == 0
