-- NexGraph: CSDL đồ thị của một dự án (.nexgraph/graph.db). SQLite >= 3.43 (FTS5 contentless_delete).
-- Lược đồ theo docs/superpowers/specs/2026-10-24-nexgraph-csdl-chuan-hoa.md. Số RBn là mã ràng buộc toàn vẹn ở tài liệu đó.
-- Mỗi kết nối phải chạy: PRAGMA foreign_keys = ON;  (SQLite tắt mặc định, không lưu trong tệp)

PRAGMA user_version = 1;

-- 1. DU_AN ---------------------------------------------------------------
CREATE TABLE du_an (
    ma_du_an         TEXT    NOT NULL PRIMARY KEY CHECK (length(ma_du_an) = 36),
    ten              TEXT    NOT NULL CHECK (length(ten) BETWEEN 1 AND 255),
    co_git           INTEGER NOT NULL CHECK (co_git IN (0, 1)),                        -- RB1
    phien_ban_schema INTEGER NOT NULL CHECK (phien_ban_schema >= 1),                    -- RB1
    tao_luc          INTEGER NOT NULL
);

-- RB23: mỗi cơ sở dữ liệu chỉ chứa một dự án.
CREATE TRIGGER trg_du_an_mot_bo BEFORE INSERT ON du_an
WHEN (SELECT count(*) FROM du_an) >= 1
BEGIN SELECT RAISE(ABORT, 'RB23: co so du lieu chi chua mot du an'); END;

-- 2. LAN_LAP_CHI_MUC -----------------------------------------------------
CREATE TABLE lan_lap_chi_muc (
    ma_lan        INTEGER PRIMARY KEY,
    ma_du_an      TEXT    NOT NULL REFERENCES du_an (ma_du_an),
    loai          TEXT    NOT NULL CHECK (loai IN ('day_du', 'tang_dan')),              -- RB2
    trang_thai    TEXT    NOT NULL CHECK (trang_thai IN
                      ('cho', 'cau_truc', 'phan_giai', 'hoan_tat', 'loi', 'huy')),      -- RB2
    bat_dau_luc   INTEGER NOT NULL,
    ket_thuc_luc  INTEGER,
    so_tep_xu_ly  INTEGER NOT NULL DEFAULT 0 CHECK (so_tep_xu_ly >= 0),
    so_tep_tong   INTEGER NOT NULL DEFAULT 0,
    commit_sha    TEXT    CHECK (commit_sha IS NULL OR length(commit_sha) BETWEEN 40 AND 64),
    thong_bao_loi TEXT,
    CHECK (so_tep_xu_ly <= so_tep_tong),                                                -- RB9
    CHECK (ket_thuc_luc IS NULL OR ket_thuc_luc >= bat_dau_luc),                        -- RB9
    CHECK ((trang_thai IN ('hoan_tat', 'loi', 'huy')) = (ket_thuc_luc IS NOT NULL)),    -- RB9
    CHECK ((trang_thai = 'loi') = (thong_bao_loi IS NOT NULL))                          -- RB9
);
-- RB19: tối đa một lần lập chỉ mục đang chạy.
CREATE UNIQUE INDEX uq_lan_dang_chay ON lan_lap_chi_muc (ma_du_an)
    WHERE trang_thai IN ('cho', 'cau_truc', 'phan_giai');

-- 3. TEP -----------------------------------------------------------------
CREATE TABLE tep (
    ma_tep              INTEGER PRIMARY KEY,
    duong_dan_tuong_doi TEXT    NOT NULL UNIQUE                                         -- RB14
                          CHECK (length(duong_dan_tuong_doi) BETWEEN 1 AND 1024
                                 AND duong_dan_tuong_doi NOT LIKE '/%'
                                 AND instr(duong_dan_tuong_doi, char(92)) = 0),         -- RB3
    ngon_ngu            TEXT    NOT NULL CHECK (length(ngon_ngu) BETWEEN 1 AND 20),
    kich_thuoc          INTEGER NOT NULL CHECK (kich_thuoc >= 0),                       -- RB3
    mtime               INTEGER NOT NULL,
    ma_bam              TEXT    NOT NULL CHECK (length(ma_bam) = 64
                                 AND ma_bam NOT GLOB '*[^0-9a-f]*'),                    -- RB3
    la_kiem_thu         INTEGER NOT NULL DEFAULT 0 CHECK (la_kiem_thu IN (0, 1)),
    la_tep_sinh_tu_dong INTEGER NOT NULL DEFAULT 0 CHECK (la_tep_sinh_tu_dong IN (0, 1)),
    ma_lan              INTEGER NOT NULL REFERENCES lan_lap_chi_muc (ma_lan)
);
CREATE INDEX idx_tep_lan ON tep (ma_lan);
CREATE INDEX idx_tep_ngon_ngu ON tep (ngon_ngu);

