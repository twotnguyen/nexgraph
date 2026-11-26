"""`gh` giả cho test W7: trả fixture theo tiền tố argv, ghi lại mọi lời gọi. Không gọi mạng."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from nexgraph_engine.analysis.prs import gh

FIX = Path(__file__).parent / "fixtures" / "gh"


def recent() -> str:
    return (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")


def fixture(name: str) -> str:
    return (FIX / name).read_text("utf-8").replace("{RECENT}", recent())


def install(monkeypatch, responses: dict[tuple[str, ...], str | Exception]) -> list[list[str]]:
    """responses: tiền tố argv -> stdout (hoặc GhError để ném). Mặc định có `repo view` và `pr list`."""
    table = {("repo", "view"): fixture("repo_view.json"), ("pr", "list"): fixture("pr_list.json"), **responses}
    calls: list[list[str]] = []

    def run(root, args, timeout=gh.TIMEOUT):
        calls.append(list(args))
        for prefix in sorted(table, key=len, reverse=True):
            if tuple(args[:len(prefix)]) == prefix:
                out = table[prefix]
                if isinstance(out, Exception):
                    raise out
                return out
        raise gh.GhError("gh_failed", " ".join(args))

    monkeypatch.setattr(gh, "run_gh", run)
    return calls
