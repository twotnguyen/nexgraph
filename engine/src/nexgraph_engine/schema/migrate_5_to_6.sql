-- v6 (W2): loại nút type/variable/table/resource/config_key. CHECK của nut được nới bằng _widen_node_kinds (db.py)
-- vì SQLite không ALTER được CHECK và dựng lại bảng nut sẽ chạm 7 khoá ngoại.
UPDATE du_an SET phien_ban_schema = 6;
PRAGMA user_version = 6;