-- 4. LOI_PHAN_TICH -------------------------------------------------------
CREATE TABLE loi_phan_tich (
    ma_loi   INTEGER PRIMARY KEY,
    ma_tep   INTEGER NOT NULL REFERENCES tep (ma_tep) ON DELETE CASCADE,
    loai     TEXT    NOT NULL CHECK (loai IN
                 ('parse_partial', 'parse_unusable', 'read', 'extract', 'oversized')),  -- RB4
    chi_tiet TEXT,
    UNIQUE (ma_tep, loai)                                                               -- RB17
);

-- 5. KHOI_KIEN_TRUC (chỉ lưu khối cộng đồng) -----------------------------
CREATE TABLE khoi_kien_truc (
    ma_khoi     INTEGER PRIMARY KEY,
    ten         TEXT    NOT NULL CHECK (length(ten) BETWEEN 1 AND 200),
    ma_khoi_cha INTEGER REFERENCES khoi_kien_truc (ma_khoi) ON DELETE SET NULL,
    do_gan_ket  REAL    CHECK (do_gan_ket IS NULL OR do_gan_ket BETWEEN 0 AND 1),       -- RB5
    mo_ta       TEXT,
    nguon_mo_ta TEXT    CHECK (nguon_mo_ta IN ('mau', 'ai')),                           -- RB5
    CHECK ((mo_ta IS NULL) = (nguon_mo_ta IS NULL)),                                    -- RB13
    CHECK (ma_khoi_cha IS NULL OR ma_khoi_cha <> ma_khoi)                               -- RB20
);
-- RB20: phân cấp là cây (không có chu trình qua khối cha).
CREATE TRIGGER trg_khoi_khong_chu_trinh_u BEFORE UPDATE OF ma_khoi_cha ON khoi_kien_truc
WHEN NEW.ma_khoi_cha IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'RB20: phan cap khoi co chu trinh')
    WHERE EXISTS (
        WITH RECURSIVE anc(id) AS (
            SELECT NEW.ma_khoi_cha
            UNION
            SELECT k.ma_khoi_cha FROM khoi_kien_truc k JOIN anc ON k.ma_khoi = anc.id
            WHERE k.ma_khoi_cha IS NOT NULL
        )
        SELECT 1 FROM anc WHERE id = NEW.ma_khoi
    );
END;

-- 6. NUT -----------------------------------------------------------------
CREATE TABLE nut (
    ma_nut        INTEGER PRIMARY KEY,
    id_nut        TEXT    NOT NULL UNIQUE CHECK (length(id_nut) BETWEEN 1 AND 2048),    -- RB15
    loai_nut      TEXT    NOT NULL CHECK (loai_nut IN
                      ('repository', 'package', 'directory', 'file', 'module', 'class', 'mixin',
                       'enum', 'extension', 'function', 'method', 'test', 'widget', 'screen',
                       'route', 'document', 'concept')),                                -- RB6
    nhan          TEXT    NOT NULL CHECK (length(nhan) BETWEEN 1 AND 255),
    ten_day_du    TEXT    NOT NULL CHECK (length(ten_day_du) BETWEEN 1 AND 1024),
    dong_bat_dau  INTEGER,
    dong_ket_thuc INTEGER,
    la_kiem_thu   INTEGER NOT NULL DEFAULT 0 CHECK (la_kiem_thu IN (0, 1)),
    nguon_goc     TEXT    NOT NULL CHECK (nguon_goc IN ('ast', 'resolver', 'llm')),     -- RB6
    chu_ky        TEXT    CHECK (chu_ky IS NULL OR length(chu_ky) <= 2000),
    tai_lieu      TEXT,
    ma_tep        INTEGER REFERENCES tep (ma_tep) ON DELETE CASCADE,
    ma_khoi       INTEGER REFERENCES khoi_kien_truc (ma_khoi) ON DELETE SET NULL,
    CHECK (dong_bat_dau IS NULL OR dong_ket_thuc IS NULL OR dong_ket_thuc >= dong_bat_dau),
    CHECK (loai_nut NOT IN ('class', 'mixin', 'enum', 'extension', 'function', 'method',
                            'test', 'widget', 'screen', 'route')
           OR (dong_bat_dau IS NOT NULL AND dong_ket_thuc IS NOT NULL
               AND dong_bat_dau >= 1 AND dong_ket_thuc >= dong_bat_dau)),               -- RB10
    CHECK ((ma_tep IS NULL) = (loai_nut IN ('repository', 'directory'))),               -- RB11
    CHECK (loai_nut <> 'test' OR la_kiem_thu = 1)                                       -- RB11
);
CREATE INDEX idx_nut_tep  ON nut (ma_tep, dong_bat_dau);
CREATE INDEX idx_nut_loai ON nut (loai_nut);
CREATE INDEX idx_nut_khoi ON nut (ma_khoi);
CREATE INDEX idx_nut_nhan ON nut (nhan);

