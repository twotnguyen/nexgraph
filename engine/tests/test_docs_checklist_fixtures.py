"""Fixture checklist (QA-18): `docs_app` đủ loại tệp để chạy checklist Graphify 1.7, 2.4, 2.5 trên app thật.

1.7 cần một ảnh PNG (node tệp, không lỗi), 2.4 cần .docx/.xlsx/.html/.yaml, 2.5 cần một tệp audio ngắn.
Không có faster-whisper thì tệp audio vẫn vào graph dạng node tệp kèm lỗi "cần cài" thay vì làm hỏng lượt index.
"""

import shutil
import threading
from pathlib import Path

from nexgraph_engine.docs.media import MISSING_WHISPER, has_whisper
from nexgraph_engine.pipeline.legacy_indexer import Indexer
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.schema.enums import NodeKind
from nexgraph_engine.store.graph_store import GraphStore

FIX = Path(__file__).parent / "fixtures" / "docs_app"

# Tên tệp do đợt QA-18 tự đặt; checklist-graphify.md chỉ yêu cầu thư mục `engine/tests/fixtures/docs_app`
# (mục Chuẩn bị) chứ không liệt kê tên tệp.
CHECKLIST_FILES = ("docs/huong-dan.docx", "docs/bang-diem.xlsx", "docs/huong-dan.html",
                   "cau-hinh.yaml", "docs/logo.png", "docs/ghi-am.wav")


def run_index(root: Path, db: Path) -> GraphStore:
    store = GraphStore(open_graph_db(db))
    store.init_project(root.name, has_git=False)
    result = Indexer(store, root, on_progress=lambda e: None, cancel=threading.Event(),
                     include_docs=True, include_media=True, include_config=True,
                     transcript_dir=db.parent / "transcripts").run()
    assert result.state == "hoan_tat"
    return store


def errors_of(store: GraphStore, rel_path: str) -> list[str]:
    rows = store.conn.execute(
        "SELECT e.chi_tiet AS message FROM loi_phan_tich e JOIN tep t ON t.ma_tep = e.ma_tep"
        " WHERE t.duong_dan_tuong_doi = ?", (rel_path,))
    return [r["message"] for r in rows]


def test_checklist_fixtures_exist():
    missing = [name for name in CHECKLIST_FILES if not (FIX / name).is_file()]
    assert missing == [], f"docs_app thiếu fixture checklist: {missing}"


def test_checklist_fixtures_index_for_graphify_checklist(tmp_path):
    root = tmp_path / "Đồ án" / "docs checklist"
    shutil.copytree(FIX, root)
    store = run_index(root, tmp_path / "g.db")

    docs = {n.id for n in store.all_nodes() if n.kind == NodeKind.DOCUMENT}
    assert "docs/huong-dan.docx::Hướng dẫn#document" in docs
    assert "docs/huong-dan.html::Hướng dẫn#document" in docs
    assert any(n.startswith("docs/bang-diem.xlsx::") for n in docs)

    config = store.file_record("cau-hinh.yaml")
    assert config is not None and config.language == "yaml"
    assert errors_of(store, "cau-hinh.yaml") == []

    image = store.file_record("docs/logo.png")
    assert image is not None and image.language == "image"
    assert errors_of(store, "docs/logo.png") == []

    audio = store.file_record("docs/ghi-am.wav")
    assert audio is not None and audio.language == "media"
    if not has_whisper():
        assert errors_of(store, "docs/ghi-am.wav") == [MISSING_WHISPER]
