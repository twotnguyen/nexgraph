"""Kiểm thử lược đồ SQLite của NexGraph bằng dữ liệu mẫu và các ca vi phạm ràng buộc.

Chạy từ thư mục gốc:  python3 -I design/database/kiem_thu.py
Mỗi ca âm (vi phạm) phải bị từ chối và thông điệp lỗi phải chứa đúng chuỗi mong đợi, để chắc rằng
ràng buộc cần kiểm là ràng buộc đã chặn chứ không phải một ràng buộc khác.
Dữ liệu mẫu là app Flutter giả định `bookstore_app`.
"""
import hashlib
import os
import sqlite3
import sys
import uuid

DIR = os.path.dirname(os.path.abspath(__file__))
CHECK, UNIQUE, FK = "CHECK constraint failed", "UNIQUE constraint failed", "FOREIGN KEY constraint failed"

ket_qua = []  # (nhóm, tên, đạt, ghi chú)


def mo(ten_tep):
    con = sqlite3.connect(":memory:")
    con.isolation_level = None  # tự quản lý giao dịch
    con.execute("PRAGMA foreign_keys = ON")
    with open(os.path.join(DIR, ten_tep), encoding="utf-8") as f:
        con.executescript(f.read())
    return con


def chen(con, bang, **cot):
    ten = ", ".join(cot)
    cho = ", ".join("?" for _ in cot)
    return con.execute(f"INSERT INTO {bang} ({ten}) VALUES ({cho})", tuple(cot.values())).lastrowid


def am(nhom, ten, con, sql, tham_so=(), mong_doi=""):
    """Ca âm: câu lệnh phải bị từ chối với thông điệp chứa `mong_doi`; CSDL phải giữ nguyên."""
    con.execute("SAVEPOINT ca_am")
    try:
        con.execute(sql, tham_so)
    except sqlite3.IntegrityError as e:
        dat = mong_doi in str(e)
        ket_qua.append((nhom, ten, dat, "" if dat else f"lỗi khác: {e}"))
    else:
        ket_qua.append((nhom, ten, False, "câu lệnh KHÔNG bị từ chối"))
    finally:
        con.execute("ROLLBACK TO ca_am")
        con.execute("RELEASE ca_am")


def duong(nhom, ten, dieu_kien, ghi_chu=""):
    """Ca dương: điều kiện đúng."""
    ket_qua.append((nhom, ten, bool(dieu_kien), ghi_chu))


def duong_chay(nhom, ten, con, sql, tham_so=()):
    """Ca dương: câu lệnh hợp lệ phải chạy được (rồi hoàn tác)."""
    con.execute("SAVEPOINT ca_duong")
    try:
        con.execute(sql, tham_so)
        ket_qua.append((nhom, ten, True, ""))
    except sqlite3.Error as e:
        ket_qua.append((nhom, ten, False, str(e)))
    finally:
        con.execute("ROLLBACK TO ca_duong")
        con.execute("RELEASE ca_duong")


def sha(s):
    return hashlib.sha256(s.encode()).hexdigest()


