"""Chuyến tham quan tất định (F7): sinh tại lúc gọi từ luồng, cụm và nút trung tâm; không lưu, không AI."""
from __future__ import annotations

from nexgraph_engine.query.contracts import node_json
from nexgraph_engine.store.graph_store import GraphStore

MAX_STEPS = 10
MAX_FLOW_STEPS = 3
MAX_COMMUNITIES = 3
MAX_HUBS = 2
MIN_COMMUNITY_FILES = 2


def _flow_rows(store: GraphStore) -> list:
    return store.conn.execute(
        "SELECT l.*, n.id_nut, n.nhan, t.duong_dan_tuong_doi AS tep,"
        " (SELECT bn.nhan FROM buoc_luong b JOIN nut bn ON bn.ma_nut = b.ma_nut"
        "  WHERE b.ma_luong = l.ma_luong ORDER BY b.thu_tu DESC LIMIT 1) AS buoc_cuoi"
        " FROM luong l JOIN nut n ON n.ma_nut = l.ma_nut_vao JOIN tep t ON t.ma_tep = n.ma_tep"
        " ORDER BY l.diem DESC, l.ten, l.ma_luong").fetchall()


def _node(store: GraphStore, node_id: str) -> dict | None:
    n = store.get_node(node_id)
    return node_json(n) if n else None


def _step(kind: str, title: str, body: str, node: dict | None, flow_id: int | None = None, block_id: str | None = None) -> dict:
    return {"kind": kind, "title": title, "body": body, "node": node, "flow_id": flow_id, "block_id": block_id}


def _community_label(name: str, en: bool) -> str:
    """Nhãn cụm lưu trong CSDL là tiếng Việt (`Cụm quanh X`, `Cộng đồng N`); đổi ở lớp hiển thị."""
    if not en:
        return name if name.startswith(("Cụm", "Cộng đồng")) or name == "Khác" else f"Cụm {name}"
    for vi, translated in (("Cụm quanh ", "Cluster around "), ("Cộng đồng ", "Community ")):
        if name.startswith(vi):
            return translated + name[len(vi):]
    return "Other" if name == "Khác" else name


def _entry_and_flows(store: GraphStore, en: bool) -> list[dict]:
    rows = _flow_rows(store)
    if not rows:
        return []
    first = next((r for r in rows if r["loai_vao"] == "main"), rows[0])
    if en:
        title, body = "Entry point", (
            f"{first['nhan']} in {first['tep']} is where the program starts. "
            f"From here {first['so_buoc']} calls continue through {first['so_tep']} files.")
    else:
        title, body = "Điểm khởi động", (
            f"{first['nhan']} trong {first['tep']} là nơi chương trình bắt đầu. "
            f"Từ đây có {first['so_buoc']} bước gọi tiếp qua {first['so_tep']} tệp.")
    out = [_step("entry", title, body, _node(store, first["id_nut"]), flow_id=first["ma_luong"])]
    used_files: set[str] = set()  # các luồng ở bước 2–4 phải có điểm vào ở tệp khác nhau
    for r in rows:
        if len(out) > MAX_FLOW_STEPS:
            break
        if r["ma_luong"] == first["ma_luong"] or r["tep"] in used_files:
            continue
        used_files.add(r["tep"])
        if en:
            tail = f"The flow goes through {r['so_buoc']} steps across {r['so_tep']} files and ends at {r['buoc_cuoi']}."
            head = f"Entry point {r['mo_ta_vao']}. " if r["mo_ta_vao"] and r["loai_vao"] in ("route", "cli", "event") else ""
            title = f"Flow {r['ten']}"
        else:
            tail = f"Luồng đi qua {r['so_buoc']} bước trong {r['so_tep']} tệp, kết thúc ở {r['buoc_cuoi']}."
            head = f"Điểm vào {r['mo_ta_vao']}. " if r["mo_ta_vao"] and r["loai_vao"] in ("route", "cli", "event") else ""
            title = f"Luồng {r['ten']}"
        out.append(_step("flow", title, head + tail, _node(store, r["id_nut"]), flow_id=r["ma_luong"]))
    return out


