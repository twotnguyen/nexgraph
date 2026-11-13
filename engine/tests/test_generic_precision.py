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


def test_typescript_extends_and_implements_across_files_are_linked(tmp_path, index_project):
    root = tmp_path / "proj"
    root.mkdir()
    (root / "base.ts").write_text("export class Base<T> {}\nexport interface Shape<T> {}\nexport interface Named {}\n")
    (root / "child.ts").write_text(
        "import { Base, Shape, Named } from './base';\n\n"
        "@Injectable()\n"
        "export class Child extends Base<'x'> implements Shape<number>,\n"
        "  Named, Disposable {\n"
        "  run() {}\n"
        "}\n")
    store, _, _ = index_project(root)
    assert ("child.ts::Child#class", "base.ts::Base#class") in _edges(store, EdgeType.INHERITS)
    implements = _edges(store, EdgeType.IMPLEMENTS)
    assert ("child.ts::Child#class", "base.ts::Shape#class") in implements
    assert ("child.ts::Child#class", "base.ts::Named#class") in implements


def test_same_named_functions_on_one_line_get_distinct_ids(tmp_path, index_project):
    """Mã rút gọn (minified): nhiều hàm lồng cùng tên cùng dòng làm lập chỉ mục chết vì trùng id (open-design, H6)."""
    root = tmp_path / "proj"
    root.mkdir()
    (root / "m.min.js").write_text(
        "function p1(){function l(){return 1}}function p2(){function l(){return 2}}function p3(){function l(){return 3}}\n")
    store, result, _ = index_project(root)
    assert result.state == "hoan_tat", result
    ids = [r[0] for r in store.conn.execute("SELECT id_nut FROM nut WHERE loai_nut = 'function'")]
    assert len(ids) == len(set(ids))
