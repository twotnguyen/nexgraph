-- NexGraph: CSDL cá nhân (thư mục dữ liệu của ứng dụng, app.db).
-- Lược đồ theo docs/superpowers/specs/2026-10-24-nexgraph-csdl-chuan-hoa.md.
-- Mỗi kết nối phải chạy: PRAGMA foreign_keys = ON;
-- Khóa API KHÔNG nằm trong CSDL này; chỉ lưu tên mục trong kho khóa hệ điều hành (muc_keychain).

PRAGMA user_version = 1;

-- 9. DU_AN_DA_MO ---------------------------------------------------------
CREATE TABLE du_an_da_mo (
    ma_du_an            TEXT    NOT NULL PRIMARY KEY CHECK (length(ma_du_an) = 36),
    duong_dan_tuyet_doi TEXT    NOT NULL UNIQUE CHECK (length(duong_dan_tuyet_doi) <= 2048
                            AND (duong_dan_tuyet_doi GLOB '/*'
                                 OR duong_dan_tuyet_doi GLOB '[A-Za-z]:[/\]*'
                                 OR duong_dan_tuyet_doi GLOB '[\][\]*')),               -- RB24
    ten                 TEXT    NOT NULL CHECK (length(ten) BETWEEN 1 AND 255),
    noi_luu             TEXT    NOT NULL CHECK (noi_luu IN ('trong_du_an', 'thu_muc_app')), -- RB24
    mo_lan_cuoi         INTEGER NOT NULL
);

-- 10. KET_NOI_AI ---------------------------------------------------------
CREATE TABLE ket_noi_ai (
    ma_ket_noi   INTEGER PRIMARY KEY,
    loai         TEXT    NOT NULL CHECK (loai IN ('acp', 'api_key')),
    ten_hien_thi TEXT    NOT NULL CHECK (length(ten_hien_thi) BETWEEN 1 AND 100),
    ten_agent    TEXT    CHECK (ten_agent IS NULL OR length(ten_agent) <= 50),
    base_url     TEXT    CHECK (base_url IS NULL OR length(base_url) <= 2048),
    ten_model    TEXT    CHECK (ten_model IS NULL OR length(ten_model) <= 100),
    muc_keychain TEXT    CHECK (muc_keychain IS NULL OR length(muc_keychain) <= 100),
    la_mac_dinh  INTEGER NOT NULL DEFAULT 0 CHECK (la_mac_dinh IN (0, 1)),
    CHECK (loai <> 'acp' OR ten_agent IS NOT NULL),                                     -- RB25
    CHECK (loai <> 'api_key' OR (base_url IS NOT NULL AND ten_model IS NOT NULL
                                 AND muc_keychain IS NOT NULL))                         -- RB25
);
-- RB26: tối đa một kết nối mặc định.
CREATE UNIQUE INDEX uq_ket_noi_mac_dinh ON ket_noi_ai (la_mac_dinh) WHERE la_mac_dinh = 1;

-- 11. DONG_Y_GUI_DU_LIEU -------------------------------------------------
CREATE TABLE dong_y_gui_du_lieu (
    ma_du_an   TEXT    NOT NULL REFERENCES du_an_da_mo (ma_du_an) ON DELETE CASCADE,
    ma_ket_noi INTEGER NOT NULL REFERENCES ket_noi_ai (ma_ket_noi) ON DELETE CASCADE,
    dong_y_luc INTEGER NOT NULL,
    PRIMARY KEY (ma_du_an, ma_ket_noi)
);

-- 12. PHIEN_CHAT ---------------------------------------------------------
CREATE TABLE phien_chat (
    ma_phien     INTEGER PRIMARY KEY,
    ma_du_an     TEXT    NOT NULL REFERENCES du_an_da_mo (ma_du_an) ON DELETE CASCADE,
    ma_ket_noi   INTEGER REFERENCES ket_noi_ai (ma_ket_noi) ON DELETE SET NULL,
    tieu_de      TEXT    NOT NULL CHECK (length(tieu_de) BETWEEN 1 AND 200),
    tao_luc      INTEGER NOT NULL,
    cap_nhat_luc INTEGER NOT NULL,
    CHECK (cap_nhat_luc >= tao_luc)                                                     -- RB27
);
CREATE INDEX idx_phien_du_an ON phien_chat (ma_du_an, cap_nhat_luc DESC);

-- 13. TIN_NHAN -----------------------------------------------------------
CREATE TABLE tin_nhan (
    ma_tin   INTEGER PRIMARY KEY,
    ma_phien INTEGER NOT NULL REFERENCES phien_chat (ma_phien) ON DELETE CASCADE,
    thu_tu   INTEGER NOT NULL CHECK (thu_tu >= 1),                                      -- RB28
    vai_tro  TEXT    NOT NULL CHECK (vai_tro IN ('nguoi_dung', 'tro_ly')),              -- RB28
    noi_dung TEXT    NOT NULL,
    tao_luc  INTEGER NOT NULL,
    UNIQUE (ma_phien, thu_tu)                                                           -- RB28
);
-- RB28: thứ tự trong phiên liên tục từ 1.
CREATE TRIGGER trg_tin_nhan_lien_tuc BEFORE INSERT ON tin_nhan
WHEN NEW.thu_tu <> (SELECT coalesce(max(thu_tu), 0) + 1 FROM tin_nhan WHERE ma_phien = NEW.ma_phien)
BEGIN SELECT RAISE(ABORT, 'RB28: thu tu tin nhan phai lien tuc tu 1'); END;