def _communities(store: GraphStore, en: bool) -> list[dict]:
    conn = store.conn
    out = []
    for k, ten, n_files in conn.execute(
            "SELECT k.ma_khoi, k.ten, count(*) AS c FROM khoi_kien_truc k JOIN nut n ON n.ma_khoi = k.ma_khoi"
            " WHERE n.loai_nut = 'file' GROUP BY k.ma_khoi HAVING c >= ? ORDER BY c DESC, k.ma_khoi LIMIT ?",
            (MIN_COMMUNITY_FILES, MAX_COMMUNITIES)).fetchall():
        center = conn.execute(
            "SELECT n.id_nut, n.nhan, (SELECT count(*) FROM canh c WHERE c.ma_nut_nguon = n.ma_nut OR c.ma_nut_dich = n.ma_nut) AS deg"
            " FROM nut n WHERE n.ma_khoi = ? AND n.loai_nut = 'file' ORDER BY deg DESC, n.id_nut LIMIT 1", (k,)).fetchone()
        label = _community_label(ten, en)
        if en:
            out.append(_step("community", f"Community: {label}",
                             f"{n_files} files are tightly coupled around {center['nhan']}.",
                             _node(store, center["id_nut"]), block_id=f"com:{k}"))
        else:
            out.append(_step("community", label, f"{n_files} tệp gắn chặt với nhau quanh {center['nhan']}.",
                             _node(store, center["id_nut"]), block_id=f"com:{k}"))
    return out


def _hubs(store: GraphStore, en: bool) -> list[dict]:
    rows = store.conn.execute(
        "SELECT n.id_nut, n.nhan, n.ten_day_du, count(DISTINCT c.ma_nut_nguon) AS callers FROM canh c"
        " JOIN nut n ON n.ma_nut = c.ma_nut_dich JOIN nut s ON s.ma_nut = c.ma_nut_nguon"
        " WHERE c.loai_canh = 'CALLS' AND n.loai_nut IN ('function', 'method', 'class') AND n.la_kiem_thu = 0"
        " AND s.ma_nut <> n.ma_nut GROUP BY n.ma_nut ORDER BY callers DESC, n.id_nut LIMIT ?", (MAX_HUBS,)).fetchall()
    out = []
    for r in rows:
        if en:
            out.append(_step("hub", f"Hotspot: {r['nhan']}",
                             f"{r['callers']} callers reach {r['ten_day_du']}. Changes here have wide impact.",
                             _node(store, r["id_nut"])))
        else:
            out.append(_step("hub", f"Điểm nóng: {r['nhan']}",
                             f"{r['callers']} nơi gọi tới {r['ten_day_du']}. Sửa ở đây ảnh hưởng rộng.",
                             _node(store, r["id_nut"])))
    return out


def _tests(store: GraphStore, en: bool) -> list[dict]:
    conn = store.conn
    totals = conn.execute(
        "SELECT count(DISTINCT c.ma_nut_dich), count(DISTINCT c.ma_nut_nguon) FROM canh c WHERE c.loai_canh = 'TESTED_BY'").fetchone()
    if not totals[0]:
        return []
    top = conn.execute(
        "SELECT n.id_nut FROM canh c JOIN nut n ON n.ma_nut = c.ma_nut_dich WHERE c.loai_canh = 'TESTED_BY'"
        " GROUP BY n.ma_nut ORDER BY count(*) DESC, n.id_nut LIMIT 1").fetchone()
    if en:
        return [_step("tests", "Tests",
                      f"{totals[0]} test files, {totals[1]} functions and classes have tests pointing to them.",
                      _node(store, top[0]))]
    return [_step("tests", "Kiểm thử", f"{totals[0]} tệp kiểm thử, {totals[1]} hàm và lớp đã có test trỏ tới.",
                  _node(store, top[0]))]


def build_tour(store: GraphStore, lang: str = "vi") -> dict:
    """`lang="vi"` (mặc định, hành vi cũ) hoặc `"en"` cho toàn bộ title/body của tour."""
    if lang not in ("vi", "en"):
        raise ValueError(f"lang phải là 'vi' hoặc 'en', nhận {lang!r}")
    en = lang == "en"
    steps = [*_entry_and_flows(store, en), *_communities(store, en), *_hubs(store, en), *_tests(store, en)][:MAX_STEPS]
    return {"steps": [{"order": i, **s} for i, s in enumerate(steps, start=1)]}
