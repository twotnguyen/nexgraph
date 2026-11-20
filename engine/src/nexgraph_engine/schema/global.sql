-- NexGraph: graph chung nhiều repo (<data_dir>/global.db, W8). Chỉ tham chiếu (ma_du_an, id_nut), không chép nút.
-- Mỗi kết nối phải chạy: PRAGMA foreign_keys = ON;

PRAGMA user_version = 1;

-- Dự án trong graph chung (ma_du_an là id ở app.db / du_an của graph.db).
CREATE TABLE du_an_chung (
    ma_du_an TEXT    NOT NULL PRIMARY KEY CHECK (length(ma_du_an) = 36),
    them_luc INTEGER NOT NULL
);

-- Cạnh liên repo, tính lại toàn bộ mỗi lần một thành viên index xong. Gỡ thành viên thì cạnh của nó mất theo.
CREATE TABLE canh_lien_repo (
    ma_canh         INTEGER PRIMARY KEY,
    du_an_nguon     TEXT    NOT NULL REFERENCES du_an_chung (ma_du_an) ON DELETE CASCADE,
    id_nut_nguon    TEXT    NOT NULL CHECK (length(id_nut_nguon) BETWEEN 1 AND 2048),
    du_an_dich      TEXT    NOT NULL REFERENCES du_an_chung (ma_du_an) ON DELETE CASCADE,
    id_nut_dich     TEXT    NOT NULL CHECK (length(id_nut_dich) BETWEEN 1 AND 2048),
    loai_canh       TEXT    NOT NULL CHECK (loai_canh IN ('CALLS', 'REFERENCES')),
    loai_con        TEXT    NOT NULL CHECK (loai_con IN ('member_call', 'import_symbol', 'same_type_as')),
    muc_tin_cay     TEXT    NOT NULL DEFAULT 'INFERRED' CHECK (muc_tin_cay = 'INFERRED'),
    diem_tin_cay    REAL    NOT NULL CHECK (diem_tin_cay BETWEEN 0 AND 1),
    tep_bang_chung  TEXT,
    dong_bang_chung INTEGER CHECK (dong_bang_chung IS NULL OR dong_bang_chung >= 1),
    CHECK (du_an_nguon <> du_an_dich),
    UNIQUE (du_an_nguon, id_nut_nguon, du_an_dich, id_nut_dich, loai_canh)
);
CREATE INDEX idx_clr_dich ON canh_lien_repo (du_an_dich, id_nut_dich);
