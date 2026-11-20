"""Cache kết quả đã kiểm trong `bo_nho_dem_ngu_nghia`. Khoá do `Chunk.key` tính (nội dung + đường dẫn + prompt)."""
from __future__ import annotations

import json
import sqlite3
import time


def get(conn: sqlite3.Connection, key: str):
    row = conn.execute("SELECT ket_qua_json FROM bo_nho_dem_ngu_nghia WHERE khoa = ?", (key,)).fetchone()
    return json.loads(row[0]) if row else None


def put(conn: sqlite3.Connection, key: str, value) -> None:
    """Caller giữ transaction: dòng cache ghi cùng lúc với kết quả của khối."""
    conn.execute("INSERT INTO bo_nho_dem_ngu_nghia (khoa, ket_qua_json, tao_luc) VALUES (?, ?, ?)"
                 " ON CONFLICT (khoa) DO UPDATE SET ket_qua_json = excluded.ket_qua_json, tao_luc = excluded.tao_luc",
                 (key, json.dumps(value, ensure_ascii=False), int(time.time())))
