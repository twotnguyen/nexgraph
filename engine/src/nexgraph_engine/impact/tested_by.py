"""Sinh cạnh TESTED_BY (nút được kiểm thử -> test) từ các cạnh CALLS xuất phát trong tệp kiểm thử."""
from __future__ import annotations

from nexgraph_engine.store.graph_store import GraphStore

_DESIRED = (
    "CREATE TEMP TABLE _tb AS"
    " SELECT c.ma_nut_dich AS tested, c.ma_nut_nguon AS test, max(c.diem_tin_cay) AS score"
    " FROM canh c JOIN nut s ON s.ma_nut = c.ma_nut_nguon JOIN nut d ON d.ma_nut = c.ma_nut_dich"
    " WHERE c.loai_canh = 'CALLS' AND s.la_kiem_thu = 1 AND d.la_kiem_thu = 0 GROUP BY 1, 2"
)


def derive_tested_by(store: GraphStore) -> int:
    """Đồng bộ tập cạnh TESTED_BY với các cạnh CALLS hiện có (thêm cái thiếu, bỏ cái thừa, giữ nguyên `ma_canh`).

    Trả về số cạnh TESTED_BY sau khi đồng bộ.
    """
    c = store.conn
    c.execute("DROP TABLE IF EXISTS temp._tb")
    c.execute(_DESIRED)
    # Không có chỉ mục thì DELETE/UPDATE quét cả bảng tạm cho từng cạnh TESTED_BY hiện có: 41 s + 41 s ở 62.000 cạnh (hermes-agent, H6).
    c.execute("CREATE UNIQUE INDEX temp._tb_key ON _tb (tested, test)")
    c.execute(
        "DELETE FROM canh WHERE loai_canh = 'TESTED_BY' AND NOT EXISTS ("
        " SELECT 1 FROM temp._tb t WHERE t.tested = canh.ma_nut_nguon AND t.test = canh.ma_nut_dich)")
    c.execute(
        "UPDATE canh SET diem_tin_cay = (SELECT t.score FROM temp._tb t"
        " WHERE t.tested = canh.ma_nut_nguon AND t.test = canh.ma_nut_dich)"
        " WHERE loai_canh = 'TESTED_BY'")
    c.execute(
        "INSERT INTO canh (ma_nut_nguon, ma_nut_dich, loai_canh, loai_con, muc_tin_cay, diem_tin_cay, nguon_goc)"
        " SELECT t.tested, t.test, 'TESTED_BY', 'direct', 'INFERRED', t.score, 'resolver' FROM temp._tb t"
        " WHERE NOT EXISTS (SELECT 1 FROM canh x WHERE x.loai_canh = 'TESTED_BY'"
        " AND x.ma_nut_nguon = t.tested AND x.ma_nut_dich = t.test)")
    c.execute("DROP TABLE temp._tb")
    store.commit()
    return c.execute("SELECT count(*) FROM canh WHERE loai_canh = 'TESTED_BY'").fetchone()[0]
