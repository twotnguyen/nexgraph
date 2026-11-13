-- Nâng graph.db từ phiên bản 2 lên 3 (chỉ cộng thêm): lan_lap_chi_muc.mau_bo_qua (F10, tuỳ chọn index bỏ qua thư mục).
ALTER TABLE lan_lap_chi_muc ADD COLUMN mau_bo_qua TEXT
    CHECK (mau_bo_qua IS NULL OR length(mau_bo_qua) BETWEEN 2 AND 20000);

UPDATE du_an SET phien_ban_schema = 3;
PRAGMA user_version = 3;