-- Tìm kiếm toàn văn: không là quan hệ của mô hình. Bộ lập chỉ mục nạp từ khóa đã tách camelCase.
CREATE VIRTUAL TABLE nut_fts USING fts5 (nhan, ten_day_du, chu_ky, tai_lieu, tu_khoa,
                                         content = '', contentless_delete = 1);
CREATE TRIGGER trg_nut_fts_xoa AFTER DELETE ON nut
BEGIN DELETE FROM nut_fts WHERE rowid = OLD.ma_nut; END;

-- 7. CANH ----------------------------------------------------------------
CREATE TABLE canh (
    ma_canh         INTEGER PRIMARY KEY,
    ma_nut_nguon    INTEGER NOT NULL REFERENCES nut (ma_nut) ON DELETE CASCADE,
    ma_nut_dich     INTEGER NOT NULL REFERENCES nut (ma_nut) ON DELETE CASCADE,
    loai_canh       TEXT    NOT NULL CHECK (loai_canh IN
                        ('CONTAINS', 'DEFINES', 'CALLS', 'IMPORTS', 'INHERITS', 'IMPLEMENTS',
                         'REFERENCES', 'USES_TYPE', 'TESTED_BY', 'DOCUMENTS', 'DEPENDS_ON',
                         'SEMANTIC_RELATED', 'COMPOSES', 'NAVIGATES_TO')),             -- RB7
    loai_con        TEXT    CHECK (loai_con IS NULL OR length(loai_con) <= 50),
    muc_tin_cay     TEXT    NOT NULL CHECK (muc_tin_cay IN
                        ('EXTRACTED', 'INFERRED', 'AMBIGUOUS')),                        -- RB7
    diem_tin_cay    REAL    NOT NULL CHECK (diem_tin_cay BETWEEN 0 AND 1),              -- RB7
    nguon_goc       TEXT    NOT NULL CHECK (nguon_goc IN ('ast', 'resolver', 'llm')),   -- RB7
    dong_bang_chung INTEGER CHECK (dong_bang_chung IS NULL OR dong_bang_chung >= 1),
    cot_bang_chung  INTEGER CHECK (cot_bang_chung IS NULL OR cot_bang_chung >= 0),
    CHECK (cot_bang_chung IS NULL OR dong_bang_chung IS NOT NULL),                      -- RB12
    CHECK (loai_canh NOT IN ('CALLS', 'IMPORTS', 'INHERITS', 'IMPLEMENTS', 'REFERENCES',
                             'USES_TYPE', 'COMPOSES', 'NAVIGATES_TO')
           OR dong_bang_chung IS NOT NULL)                                              -- RB12
);
-- RB16: không có hai cạnh trùng; rỗng được so như -1 (SQLite coi mỗi NULL là khác nhau).
CREATE UNIQUE INDEX uq_canh ON canh (ma_nut_nguon, ma_nut_dich, loai_canh,
                                     ifnull(dong_bang_chung, -1), ifnull(cot_bang_chung, -1));
CREATE INDEX idx_canh_nguon ON canh (ma_nut_nguon, loai_canh);
CREATE INDEX idx_canh_dich  ON canh (ma_nut_dich, loai_canh);

