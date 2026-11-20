-- v3 (W9): bảng ai_theo_du_an (giống hệt app.sql).
CREATE TABLE ai_theo_du_an (
    ma_du_an     TEXT    NOT NULL PRIMARY KEY REFERENCES du_an_da_mo (ma_du_an) ON DELETE CASCADE,
    bat          INTEGER NOT NULL DEFAULT 0 CHECK (bat IN (0, 1)),
    kieu_ket_noi TEXT    CHECK (kieu_ket_noi IS NULL OR kieu_ket_noi IN ('direct', 'app')),
    ten_model    TEXT    CHECK (ten_model IS NULL OR length(ten_model) <= 200)
);
PRAGMA user_version = 3;
