"""Dò điểm vào (entry points) cho các luồng thực thi (F11)."""
from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path

MAIN_NAME_RE = re.compile(r"^(main|__main__|bootstrap|lambda_handler|handler)$")
ROUTE_RE = re.compile(
    r"^@?\w*\.?(get|post|put|delete|patch|route|all)\b|^@(Get|Post|Put|Delete|Patch|All|RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping)\b",
    re.IGNORECASE,
)
CLI_RE = re.compile(r"^@\w*\.?(command|group)\b|^@click\.")
EVENT_RE = re.compile(
    r"^@(Subscribe|SubscribeMessage|EventPattern|MessagePattern|OnEvent|Cron|Interval|KafkaListener|\w+\.(task|on_event|middleware|exception_handler))\b"
)
EVENT_NAME_RE = re.compile(r"^(on_|handle_|on[A-Z])")


@dataclass(frozen=True)
class EntryPoint:
    pk: int
    node_id: str
    label: str
    qualified_name: str
    kind: str
    detail: str | None


def decorators_above(lines: list[str], line_start: int) -> list[str]:
    """Các dòng decorator đã strip, gần hàm nhất đứng trước, tối đa 6 dòng.
    
    Dừng ở dòng đầu tiên không bắt đầu bằng @ và không rỗng, hoặc dòng rỗng.
    """
    out: list[str] = []
    for idx in range(line_start - 2, -1, -1):
        if idx >= len(lines):
            continue
        line = lines[idx].strip()
        if not line or not line.startswith("@"):
            break
        out.append(line)
        if len(out) == 6:
            break
    return out


def detect_entry_points(conn: sqlite3.Connection, root: Path, *, only_temp_pks: bool = False) -> list[EntryPoint]:
    """Dò các điểm vào từ đồ thị và tệp nguồn, sắp theo node_id. `only_temp_pks`: chỉ xét các nút có khoá trong temp._pks."""
    sql = """
    SELECT n.ma_nut, n.id_nut, n.nhan, n.ten_day_du, n.dong_bat_dau, t.duong_dan_tuong_doi AS file,
           EXISTS (
               SELECT 1 FROM canh c_in
               JOIN nut nc ON nc.ma_nut = c_in.ma_nut_nguon
               WHERE c_in.loai_canh = 'CALLS'
                 AND c_in.ma_nut_dich = n.ma_nut
                 AND nc.loai_nut IN ('function', 'method')
                 AND nc.la_kiem_thu = 0
           ) AS has_caller
    FROM nut n
    JOIN tep t ON t.ma_tep = n.ma_tep
    WHERE n.loai_nut IN ('function', 'method')
      AND n.la_kiem_thu = 0
      AND n.nhan NOT IN ('constructor', '__init__')
      AND EXISTS (
          SELECT 1 FROM canh c_out
          JOIN nut nd ON nd.ma_nut = c_out.ma_nut_dich
          WHERE c_out.loai_canh = 'CALLS'
            AND c_out.ma_nut_nguon = n.ma_nut
            AND nd.loai_nut IN ('function', 'method')
            AND nd.la_kiem_thu = 0
      )
    """
    if only_temp_pks:
        sql += " AND n.ma_nut IN (SELECT pk FROM temp._pks)"
    candidates = conn.execute(sql).fetchall()

    # Gom theo tệp để chỉ đọc mỗi tệp một lần
    by_file: dict[str, list[sqlite3.Row]] = {}
    for c in candidates:
        by_file.setdefault(c["file"], []).append(c)

    file_lines: dict[str, list[str]] = {}
    for rel_path in by_file:
        full_path = root / rel_path
        if full_path.is_file():
            try:
                file_lines[rel_path] = full_path.read_text(encoding="utf-8", errors="replace").splitlines()
            except OSError:
                file_lines[rel_path] = []
        else:
            file_lines[rel_path] = []

    out: list[EntryPoint] = []
    for c in candidates:
        lines = file_lines.get(c["file"], [])
        decs = decorators_above(lines, c["dong_bat_dau"]) if c["dong_bat_dau"] else []
        label = c["nhan"]
        # Nhãn nút của pipeline vendor có `()` (`main()`); luật đặt tên khớp theo tên trần như đường cũ.
        name = label[:-2] if label.endswith("()") else label

        kind: str | None = None
        detail: str | None = None

        # 1. main
        if MAIN_NAME_RE.match(name):
            kind = "main"
            detail = None
        # 2. route
        elif dec := next((d for d in decs if ROUTE_RE.search(d)), None):
            kind = "route"
            detail = dec.lstrip("@").strip()[:200]
        # 3. cli
        elif dec := next((d for d in decs if CLI_RE.search(d)), None):
            kind = "cli"
            detail = dec.lstrip("@").strip()[:200]
        # 4. event
        elif (dec := next((d for d in decs if EVENT_RE.search(d)), None)) or EVENT_NAME_RE.match(name):
            kind = "event"
            detail = dec.lstrip("@").strip()[:200] if dec else None
        # 5. root
        elif not c["has_caller"]:
            kind = "root"
            detail = None

        if kind is not None:
            out.append(
                EntryPoint(
                    pk=c["ma_nut"],
                    node_id=c["id_nut"],
                    label=c["nhan"],
                    qualified_name=c["ten_day_du"],
                    kind=kind,
                    detail=detail,
                )
            )

    out.sort(key=lambda e: e.node_id)
    return out
