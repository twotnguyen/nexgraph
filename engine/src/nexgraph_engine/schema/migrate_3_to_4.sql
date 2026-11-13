-- Nâng graph.db từ phiên bản 3 lên 4 (chỉ cộng thêm): tuỳ chọn index gồm tài liệu / audio-video (F10 mục 6a).
ALTER TABLE lan_lap_chi_muc ADD COLUMN gom_tai_lieu INTEGER NOT NULL DEFAULT 0 CHECK (gom_tai_lieu IN (0, 1));
ALTER TABLE lan_lap_chi_muc ADD COLUMN gom_media INTEGER NOT NULL DEFAULT 0 CHECK (gom_media IN (0, 1));

UPDATE du_an SET phien_ban_schema = 4;
PRAGMA user_version = 4;
