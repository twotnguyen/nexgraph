"""Hai lỗi do chấm độ đúng (H6) tìm ra ở bước nối lời gọi/kế thừa của extractor chung."""
from nexgraph_engine.schema.enums import EdgeType


def _edges(store, kind):
    return {(r[0], r[1]) for r in store.conn.execute(
        "SELECT a.id_nut, b.id_nut FROM canh c JOIN nut a ON a.ma_nut = c.ma_nut_nguon"
        " JOIN nut b ON b.ma_nut = c.ma_nut_dich WHERE c.loai_canh = ?", (kind.value,))}


def test_python_cross_file_inheritance_is_linked(tmp_path, index_project):
    root = tmp_path / "proj"
    root.mkdir()
    (root / "base.py").write_text("class Base:\n    pass\n")
    (root / "child.py").write_text("from base import Base\n\n\nclass Child(Base):\n    pass\n")
    store, _, _ = index_project(root)
    assert ("child.py::Child#class", "base.py::Base#class") in _edges(store, EdgeType.INHERITS)


def test_call_on_foreign_receiver_is_not_linked_to_same_named_own_method(tmp_path, index_project):
    root = tmp_path / "proj"
    root.mkdir()
    (root / "util.ts").write_text(
        "import * as bcrypt from 'bcrypt';\n\n"
        "export class StringUtil {\n"
        "  async compare(value: string, hashed: string) {\n"
        "    return await bcrypt.compare(value, hashed);\n"
        "  }\n"
        "  async check(v: string, h: string) {\n"
        "    return this.compare(v, h);\n"
        "  }\n"
        "}\n")
    store, _, _ = index_project(root)
    calls = _edges(store, EdgeType.CALLS)
    assert ("util.ts::StringUtil.compare#method", "util.ts::StringUtil.compare#method") not in calls
    assert ("util.ts::StringUtil.check#method", "util.ts::StringUtil.compare#method") in calls  # this.x() vẫn nối