# ---------------------------------------------------------------- CSDL đồ thị
def kiem_thu_do_thi():
    G = "Đồ thị"
    con = mo("graph.sql")
    ma_da = str(uuid.uuid4())
    chen(con, "du_an", ma_du_an=ma_da, ten="bookstore_app", co_git=1, phien_ban_schema=1, tao_luc=1000)
    lan = chen(con, "lan_lap_chi_muc", ma_du_an=ma_da, loai="day_du", trang_thai="hoan_tat",
               bat_dau_luc=1000, ket_thuc_luc=2000, so_tep_xu_ly=4, so_tep_tong=4, commit_sha="a" * 40)

    def tep(duong_dan, kiem_thu=0):
        return chen(con, "tep", duong_dan_tuong_doi=duong_dan, ngon_ngu="dart", kich_thuoc=1200, mtime=1500,
                    ma_bam=sha(duong_dan), la_kiem_thu=kiem_thu, ma_lan=lan)

    t_main = tep("lib/main.dart")
    t_login = tep("lib/screens/login_screen.dart")
    t_home = tep("lib/screens/home_screen.dart")
    t_test = tep("test/login_test.dart", 1)

    def nut(id_nut, loai, nhan, ten, tep_id=None, bd=None, kt=None, kiem_thu=0, khoi=None):
        return chen(con, "nut", id_nut=id_nut, loai_nut=loai, nhan=nhan, ten_day_du=ten, dong_bat_dau=bd,
                    dong_ket_thuc=kt, la_kiem_thu=kiem_thu, nguon_goc="ast", ma_tep=tep_id, ma_khoi=khoi)

    khoi_goc = chen(con, "khoi_kien_truc", ten="Xác thực", do_gan_ket=0.8, mo_ta="Đăng nhập", nguon_mo_ta="mau")
    khoi_con = chen(con, "khoi_kien_truc", ten="Màn hình đăng nhập", ma_khoi_cha=khoi_goc)

    n_repo = nut("#repository", "repository", "bookstore_app", "bookstore_app")
    n_dir = nut("lib/screens#directory", "directory", "screens", "lib/screens")
    n_f_login = nut("lib/screens/login_screen.dart#file", "file", "login_screen.dart", "login_screen.dart", t_login)
    n_login = nut("lib/screens/login_screen.dart::LoginScreen#widget", "widget", "LoginScreen", "LoginScreen",
                  t_login, 10, 60, khoi=khoi_con)
    n_build = nut("lib/screens/login_screen.dart::LoginScreen.build#method", "method", "build",
                  "LoginScreen.build", t_login, 20, 58, khoi=khoi_con)
    n_home = nut("lib/screens/home_screen.dart::HomeScreen#screen", "screen", "HomeScreen", "HomeScreen",
                 t_home, 5, 40)
    n_auth = nut("lib/main.dart::AuthService#class", "class", "AuthService", "AuthService", t_main, 3, 30)
    n_test = nut("test/login_test.dart::loginTest#test", "test", "loginTest", "loginTest", t_test, 1, 15, 1)

    def canh(nguon, dich, loai, dong=None, cot=None, muc="EXTRACTED", diem=1.0):
        return chen(con, "canh", ma_nut_nguon=nguon, ma_nut_dich=dich, loai_canh=loai, muc_tin_cay=muc,
                    diem_tin_cay=diem, nguon_goc="ast", dong_bang_chung=dong, cot_bang_chung=cot)

    canh(n_dir, n_f_login, "CONTAINS")
    canh(n_f_login, n_login, "DEFINES")
    canh(n_build, n_auth, "CALLS", 30, 8)
    canh(n_build, n_auth, "CALLS", 30, 40)           # cùng dòng, khác cột: phải được phép (cot_bang_chung)
    canh(n_login, n_home, "NAVIGATES_TO", 44, 12)
    canh(n_login, n_test, "TESTED_BY", 10, 0, "INFERRED", 0.7)
    chen(con, "tham_chieu_chua_phan_giai", ma_nut_nguon=n_build, ten_tham_chieu="Navigator.push",
         loai_tham_chieu="NAVIGATES_TO", dong=50, cot=8, trang_thai="that_bai")

    # --- Ca dương
    duong(G, "Dữ liệu mẫu nạp được (8 nút, 6 cạnh)",
          con.execute("select count(*) from nut").fetchone()[0] == 8
          and con.execute("select count(*) from canh").fetchone()[0] == 6)
    duong(G, "Hai lời gọi cùng dòng khác cột tồn tại song song (đa cạnh)",
          con.execute("select count(*) from canh where ma_nut_nguon=? and ma_nut_dich=?", (n_build, n_auth)).fetchone()[0] == 2)
    duong(G, "v_khoi_cap: khối gốc cấp 0, khối con cấp 1",
          dict(con.execute("select ma_khoi, cap from v_khoi_cap").fetchall()) == {khoi_goc: 0, khoi_con: 1})
    duong(G, "v_canh_bang_chung suy ra tệp bằng chứng từ nút nguồn",
          con.execute("select tep_bang_chung from v_canh_bang_chung where loai_canh='NAVIGATES_TO'").fetchone()[0]
          == "lib/screens/login_screen.dart")
    duong_chay(G, "Chỉ mục biểu thức tra tham chiếu theo đuôi tên",
               con, "select 1 from tham_chieu_chua_phan_giai where trang_thai='that_bai' and "
                    "substr(ten_tham_chieu, length(rtrim(ten_tham_chieu, replace(ten_tham_chieu,'.','')))+1)='push'")
    plan = " ".join(r[3] for r in con.execute(
        "explain query plan select 1 from tham_chieu_chua_phan_giai where trang_thai='that_bai' and "
        "substr(ten_tham_chieu, length(rtrim(ten_tham_chieu, replace(ten_tham_chieu,'.','')))+1)='push'"))
    duong(G, "Truy vấn đuôi tên dùng idx_tc_duoi_ten", "idx_tc_duoi_ten" in plan, plan)

    # FTS5 contentless + xóa theo trigger
    con.execute("insert into nut_fts(rowid, nhan, ten_day_du, chu_ky, tai_lieu, tu_khoa) values (?,?,?,?,?,?)",
                (n_login, "LoginScreen", "LoginScreen", "", "", "login screen"))
    duong(G, "FTS5 tìm được 'login'",
          con.execute("select rowid from nut_fts where nut_fts match 'login'").fetchall() == [(n_login,)])
    con.execute("savepoint s")
    con.execute("delete from tep where ma_tep=?", (t_login,))
    duong(G, "Xóa TEP xóa dây chuyền NUT, CANH, THAM_CHIEU và dòng FTS5",
          con.execute("select count(*) from nut where ma_tep=?", (t_login,)).fetchone()[0] == 0
          and con.execute("select count(*) from canh where ma_nut_nguon in (?,?,?)", (n_f_login, n_login, n_build)).fetchone()[0] == 0
          and con.execute("select count(*) from tham_chieu_chua_phan_giai").fetchone()[0] == 0
          and con.execute("select count(*) from nut_fts where nut_fts match 'login'").fetchone()[0] == 0)
    con.execute("rollback to s"); con.execute("release s")
    con.execute("savepoint s")
    con.execute("delete from khoi_kien_truc where ma_khoi=?", (khoi_con,))
    duong(G, "Xóa khối đặt ma_khoi của nút về NULL",
          con.execute("select count(*) from nut where ma_khoi is not null").fetchone()[0] == 0)
    con.execute("rollback to s"); con.execute("release s")

    # --- Ca âm theo từng RB
    am(G, "RB1 co_git = 2", con, "update du_an set co_git=2", (), CHECK)
    am(G, "RB1 phien_ban_schema = 0", con, "update du_an set phien_ban_schema=0", (), CHECK)
    am(G, "RB23 dự án thứ hai", con, "insert into du_an values (?, 'x', 0, 1, 1)", (str(uuid.uuid4()),), "RB23")
    L = lambda **kw: dict(ma_du_an=ma_da, loai="day_du", trang_thai="hoan_tat", bat_dau_luc=1, ket_thuc_luc=2,
                          so_tep_xu_ly=1, so_tep_tong=1, **kw)
    def lan_sql(**doi):
        d = L(); d.update(doi)
        return ("insert into lan_lap_chi_muc (" + ",".join(d) + ") values (" + ",".join("?" * len(d)) + ")", tuple(d.values()))
    for ten, doi, mong in [
        ("RB2 loai không hợp lệ", dict(loai="x"), CHECK),
        ("RB2 trang_thai không hợp lệ", dict(trang_thai="x"), CHECK),
        ("RB9 so_tep_xu_ly > so_tep_tong", dict(so_tep_xu_ly=5), CHECK),
        ("RB9 ket_thuc_luc < bat_dau_luc", dict(ket_thuc_luc=0), CHECK),
        ("RB9 hoàn tất nhưng chưa có ket_thuc_luc", dict(ket_thuc_luc=None), CHECK),
        ("RB9 đang chạy nhưng có ket_thuc_luc", dict(trang_thai="cho"), CHECK),
        ("RB9 trạng thái lỗi thiếu thong_bao_loi", dict(trang_thai="loi"), CHECK),
        ("RB9 có thong_bao_loi khi không lỗi", dict(thong_bao_loi="x"), CHECK),
        ("RB21 ma_du_an không tồn tại", dict(ma_du_an=str(uuid.uuid4())), FK),
    ]:
        s, p = lan_sql(**doi); am(G, ten, con, s, p, mong)
    chen(con, "lan_lap_chi_muc", ma_du_an=ma_da, loai="tang_dan", trang_thai="cau_truc", bat_dau_luc=3, so_tep_tong=2)
    s, p = lan_sql(trang_thai="phan_giai", ket_thuc_luc=None)
    am(G, "RB19 lần lập chỉ mục đang chạy thứ hai", con, s, p, UNIQUE)

    def tep_sql(**doi):
        d = dict(duong_dan_tuong_doi="lib/new.dart", ngon_ngu="dart", kich_thuoc=1, mtime=1, ma_bam=sha("n"), ma_lan=lan)
        d.update(doi)
        return ("insert into tep (" + ",".join(d) + ") values (" + ",".join("?" * len(d)) + ")", tuple(d.values()))
    for ten, doi, mong in [
        ("RB3 kich_thuoc âm", dict(kich_thuoc=-1), CHECK),
        ("RB3 ma_bam ngắn", dict(ma_bam="abc"), CHECK),
        ("RB3 ma_bam có chữ hoa", dict(ma_bam="A" * 64), CHECK),
        ("RB3 đường dẫn bắt đầu bằng /", dict(duong_dan_tuong_doi="/lib/a.dart"), CHECK),
        ("RB3 đường dẫn chứa \\", dict(duong_dan_tuong_doi="lib\\a.dart"), CHECK),
        ("RB14 đường dẫn trùng", dict(duong_dan_tuong_doi="lib/main.dart"), UNIQUE),
        ("RB21 ma_lan không tồn tại", dict(ma_lan=999), FK),
    ]:
        s, p = tep_sql(**doi); am(G, ten, con, s, p, mong)
    am(G, "RB4 loai lỗi không hợp lệ", con, "insert into loi_phan_tich(ma_tep, loai) values (?, 'x')", (t_main,), CHECK)
    chen(con, "loi_phan_tich", ma_tep=t_main, loai="parse_partial", chi_tiet="10-12")
    am(G, "RB17 lỗi trùng (ma_tep, loai)", con, "insert into loi_phan_tich(ma_tep, loai) values (?, 'parse_partial')", (t_main,), UNIQUE)
    am(G, "RB5 do_gan_ket = 1.5", con, "insert into khoi_kien_truc(ten, do_gan_ket) values ('k', 1.5)", (), CHECK)
    am(G, "RB5 nguon_mo_ta không hợp lệ", con, "insert into khoi_kien_truc(ten, mo_ta, nguon_mo_ta) values ('k','m','x')", (), CHECK)
    am(G, "RB13 có mo_ta nhưng thiếu nguon_mo_ta", con, "insert into khoi_kien_truc(ten, mo_ta) values ('k','m')", (), CHECK)
    am(G, "RB20 khối là cha của chính nó (INSERT, chặn bởi CHECK)", con,
       "insert into khoi_kien_truc(ma_khoi, ten, ma_khoi_cha) values (77, 'k', 77)", (), CHECK)
    am(G, "RB20 khối là cha của chính nó (UPDATE, trigger chặn trước CHECK)", con,
       "update khoi_kien_truc set ma_khoi_cha=ma_khoi where ma_khoi=?", (khoi_goc,), "RB20")
    am(G, "RB20 chu trình hai khối", con, "update khoi_kien_truc set ma_khoi_cha=? where ma_khoi=?", (khoi_con, khoi_goc), "RB20")

    def nut_sql(**doi):
        d = dict(id_nut="x::y#class", loai_nut="class", nhan="y", ten_day_du="y", dong_bat_dau=1, dong_ket_thuc=2,
                 nguon_goc="ast", ma_tep=t_main)
        d.update(doi)
        return ("insert into nut (" + ",".join(d) + ") values (" + ",".join("?" * len(d)) + ")", tuple(d.values()))
    for ten, doi, mong in [
        ("RB6 loai_nut không hợp lệ", dict(loai_nut="x"), CHECK),
        ("RB6 nguon_goc không hợp lệ", dict(nguon_goc="x"), CHECK),
        ("RB10 class thiếu khoảng dòng", dict(dong_bat_dau=None, dong_ket_thuc=None), CHECK),
        ("RB10 dong_ket_thuc < dong_bat_dau", dict(dong_bat_dau=5, dong_ket_thuc=2), CHECK),
        ("RB10 dong_bat_dau = 0", dict(dong_bat_dau=0, dong_ket_thuc=2), CHECK),
        ("RB11 file không có ma_tep", dict(loai_nut="file", dong_bat_dau=None, dong_ket_thuc=None, ma_tep=None), CHECK),
        ("RB11 repository có ma_tep", dict(loai_nut="repository", dong_bat_dau=None, dong_ket_thuc=None), CHECK),
        ("RB11 test nhưng la_kiem_thu = 0", dict(loai_nut="test", la_kiem_thu=0), CHECK),
        ("RB15 id_nut trùng", dict(id_nut="lib/main.dart::AuthService#class"), UNIQUE),
        ("RB21 ma_tep không tồn tại", dict(ma_tep=999), FK),
        ("RB21 ma_khoi không tồn tại", dict(ma_khoi=999), FK),
    ]:
        s, p = nut_sql(**doi); am(G, ten, con, s, p, mong)

    def canh_sql(**doi):
        d = dict(ma_nut_nguon=n_build, ma_nut_dich=n_home, loai_canh="CALLS", muc_tin_cay="EXTRACTED",
                 diem_tin_cay=1.0, nguon_goc="ast", dong_bang_chung=30, cot_bang_chung=1)
        d.update(doi)
        return ("insert into canh (" + ",".join(d) + ") values (" + ",".join("?" * len(d)) + ")", tuple(d.values()))
    for ten, doi, mong in [
        ("RB7 loai_canh không hợp lệ", dict(loai_canh="X"), CHECK),
        ("RB7 muc_tin_cay không hợp lệ", dict(muc_tin_cay="X"), CHECK),
        ("RB7 diem_tin_cay = 1.2", dict(diem_tin_cay=1.2), CHECK),
        ("RB7 nguon_goc không hợp lệ", dict(nguon_goc="x"), CHECK),
        ("RB12 CALLS không có dòng bằng chứng", dict(dong_bang_chung=None, cot_bang_chung=None), CHECK),
        ("RB12 có cột mà không có dòng", dict(loai_canh="CONTAINS", dong_bang_chung=None), CHECK),
        ("RB16 cạnh trùng hoàn toàn", dict(ma_nut_dich=n_auth, cot_bang_chung=8), UNIQUE),
        ("RB22 dòng bằng chứng ngoài khoảng dòng nút nguồn", dict(dong_bang_chung=99), "RB22"),
        ("RB21 nút đích không tồn tại", dict(ma_nut_dich=999), FK),
    ]:
        s, p = canh_sql(**doi); am(G, ten, con, s, p, mong)
    am(G, "RB16 hai cạnh CONTAINS trùng (dòng NULL vẫn bị bắt)", con,
       "insert into canh (ma_nut_nguon, ma_nut_dich, loai_canh, muc_tin_cay, diem_tin_cay, nguon_goc) "
       "values (?, ?, 'CONTAINS', 'EXTRACTED', 1, 'ast')", (n_dir, n_f_login), UNIQUE)
    am(G, "RB22 sửa khoảng dòng nút làm bằng chứng nằm ngoài", con,
       "update nut set dong_bat_dau=31, dong_ket_thuc=58 where ma_nut=?", (n_build,), "RB22")
    am(G, "RB22 đổi dòng bằng chứng ra ngoài khoảng", con,
       "update canh set dong_bang_chung=2 where ma_nut_nguon=? and cot_bang_chung=8", (n_build,), "RB22")
    am(G, "RB21 xóa lần lập chỉ mục khi còn tệp tham chiếu", con, "delete from lan_lap_chi_muc where ma_lan=?", (lan,), FK)

    def tc_sql(**doi):
        d = dict(ma_nut_nguon=n_build, ten_tham_chieu="foo", loai_tham_chieu="CALLS", dong=1, cot=0)
        d.update(doi)
        return ("insert into tham_chieu_chua_phan_giai (" + ",".join(d) + ") values (" + ",".join("?" * len(d)) + ")", tuple(d.values()))
    for ten, doi, mong in [
        ("RB8 loai_tham_chieu không hợp lệ", dict(loai_tham_chieu="X"), CHECK),
        ("RB8 dong = 0", dict(dong=0), CHECK),
        ("RB8 cot = -1", dict(cot=-1), CHECK),
        ("RB8 trang_thai không hợp lệ", dict(trang_thai="x"), CHECK),
        ("RB18 tham chiếu trùng", dict(ten_tham_chieu="Navigator.push", loai_tham_chieu="NAVIGATES_TO", dong=50, cot=8), UNIQUE),
    ]:
        s, p = tc_sql(**doi); am(G, ten, con, s, p, mong)

    # v2: kieu_bien, moc_tep, lan_lap_chi_muc.thu_muc_con
    duong(G, "v2 ghi kiểu biến", con.execute("insert into kieu_bien (ma_nut, ten, kieu) values (?, '_auth', 'AuthService')", (n_build,)).rowcount == 1)
    am(G, "v2 kieu_bien trùng khóa (nút, tên)", con, "insert into kieu_bien (ma_nut, ten, kieu) values (?, '_auth', 'X')", (n_build,), UNIQUE)
    am(G, "v2 kieu_bien kiểu rỗng", con, "insert into kieu_bien (ma_nut, ten, kieu) values (?, 'x', '')", (n_build,), CHECK)
    am(G, "v2 kieu_bien nút không tồn tại", con, "insert into kieu_bien (ma_nut, ten, kieu) values (999999, 'x', 'T')", (), FK)
    duong(G, "v2 ghi mốc tệp", con.execute("insert into moc_tep values ('lib/a.dart', ?)", (sha("a"),)).rowcount == 1)
    am(G, "v2 moc_tep mã băm không phải hex thường", con, "insert into moc_tep values ('lib/b.dart', ?)", ("G" * 64,), CHECK)
    am(G, "v2 moc_tep đường dẫn tuyệt đối", con, "insert into moc_tep values ('/b.dart', ?)", (sha("b"),), CHECK)
    am(G, "v2 moc_tep đường dẫn có dấu gạch ngược", con, "insert into moc_tep values (char(108, 92, 98), ?)", (sha("b"),), CHECK)
    am(G, "v2 thu_muc_con rỗng", con, "update lan_lap_chi_muc set thu_muc_con = '' where ma_lan = ?", (lan,), CHECK)
    con.close()


