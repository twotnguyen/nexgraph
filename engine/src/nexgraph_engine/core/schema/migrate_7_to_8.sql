-- v8 (E10): cờ "gồm ảnh cục bộ" tách khỏi audio/video (`gom_media`).
-- Cột `gom_anh` do `_add_image_column` thêm tại chỗ (bỏ qua nếu đã có) — SQLite không ALTER được CHECK
-- trong cùng câu, và graph.sql mới đã khai cột này từ đầu.
UPDATE du_an SET phien_ban_schema = 8;
PRAGMA user_version = 8;