-- 14. TRICH_DAN ----------------------------------------------------------
CREATE TABLE trich_dan (
    ma_trich_dan        INTEGER PRIMARY KEY,
    ma_tin              INTEGER NOT NULL REFERENCES tin_nhan (ma_tin) ON DELETE CASCADE,
    duong_dan_tuong_doi TEXT    NOT NULL CHECK (length(duong_dan_tuong_doi) BETWEEN 1 AND 1024),
    dong_bat_dau        INTEGER NOT NULL CHECK (dong_bat_dau >= 1),                     -- RB29
    dong_ket_thuc       INTEGER NOT NULL,
    trang_thai          TEXT    NOT NULL CHECK (trang_thai IN ('da_xac_minh', 'chua_xac_minh')), -- RB29
    CHECK (dong_ket_thuc >= dong_bat_dau)                                               -- RB29
);
CREATE INDEX idx_trich_dan_tin ON trich_dan (ma_tin);

-- 15. DOAN_MA_DA_GUI -----------------------------------------------------
CREATE TABLE doan_ma_da_gui (
    ma_doan             INTEGER PRIMARY KEY,
    ma_tin              INTEGER NOT NULL REFERENCES tin_nhan (ma_tin) ON DELETE CASCADE,
    duong_dan_tuong_doi TEXT    NOT NULL CHECK (length(duong_dan_tuong_doi) BETWEEN 1 AND 1024),
    dong_bat_dau        INTEGER NOT NULL CHECK (dong_bat_dau >= 1),                     -- RB30
    dong_ket_thuc       INTEGER NOT NULL,
    ma_bam              TEXT    NOT NULL CHECK (length(ma_bam) = 64
                                 AND ma_bam NOT GLOB '*[^0-9a-f]*'),
    CHECK (dong_ket_thuc >= dong_bat_dau)                                               -- RB30
);
CREATE INDEX idx_doan_tin ON doan_ma_da_gui (ma_tin);

-- RB31: trích dẫn chỉ thuộc tin nhắn của trợ lý.
CREATE TRIGGER trg_trich_dan_vai_tro_i BEFORE INSERT ON trich_dan
BEGIN
    SELECT RAISE(ABORT, 'RB31: trich dan chi thuoc tin nhan cua tro ly')
    FROM tin_nhan WHERE ma_tin = NEW.ma_tin AND vai_tro <> 'tro_ly';
END;
CREATE TRIGGER trg_trich_dan_vai_tro_u BEFORE UPDATE OF ma_tin ON trich_dan
BEGIN
    SELECT RAISE(ABORT, 'RB31: trich dan chi thuoc tin nhan cua tro ly')
    FROM tin_nhan WHERE ma_tin = NEW.ma_tin AND vai_tro <> 'tro_ly';
END;
-- RB32: đoạn mã đã gửi chỉ thuộc tin nhắn của người dùng.
CREATE TRIGGER trg_doan_vai_tro_i BEFORE INSERT ON doan_ma_da_gui
BEGIN
    SELECT RAISE(ABORT, 'RB32: doan ma da gui chi thuoc tin nhan cua nguoi dung')
    FROM tin_nhan WHERE ma_tin = NEW.ma_tin AND vai_tro <> 'nguoi_dung';
END;
CREATE TRIGGER trg_doan_vai_tro_u BEFORE UPDATE OF ma_tin ON doan_ma_da_gui
BEGIN
    SELECT RAISE(ABORT, 'RB32: doan ma da gui chi thuoc tin nhan cua nguoi dung')
    FROM tin_nhan WHERE ma_tin = NEW.ma_tin AND vai_tro <> 'nguoi_dung';
END;
-- Không đổi vai trò của tin nhắn đang có trích dẫn hoặc đoạn mã gắn với nó.
CREATE TRIGGER trg_tin_nhan_vai_tro_u BEFORE UPDATE OF vai_tro ON tin_nhan
WHEN EXISTS (SELECT 1 FROM trich_dan WHERE ma_tin = NEW.ma_tin)
  OR EXISTS (SELECT 1 FROM doan_ma_da_gui WHERE ma_tin = NEW.ma_tin)
BEGIN SELECT RAISE(ABORT, 'RB31/RB32: tin nhan da co trich dan hoac doan ma gui'); END;

-- RB34: chỉ ghi đoạn mã đã gửi khi dự án của phiên đã đồng ý với đúng kết nối của phiên (lúc ghi).
CREATE TRIGGER trg_doan_dong_y_i BEFORE INSERT ON doan_ma_da_gui
WHEN NOT EXISTS (
    SELECT 1 FROM tin_nhan t
    JOIN phien_chat p ON p.ma_phien = t.ma_phien
    JOIN dong_y_gui_du_lieu d ON d.ma_du_an = p.ma_du_an AND d.ma_ket_noi = p.ma_ket_noi
    WHERE t.ma_tin = NEW.ma_tin)
BEGIN SELECT RAISE(ABORT, 'RB34: du an chua dong y gui du lieu toi ket noi cua phien'); END;
CREATE TRIGGER trg_doan_dong_y_u BEFORE UPDATE OF ma_tin ON doan_ma_da_gui
WHEN NOT EXISTS (
    SELECT 1 FROM tin_nhan t
    JOIN phien_chat p ON p.ma_phien = t.ma_phien
    JOIN dong_y_gui_du_lieu d ON d.ma_du_an = p.ma_du_an AND d.ma_ket_noi = p.ma_ket_noi
    WHERE t.ma_tin = NEW.ma_tin)
BEGIN SELECT RAISE(ABORT, 'RB34: du an chua dong y gui du lieu toi ket noi cua phien'); END;