# ------------------------------------------------------------ CSDL cá nhân
def kiem_thu_ca_nhan():
    P = "Cá nhân"
    con = mo("app.sql")
    ma_da = str(uuid.uuid4())
    chen(con, "du_an_da_mo", ma_du_an=ma_da, duong_dan_tuyet_doi="/Users/tinh/bookstore_app", ten="bookstore_app",
         noi_luu="trong_du_an", mo_lan_cuoi=1)
    k_acp = chen(con, "ket_noi_ai", loai="acp", ten_hien_thi="Agent cục bộ", ten_agent="agent-cuc-bo", la_mac_dinh=1)
    k_api = chen(con, "ket_noi_ai", loai="api_key", ten_hien_thi="Dịch vụ OpenAI-compatible", base_url="https://x/v1",
                 ten_model="m", muc_keychain="nexgraph/2")
    p1 = chen(con, "phien_chat", ma_du_an=ma_da, ma_ket_noi=k_acp, tieu_de="Luồng đăng nhập", tao_luc=1, cap_nhat_luc=1)
    m_nd = chen(con, "tin_nhan", ma_phien=p1, thu_tu=1, vai_tro="nguoi_dung", noi_dung="Luồng đăng nhập chạy thế nào?", tao_luc=1)
    m_tl = chen(con, "tin_nhan", ma_phien=p1, thu_tu=2, vai_tro="tro_ly", noi_dung="Xem LoginScreen", tao_luc=2)
    chen(con, "dong_y_gui_du_lieu", ma_du_an=ma_da, ma_ket_noi=k_acp, dong_y_luc=1)
    chen(con, "doan_ma_da_gui", ma_tin=m_nd, duong_dan_tuong_doi="lib/screens/login_screen.dart", dong_bat_dau=10,
         dong_ket_thuc=60, ma_bam=sha("a"))
    chen(con, "trich_dan", ma_tin=m_tl, duong_dan_tuong_doi="lib/screens/login_screen.dart", dong_bat_dau=20,
         dong_ket_thuc=58, trang_thai="da_xac_minh")

    duong(P, "Dữ liệu mẫu nạp được (đồng ý trước khi ghi đoạn mã đã gửi)", True)
    for dd in ["C:\\Users\\tinh\\app", "C:/Users/tinh/app", "\\\\server\\share\\app"]:
        duong_chay(P, f"RB24 đường dẫn tuyệt đối hợp lệ: {dd}", con,
                   "insert into du_an_da_mo (ma_du_an, duong_dan_tuyet_doi, ten, noi_luu, mo_lan_cuoi) values (?, ?, 'x', 'thu_muc_app', 1)", (str(uuid.uuid4()), dd))
    con.execute("savepoint s")
    con.execute("delete from ket_noi_ai where ma_ket_noi=?", (k_acp,))
    duong(P, "Xóa kết nối đặt ma_ket_noi của phiên về NULL và xóa dòng đồng ý",
          con.execute("select ma_ket_noi from phien_chat").fetchone()[0] is None
          and con.execute("select count(*) from dong_y_gui_du_lieu").fetchone()[0] == 0)
    con.execute("rollback to s"); con.execute("release s")
    con.execute("savepoint s")
    con.execute("delete from du_an_da_mo where ma_du_an=?", (ma_da,))
    duong(P, "Xóa dự án xóa dây chuyền phiên, tin nhắn, trích dẫn, đoạn mã, đồng ý",
          all(con.execute(f"select count(*) from {b}").fetchone()[0] == 0
              for b in ["phien_chat", "tin_nhan", "trich_dan", "doan_ma_da_gui", "dong_y_gui_du_lieu"]))
    con.execute("rollback to s"); con.execute("release s")

    ins = lambda b, d: ("insert into %s (%s) values (%s)" % (b, ",".join(d), ",".join("?" * len(d))), tuple(d.values()))
    D = lambda **kw: kw
    ca = [
        ("RB24 noi_luu không hợp lệ", *ins("du_an_da_mo", D(ma_du_an=str(uuid.uuid4()), duong_dan_tuyet_doi="/a", ten="x", noi_luu="x", mo_lan_cuoi=1)), CHECK),
        ("RB24 đường dẫn tương đối", *ins("du_an_da_mo", D(ma_du_an=str(uuid.uuid4()), duong_dan_tuyet_doi="a/b", ten="x", noi_luu="thu_muc_app", mo_lan_cuoi=1)), CHECK),
        ("RB24 đường dẫn trùng", *ins("du_an_da_mo", D(ma_du_an=str(uuid.uuid4()), duong_dan_tuyet_doi="/Users/tinh/bookstore_app", ten="x", noi_luu="thu_muc_app", mo_lan_cuoi=1)), UNIQUE),
        ("RB25 loai kết nối không hợp lệ", *ins("ket_noi_ai", D(loai="x", ten_hien_thi="x")), CHECK),
        ("RB25 acp thiếu ten_agent", *ins("ket_noi_ai", D(loai="acp", ten_hien_thi="x")), CHECK),
        ("RB25 api_key thiếu base_url", *ins("ket_noi_ai", D(loai="api_key", ten_hien_thi="x", ten_model="m", muc_keychain="k")), CHECK),
        ("RB25 api_key thiếu muc_keychain", *ins("ket_noi_ai", D(loai="api_key", ten_hien_thi="x", base_url="u", ten_model="m")), CHECK),
        ("RB26 kết nối mặc định thứ hai", *ins("ket_noi_ai", D(loai="acp", ten_hien_thi="y", ten_agent="a", la_mac_dinh=1)), UNIQUE),
        ("RB27 cap_nhat_luc < tao_luc", *ins("phien_chat", D(ma_du_an=ma_da, tieu_de="x", tao_luc=5, cap_nhat_luc=1)), CHECK),
        ("RB33 phiên của dự án không tồn tại", *ins("phien_chat", D(ma_du_an=str(uuid.uuid4()), tieu_de="x", tao_luc=1, cap_nhat_luc=1)), FK),
        ("RB28 vai_tro không hợp lệ", *ins("tin_nhan", D(ma_phien=p1, thu_tu=3, vai_tro="x", noi_dung="x", tao_luc=1)), CHECK),
        ("RB28 thu_tu = 0 (INSERT, trigger liên tục chặn trước CHECK)", *ins("tin_nhan", D(ma_phien=p1, thu_tu=0, vai_tro="tro_ly", noi_dung="x", tao_luc=1)), "RB28"),
        ("RB28 thu_tu trùng (INSERT, trigger liên tục chặn trước UNIQUE)", *ins("tin_nhan", D(ma_phien=p1, thu_tu=2, vai_tro="tro_ly", noi_dung="x", tao_luc=1)), "RB28"),
        ("RB28 UPDATE thu_tu về 0 (CHECK)", "update tin_nhan set thu_tu=0 where ma_tin=?", (m_tl,), CHECK),
        ("RB28 UPDATE thu_tu trùng (UNIQUE)", "update tin_nhan set thu_tu=1 where ma_tin=?", (m_tl,), UNIQUE),
        ("RB28 thu_tu nhảy cóc (4 khi mới có 2)", *ins("tin_nhan", D(ma_phien=p1, thu_tu=4, vai_tro="tro_ly", noi_dung="x", tao_luc=1)), "RB28"),
        ("RB29 trang_thai trích dẫn không hợp lệ", *ins("trich_dan", D(ma_tin=m_tl, duong_dan_tuong_doi="a", dong_bat_dau=1, dong_ket_thuc=2, trang_thai="x")), CHECK),
        ("RB29 dong_bat_dau = 0", *ins("trich_dan", D(ma_tin=m_tl, duong_dan_tuong_doi="a", dong_bat_dau=0, dong_ket_thuc=2, trang_thai="da_xac_minh")), CHECK),
        ("RB29 dong_ket_thuc < dong_bat_dau", *ins("trich_dan", D(ma_tin=m_tl, duong_dan_tuong_doi="a", dong_bat_dau=5, dong_ket_thuc=2, trang_thai="da_xac_minh")), CHECK),
        ("RB30 đoạn mã: dong_ket_thuc < dong_bat_dau", *ins("doan_ma_da_gui", D(ma_tin=m_nd, duong_dan_tuong_doi="a", dong_bat_dau=5, dong_ket_thuc=2, ma_bam=sha("b"))), CHECK),
        ("RB30 đoạn mã: ma_bam sai định dạng", *ins("doan_ma_da_gui", D(ma_tin=m_nd, duong_dan_tuong_doi="a", dong_bat_dau=1, dong_ket_thuc=2, ma_bam="z" * 64)), CHECK),
        ("RB31 trích dẫn thuộc tin nhắn của người dùng", *ins("trich_dan", D(ma_tin=m_nd, duong_dan_tuong_doi="a", dong_bat_dau=1, dong_ket_thuc=2, trang_thai="da_xac_minh")), "RB31"),
        ("RB32 đoạn mã thuộc tin nhắn của trợ lý", *ins("doan_ma_da_gui", D(ma_tin=m_tl, duong_dan_tuong_doi="a", dong_bat_dau=1, dong_ket_thuc=2, ma_bam=sha("b"))), "RB32"),
        ("RB31/32 đổi vai trò tin nhắn đang có đoạn mã", "update tin_nhan set vai_tro='tro_ly' where ma_tin=?", (m_nd,), "RB31/RB32"),
        ("RB33 đồng ý cho kết nối không tồn tại", *ins("dong_y_gui_du_lieu", D(ma_du_an=ma_da, ma_ket_noi=999, dong_y_luc=1)), FK),
        ("Khóa chính: đồng ý trùng cặp (dự án, kết nối)", *ins("dong_y_gui_du_lieu", D(ma_du_an=ma_da, ma_ket_noi=k_acp, dong_y_luc=2)), UNIQUE),
    ]
    for ten, sql, tham_so, mong in ca:
        am(P, ten, con, sql, tham_so, mong)

    # RB34: đoạn mã đã gửi cần đồng ý đúng kết nối của phiên
    p2 = chen(con, "phien_chat", ma_du_an=ma_da, ma_ket_noi=k_api, tieu_de="Phiên API", tao_luc=1, cap_nhat_luc=1)
    m2 = chen(con, "tin_nhan", ma_phien=p2, thu_tu=1, vai_tro="nguoi_dung", noi_dung="Hỏi", tao_luc=1)
    am(P, "RB34 gửi mã tới kết nối chưa được dự án đồng ý", con,
       "insert into doan_ma_da_gui(ma_tin, duong_dan_tuong_doi, dong_bat_dau, dong_ket_thuc, ma_bam) values (?, 'a', 1, 2, ?)",
       (m2, sha("c")), "RB34")
    chen(con, "dong_y_gui_du_lieu", ma_du_an=ma_da, ma_ket_noi=k_api, dong_y_luc=3)
    duong_chay(P, "RB34 sau khi đồng ý thì ghi được đoạn mã", con,
               "insert into doan_ma_da_gui(ma_tin, duong_dan_tuong_doi, dong_bat_dau, dong_ket_thuc, ma_bam) values (?, 'a', 1, 2, ?)",
               (m2, sha("c")))
    p3 = chen(con, "phien_chat", ma_du_an=ma_da, ma_ket_noi=None, tieu_de="Không kết nối", tao_luc=1, cap_nhat_luc=1)
    m3 = chen(con, "tin_nhan", ma_phien=p3, thu_tu=1, vai_tro="nguoi_dung", noi_dung="Hỏi", tao_luc=1)
    am(P, "RB34 phiên không có kết nối thì không ghi được đoạn mã", con,
       "insert into doan_ma_da_gui(ma_tin, duong_dan_tuong_doi, dong_bat_dau, dong_ket_thuc, ma_bam) values (?, 'a', 1, 2, ?)",
       (m3, sha("c")), "RB34")
    con.close()


def main():
    kiem_thu_do_thi()
    kiem_thu_ca_nhan()
    loi = [k for k in ket_qua if not k[2]]
    nhom_cu = None
    for nhom, ten, dat, ghi in ket_qua:
        if nhom != nhom_cu:
            print(f"\n== {nhom} ==")
            nhom_cu = nhom
        print(f"  [{'ĐẠT' if dat else 'LỖI'}] {ten}" + (f"   -> {ghi}" if ghi and not dat else ""))
    print(f"\nTổng: {len(ket_qua)} ca, đạt {len(ket_qua) - len(loi)}, lỗi {len(loi)}.")
    sys.exit(1 if loi else 0)


if __name__ == "__main__":
    main()
