"""Danh sách PR mở: phân loại bằng chính hàm của graphify (`_parse_pr_dict` -> `PRInfo.status`), xung đột theo tệp
và theo vùng ảnh hưởng trên đồ thị, triage tất định giống tool MCP `triage_prs` của graphify (`serve.py:3363`)."""
from __future__ import annotations

import json
from datetime import timezone
from itertools import combinations
from pathlib import Path

from graphify.prs import _PR_JSON_FIELDS, _STATUS_ORDER, PRInfo, _parse_pr_dict

from nexgraph_engine.changes.model import ChangeSet, FileChange
from nexgraph_engine.impact.analyze import map_to_nodes, propagate
from nexgraph_engine.prs import gh
from nexgraph_engine.store.graph_store import GraphStore

FIELDS = _PR_JSON_FIELDS + ",url"
MAX_LIST = 100
_ACTIONS = {
    "CI-FAIL": "Sửa CI trước khi review",
    "CHANGES-REQ": "Chờ tác giả sửa theo nhận xét",
    "DRAFT": "Bản nháp, chưa cần review",
    "APPROVED": "Đã được duyệt, có thể merge",
    "PENDING": "CI đang chạy, review được ngay",
    "READY": "Sẵn sàng review",
}


def _json(root: Path, args: list[str]):
    try:
        return json.loads(gh.run_gh(root, args))
    except json.JSONDecodeError:
        raise gh.GhError("gh_failed", "đầu ra không phải JSON") from None


def repo_info(root: Path) -> dict:
    data = _json(root, ["repo", "view", "--json", "nameWithOwner,defaultBranchRef"])
    return {"repo": data.get("nameWithOwner"),
            "default_branch": (data.get("defaultBranchRef") or {}).get("name") or "main"}


def gh_status(root: Path) -> dict:
    """Tab Pull request chỉ hiện khi `available`: có `gh`, đã đăng nhập và repo có remote GitHub."""
    try:
        info = repo_info(root)
    except gh.GhError as exc:
        return {"available": False, "reason": exc.code, "repo": None, "default_branch": None}
    return {"available": True, "reason": None, **info}


def pr_json(pr: PRInfo, url: str | None = None) -> dict:
    return {"number": pr.number, "title": pr.title, "branch": pr.branch, "base": pr.base_branch,
            "author": pr.author, "draft": pr.is_draft, "review": pr.review_decision or None, "ci": pr.ci_status,
            "updated_at": pr.updated_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "days_old": pr.days_old, "status": pr.status, "url": url}


def footprint(store: GraphStore, files: list[str]) -> set[str]:
    """Id nút của cả tệp đổi cộng vùng ảnh hưởng (chỉ dùng để so hai PR, nên lấy cả tệp thay vì từng dòng)."""
    changed = map_to_nodes(store.conn, ChangeSet("git_head", None, [FileChange(f, "M") for f in files]))
    seeds = [n.id for n in changed] + [f"{f}#file" for f in sorted({n.file for n in changed if n.file})]
    impacted, _ = propagate(store.conn, seeds) if seeds else ([], False)
    return {n.id for n in changed} | {i.node.id for i in impacted}


def list_prs_json(store: GraphStore, root: Path, limit: int = 50) -> dict:
    limit = max(1, min(limit, MAX_LIST))
    info = repo_info(root)
    base = info["default_branch"]
    raw = _json(root, ["pr", "list", "--state", "open", "--limit", str(limit), "--json", FIELDS + ",files"])
    prs, marks = [], {}
    for item in raw if isinstance(raw, list) else []:
        pr = _parse_pr_dict(item, base)
        files = sorted({f.get("path") for f in item.get("files") or [] if f.get("path")})
        nodes = footprint(store, files)
        prs.append({**pr_json(pr, item.get("url")), "files": files, "nodes_affected": len(nodes)})
        marks[pr.number] = (set(files), nodes)
    conflicts = []
    for a, b in combinations([p for p in prs if p["status"] != "WRONG-BASE"], 2):
        files = marks[a["number"]][0] & marks[b["number"]][0]
        nodes = marks[a["number"]][1] & marks[b["number"]][1]
        if files or nodes:
            conflicts.append({"a": a["number"], "b": b["number"], "files": sorted(files)[:20], "nodes": len(nodes)})
    conflicts.sort(key=lambda c: (-len(c["files"]), -c["nodes"], c["a"], c["b"]))
    return {**info, "base": base, "prs": prs, "conflicts": conflicts, "truncated": len(prs) >= limit}


def triage_json(listing: dict) -> dict:
    """Xếp hàng review theo luật, không gọi LLM. Bỏ PR sai nhánh gốc và PR cũ như graphify."""
    ranked = sorted((p for p in listing["prs"] if p["status"] not in ("WRONG-BASE", "STALE")),
                    key=lambda p: (_STATUS_ORDER.index(p["status"]), p["nodes_affected"], p["number"]))
    return {"base": listing["base"], "method": "rules", "skipped": len(listing["prs"]) - len(ranked),
            "ranked": [{"number": p["number"], "title": p["title"], "status": p["status"], "ci": p["ci"],
                        "review": p["review"], "days_old": p["days_old"], "author": p["author"],
                        "nodes_affected": p["nodes_affected"], "action": _ACTIONS[p["status"]]} for p in ranked]}


def triage_prompt(triage: dict) -> str:
    """Điểm móc cho job `semantic` với `targets="pr_triage"` (W9): prompt giống `triage_with_opus` của graphify.
    Engine không tự gọi LLM ở đây."""
    lines = [f"PR #{p['number']} [{p['status']}] CI={p['ci']} review={p['review'] or 'none'} age={p['days_old']}d "
             f"author={p['author']} blast_radius={p['nodes_affected']} nodes\n  title: {p['title']}"
             for p in triage["ranked"]]
    return ("You are a senior engineer helping triage a PR review queue. Given these open PRs, rank them by review "
            "priority for the repo maintainer. For each PR give: priority number, one sentence on what action to take "
            "and why. Be direct and specific. Format each as: #<number> — <action>.\n\n" + "\n\n".join(lines))
