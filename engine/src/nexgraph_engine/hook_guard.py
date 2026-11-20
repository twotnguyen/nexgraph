"""Nhắc trợ lý AI hỏi đồ thị NexGraph trước khi đọc/tìm tệp thô (tương đương ``graphify hook-guard``).

Hook PreToolUse (Claude Code, CodeBuddy) và BeforeTool (Gemini CLI) gọi
``nexgraph-engine hook-guard read|search|gemini --project P --data-dir D [--strict]``.
Luôn fail-open: mọi lỗi đều không in gì, lệnh thoát 0, không bao giờ chặn nhầm một lần gọi tool.
Cách đánh dấu chặn một lần mỗi phiên (O_EXCL) và TTL 30 phút theo graphify ``cli.py:1131-1290`` (0.9.112, MIT).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import time
from contextlib import closing
from pathlib import Path

STAMP_TTL = 1800.0
_SAFE_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")

_NUDGE = (
    "NexGraph: dự án này có đồ thị tri thức còn mới. Tool MCP `query_graph` (câu hỏi tự do) và "
    "`get_context` (đoạn mã liên quan nhất, gọn trong ngân sách token) của server nexgraph chỉ ra "
    "tệp và dòng cần xem, thường tốn ít token hơn đọc hoặc grep tệp thô. Đọc tệp trực tiếp hiệu quả "
    "nhất sau khi đồ thị đã chỉ tới đúng dòng."
)
_DENY = (
    "NexGraph strict: đồ thị tri thức của dự án còn mới và có tệp này. Gọi tool MCP `query_graph` "
    "hoặc `get_context` của server nexgraph trước để định hướng, rồi đọc lại tệp: lần đọc sau được phép. "
    "Mỗi phiên chỉ chặn tối đa một lần."
)


def stamp_path(data_dir: Path, project_id: str) -> Path:
    return Path(data_dir) / "projects" / project_id / "last_query_stamp"


def touch_query_stamp(data_dir: Path | None, project_id: str | None) -> None:
    """MCP gọi sau ``query_graph``/``get_context``. Chỉ ghi tệp trong data_dir; thiếu thông tin thì bỏ qua."""
    if data_dir is None or not project_id or not _SAFE_ID.fullmatch(project_id):
        return
    try:
        path = stamp_path(data_dir, project_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(str(time.time()), encoding="utf-8")
    except OSError:
        pass


def _git_head(root: Path) -> str | None:
    if not (root / ".git").exists():
        return None
    from nexgraph_engine.subprocesses import run_captured
    try:
        out = run_captured(["git", "rev-parse", "HEAD"], cwd=root, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return None
    sha = out.stdout.decode("ascii", "replace").strip()
    return sha if out.returncode == 0 and 40 <= len(sha) <= 64 else None


def _fresh_project(root: Path, data_dir: Path, target: Path | None) -> str | None:
    """Id dự án khi graph còn mới với tệp đích; None khi chưa index, graph cũ hoặc vừa hỏi graph."""
    from nexgraph_engine.schema.db import open_graph_db
    from nexgraph_engine.store.graph_store import GraphStore
    from nexgraph_engine.store.projects import resolve_graph_db

    with closing(open_graph_db(resolve_graph_db(root, data_dir), read_only=True)) as conn:
        store = GraphStore(conn)
        run = store.last_completed_run() if store.has_published_graph() else None
        pid = store.project_id()
    if run is None or not pid or not _SAFE_ID.fullmatch(pid):
        return None
    # Kiểm rẻ thay cho freshness() (duyệt và băm cả cây): hook chạy ở mỗi lần gọi tool.
    head = _git_head(root)  # cùng phép như index.indexer._git_head, tránh nạp indexer (0,23 s mỗi lần gọi tool)
    if head and run[1] and head != run[1]:
        return None
    if target is not None and target.is_file() and target.stat().st_mtime > run[0]:
        return None
    try:
        if time.time() - stamp_path(data_dir, pid).stat().st_mtime < STAMP_TTL:
            return None
    except OSError:
        pass
    return pid


def _claim_deny(data_dir: Path, pid: str, session_id: str) -> bool:
    sid = re.sub(r"[^A-Za-z0-9_-]", "_", session_id)[:64]
    if not sid:
        return False
    marker = stamp_path(data_dir, pid).parent / "hook_sessions" / f"{sid}.denied"
    try:
        marker.parent.mkdir(parents=True, exist_ok=True)
        os.close(os.open(marker, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644))
        return True
    except OSError:
        return False


def _pre_tool(payload: dict) -> str:
    return json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", **payload}},
                      ensure_ascii=False, separators=(",", ":")) + "\n"


def guard_output(kind: str, project: Path, data_dir: Path | None, strict: bool, raw: bytes) -> str:
    """Nội dung in ra stdout cho hook; chuỗi rỗng nghĩa là im lặng."""
    if kind == "gemini":  # BeforeTool của Gemini phải luôn có quyết định allow
        out: dict = {"decision": "allow"}
        try:
            if data_dir is not None and _fresh_project(Path(project).resolve(), data_dir, None):
                out["additionalContext"] = _NUDGE
        except Exception:
            pass
        return json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    try:
        d = json.loads(raw.decode("utf-8"))
        if data_dir is None or not isinstance(d, dict):
            return ""
        t = d.get("tool_input", d)
        if not isinstance(t, dict):
            return ""
        tool = d.get("tool_name")
        root = Path(project).resolve()
        target: Path | None = None
        # Tệp/thư mục ngoài dự án hoặc trong .nexgraph/: đồ thị không có gì để nói.
        for value in (t.get("file_path"), t.get("path")):
            if value:
                p = Path(str(value))
                p = (p if p.is_absolute() else root / p).resolve()
                if not p.is_relative_to(root) or p.is_relative_to(root / ".nexgraph"):
                    return ""
        if kind == "search":
            command = str(t.get("command") or "")
            if command:
                from graphify.cli import _bash_invokes_search
                if not _bash_invokes_search(command):
                    return ""
            elif not t.get("pattern"):
                return ""
        elif kind == "read":
            fp = str(t.get("file_path") or "")
            if fp:
                target = Path(fp) if Path(fp).is_absolute() else root / fp
        else:
            return ""
        pid = _fresh_project(root, data_dir, target)
        if pid is None:
            return ""
        if strict and kind == "read" and tool in (None, "Read") and target is not None \
                and _claim_deny(data_dir, pid, str(d.get("session_id") or "")):
            return _pre_tool({"permissionDecision": "deny", "permissionDecisionReason": _DENY})
        return _pre_tool({"additionalContext": _NUDGE})
    except Exception:
        return ""
