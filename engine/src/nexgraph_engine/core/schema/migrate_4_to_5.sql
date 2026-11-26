CREATE TABLE luong (
    ma_luong   INTEGER PRIMARY KEY,
    ma_nut_vao INTEGER NOT NULL UNIQUE REFERENCES nut (ma_nut) ON DELETE CASCADE,
    ten        TEXT    NOT NULL CHECK (length(ten) BETWEEN 1 AND 255),
    loai_vao   TEXT    NOT NULL CHECK (loai_vao IN ('main', 'route', 'cli', 'event', 'root')),
    mo_ta_vao  TEXT    CHECK (mo_ta_vao IS NULL OR length(mo_ta_vao) <= 200),
    so_buoc    INTEGER NOT NULL CHECK (so_buoc >= 2),
    so_tep     INTEGER NOT NULL CHECK (so_tep >= 1),
    do_sau     INTEGER NOT NULL CHECK (do_sau >= 1),
    diem       REAL    NOT NULL CHECK (diem BETWEEN 0 AND 1),
    bi_cat     INTEGER NOT NULL DEFAULT 0 CHECK (bi_cat IN (0, 1))
);
CREATE INDEX idx_luong_diem ON luong (diem DESC, ma_luong);
CREATE TABLE buoc_luong (
    ma_luong INTEGER NOT NULL REFERENCES luong (ma_luong) ON DELETE CASCADE,
    thu_tu   INTEGER NOT NULL CHECK (thu_tu >= 0),
    ma_nut   INTEGER NOT NULL REFERENCES nut (ma_nut) ON DELETE CASCADE,
    do_sau   INTEGER NOT NULL CHECK (do_sau >= 0),
    ma_nut_goi      INTEGER REFERENCES nut (ma_nut) ON DELETE CASCADE,
    dong_bang_chung INTEGER,
    PRIMARY KEY (ma_luong, thu_tu),
    UNIQUE (ma_luong, ma_nut)
);
CREATE INDEX idx_buoc_nut ON buoc_luong (ma_nut);
UPDATE du_an SET phien_ban_schema = 5;
PRAGMA user_version = 5;
