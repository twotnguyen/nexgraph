-- v7 (W9, W10): bảng nhan_cum, ky_uc, bo_nho_dem_ngu_nghia (giống hệt graph.sql).
CREATE TABLE nhan_cum (
    cum_id            TEXT    NOT NULL PRIMARY KEY,
    ten               TEXT    NOT NULL CHECK (length(trim(ten)) BETWEEN 1 AND 255),
    chu_ky_thanh_vien TEXT    NOT NULL CHECK (length(chu_ky_thanh_vien) = 64),
    nguon             TEXT    NOT NULL CHECK (nguon IN ('llm', 'nguoi_dung')),
    tao_luc           INTEGER NOT NULL
);
CREATE TABLE ky_uc (
    id            INTEGER PRIMARY KEY,
    loai          TEXT    NOT NULL CHECK (loai IN ('danh_gia', 'lesson', 'decision', 'incident', 'owner')),
    noi_dung      TEXT    NOT NULL CHECK (length(trim(noi_dung)) > 0),
    node_ids_json TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(node_ids_json) AND json_type(node_ids_json) = 'array'),
    ket_qua       TEXT    CHECK (ket_qua IS NULL OR ket_qua IN ('huu_ich', 'ngo_cut', 'da_sua')),
    tao_luc       INTEGER NOT NULL,
    nguon         TEXT    NOT NULL CHECK (nguon IN ('nguoi_dung', 'tro_ly', 'mcp')),
    CHECK ((loai = 'danh_gia') = (ket_qua IS NOT NULL))
);
CREATE INDEX idx_ky_uc_loai ON ky_uc (loai, tao_luc);
CREATE TABLE bo_nho_dem_ngu_nghia (
    khoa         TEXT    NOT NULL PRIMARY KEY CHECK (length(khoa) = 64),
    ket_qua_json TEXT    NOT NULL CHECK (json_valid(ket_qua_json)),
    tao_luc      INTEGER NOT NULL
);
UPDATE du_an SET phien_ban_schema = 7;
PRAGMA user_version = 7;