-- RB22: dòng bằng chứng nằm trong khoảng dòng của nút nguồn (khi nút nguồn có khoảng dòng).
CREATE TRIGGER trg_canh_bang_chung_i BEFORE INSERT ON canh
WHEN NEW.dong_bang_chung IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'RB22: dong bang chung ngoai khoang dong cua nut nguon')
    FROM nut WHERE ma_nut = NEW.ma_nut_nguon AND dong_bat_dau IS NOT NULL
      AND (NEW.dong_bang_chung < dong_bat_dau OR NEW.dong_bang_chung > dong_ket_thuc);
END;
CREATE TRIGGER trg_canh_bang_chung_u BEFORE UPDATE OF dong_bang_chung, ma_nut_nguon ON canh
WHEN NEW.dong_bang_chung IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'RB22: dong bang chung ngoai khoang dong cua nut nguon')
    FROM nut WHERE ma_nut = NEW.ma_nut_nguon AND dong_bat_dau IS NOT NULL
      AND (NEW.dong_bang_chung < dong_bat_dau OR NEW.dong_bang_chung > dong_ket_thuc);
END;
CREATE TRIGGER trg_nut_khoang_dong_u BEFORE UPDATE OF dong_bat_dau, dong_ket_thuc ON nut
WHEN NEW.dong_bat_dau IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'RB22: khoang dong moi khong chua het bang chung cua cac canh xuat phat tu nut')
    FROM canh WHERE ma_nut_nguon = NEW.ma_nut AND dong_bang_chung IS NOT NULL
      AND (dong_bang_chung < NEW.dong_bat_dau OR dong_bang_chung > NEW.dong_ket_thuc);
END;

-- 8. THAM_CHIEU_CHUA_PHAN_GIAI -------------------------------------------
CREATE TABLE tham_chieu_chua_phan_giai (
    ma_tc           INTEGER PRIMARY KEY,
    ma_nut_nguon    INTEGER NOT NULL REFERENCES nut (ma_nut) ON DELETE CASCADE,
    ten_tham_chieu  TEXT    NOT NULL CHECK (length(ten_tham_chieu) BETWEEN 1 AND 500),
    loai_tham_chieu TEXT    NOT NULL CHECK (loai_tham_chieu IN
                        ('CONTAINS', 'DEFINES', 'CALLS', 'IMPORTS', 'INHERITS', 'IMPLEMENTS',
                         'REFERENCES', 'USES_TYPE', 'TESTED_BY', 'DOCUMENTS', 'DEPENDS_ON',
                         'SEMANTIC_RELATED', 'COMPOSES', 'NAVIGATES_TO')),             -- RB8
    dong            INTEGER NOT NULL CHECK (dong >= 1),                                 -- RB8
    cot             INTEGER NOT NULL CHECK (cot >= 0),                                  -- RB8
    trang_thai      TEXT    NOT NULL DEFAULT 'cho' CHECK (trang_thai IN ('cho', 'that_bai')),
    UNIQUE (ma_nut_nguon, ten_tham_chieu, loai_tham_chieu, dong, cot)                   -- RB18
);
-- Đoạn sau dấu chấm cuối của tên tham chiếu (thay cho cột duoi_ten đã bỏ khi chuẩn hóa).
CREATE INDEX idx_tc_duoi_ten ON tham_chieu_chua_phan_giai (
    substr(ten_tham_chieu, length(rtrim(ten_tham_chieu, replace(ten_tham_chieu, '.', ''))) + 1))
    WHERE trang_thai = 'that_bai';

-- Khung nhìn thay cho dữ liệu suy ra ------------------------------------
-- Cấp của khối (cột cap đã bỏ khi chuẩn hóa).
CREATE VIEW v_khoi_cap AS
WITH RECURSIVE t(ma_khoi, cap) AS (
    SELECT ma_khoi, 0 FROM khoi_kien_truc WHERE ma_khoi_cha IS NULL
    UNION ALL
    SELECT k.ma_khoi, t.cap + 1 FROM khoi_kien_truc k JOIN t ON k.ma_khoi_cha = t.ma_khoi
)
SELECT ma_khoi, cap FROM t;

-- Tệp chứa bằng chứng của cạnh = tệp của nút nguồn (không lưu thành cột).
CREATE VIEW v_canh_bang_chung AS
SELECT c.ma_canh, c.loai_canh, c.ma_nut_nguon, c.ma_nut_dich,
       t.duong_dan_tuong_doi AS tep_bang_chung, c.dong_bang_chung, c.cot_bang_chung
FROM canh c
JOIN nut n ON n.ma_nut = c.ma_nut_nguon
LEFT JOIN tep t ON t.ma_tep = n.ma_tep;
