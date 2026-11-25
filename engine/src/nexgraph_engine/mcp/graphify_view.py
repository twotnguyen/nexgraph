"""Lớp ``graphify_view``: nạp lười đồ thị ``.nexgraph/graph.json`` và gọi thẳng hàm vendor.

ADR 0025 mục 2: 11 tool trùng tên trong MCP ``nexgraph`` phải chạy **đúng như bản gốc**
— cùng đầu vào, cùng tham số, cùng văn bản đầu ra (sau khi đổi tên hiển thị). Vì vậy
mỗi thân hàm ở đây là bản chép 1:1 của ``_tool_*`` trong ``graphify/serve.py``
(dòng 3143–3403), gọi đúng các helper module-level của vendor; không viết lại thuật toán.

Đồ thị networkx nạp lười bằng chính ``graphify.serve._load_graph`` (kèm dựng
``communities`` như ``serve()`` làm), cache theo ``(đường dẫn, mtime_ns, size)``,
nhả sau :data:`IDLE_TTL_SECONDS` giây không dùng, có khoá luồng.

Phần NexGraph thêm (bằng chứng tệp:dòng, độ mới, vùng ảnh hưởng…) không nằm ở đây.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover - chỉ để gợi ý kiểu, không nạp networkx khi khởi động
    import networkx as nx

OUT_DIR_NAME = ".nexgraph"
GRAPH_JSON_NAME = "graph.json"
IDLE_TTL_SECONDS = 600.0

#: Cụm mẫu **do vendor sinh ra** cần đổi tên, khớp chính xác từng chuỗi — không regex, không đổi
#: id/nhãn/đường dẫn/nội dung người dùng (QA #69 finding 1). Mỗi cặp ghi rõ nguồn sinh câu.
_REBRAND_PHRASES = (
    # graphify/sections.py:148 (lý do khi heading không còn ở dòng đã ghi)
    ("Run `graphify update .` to refresh the graph.",
     "Run `nexgraph update .` to refresh the graph."),
    # graphify/sections.py:168 (ghi chú khi heading bị dời dòng)
    ("run `graphify update .` to refresh the graph.",
     "run `nexgraph update .` to refresh the graph."),
)


def rebrand_text(text: str) -> str:
    """Đổi **chỉ các cụm mẫu cố định** của vendor sang tên NexGraph (ADR 0025 mục 3).

    Không thay id, nhãn, đường dẫn tệp hay nội dung mã/tài liệu của người dùng, kể cả khi
    chúng chứa chữ "graphify" — dữ liệu phải trùng byte với bản gốc (QA #69 finding 1).
    """
    for old, new in _REBRAND_PHRASES:
        text = text.replace(old, new)
    return text


class VendorToolError(Exception):
    """Lỗi tool do vendor phát ra (``graphify.serve.ToolError``) — server đổi thành lỗi tool MCP."""


@dataclass
class LoadedGraph:
    """Đồ thị vendor đã nạp cho một ``graph.json``, kèm cộng đồng dựng từ thuộc tính nút."""

    G: "nx.Graph"
    communities: dict[int, list[str]]
    graph_path: Path
    root: Path


def graph_json_path(project: Path) -> Path:
    """``<project>/.nexgraph/graph.json`` — vị trí NexGraph lưu đồ thị kiểu vendor."""
    return Path(project) / OUT_DIR_NAME / GRAPH_JSON_NAME


class GraphView:
    """Nạp lười + cache + nhả đồ thị của **một** tệp ``graph.json``; an toàn luồng."""

    def __init__(self, graph_path: Path, *, idle_ttl: float = IDLE_TTL_SECONDS,
                 clock: Any = time.monotonic) -> None:
        self.graph_path = Path(graph_path)
        self.root = self.graph_path.parent.parent
        self._idle_ttl = float(idle_ttl)
        self._clock = clock
        self._lock = threading.RLock()
        self._entry: LoadedGraph | None = None
        self._key: tuple[int, int] | None = None
        self._last_used = 0.0
        self._timer: threading.Timer | None = None
        self.loads = 0  # số lần nạp thật (test dùng)

    # -- trạng thái ---------------------------------------------------------
    @property
    def is_loaded(self) -> bool:
        with self._lock:
            return self._entry is not None

    def release(self) -> None:
        """Nhả đồ thị ngay (test và khi tắt server)."""
        with self._lock:
            self._entry = None
            self._key = None
            timer, self._timer = self._timer, None
        if timer is not None:
            timer.cancel()

    # -- nạp ---------------------------------------------------------------
    def get(self) -> LoadedGraph | None:
        """Đồ thị đã nạp, hoặc ``None`` khi chưa có ``graph.json`` (R-N3: rơi về NexGraph)."""
        try:
            stat = self.graph_path.stat()
        except OSError:
            self.release()
            return None
        key = (stat.st_mtime_ns, stat.st_size)
        with self._lock:
            now = self._clock()
            if self._entry is not None and self._key == key:
                if now - self._last_used <= self._idle_ttl:
                    self._last_used = now
                    return self._entry
                self._drop_locked()  # quá hạn rảnh → nhả rồi nạp lại
            entry = self._load_locked()
            if entry is None:
                return None
            self._entry, self._key, self._last_used = entry, key, now
            self._arm_timer_locked()
            return entry

    def _drop_locked(self) -> None:
        self._entry = None
        self._key = None

    def _load_locked(self) -> LoadedGraph | None:
        """Nạp bằng đúng hàm vendor; lỗi tệp hỏng/thiếu → coi như chưa có đồ thị."""
        from graphify import serve as vendor_serve

        try:
            G = vendor_serve._load_graph(str(self.graph_path))
        except (SystemExit, OSError, ValueError):
            # _load_graph gọi sys.exit(1) khi tệp hỏng/thiếu: MCP không được chết theo.
            self._drop_locked()
            return None
        try:
            vendor_serve._get_trigram_index(G)  # vendor làm nóng chỉ mục ngay sau khi nạp
        except Exception:  # pragma: no cover - chỉ mục là tối ưu, không phải điều kiện đúng
            pass
        self.loads += 1
        resolved = self.graph_path.resolve()
        return LoadedGraph(G=G, communities=vendor_serve._communities_from_graph(G),
                           graph_path=resolved, root=resolved.parent.parent)

    # -- nhả sau khi rảnh ---------------------------------------------------
    def _arm_timer_locked(self) -> None:
        if self._timer is not None:
            return
        # Chỉ một hẹn giờ sống tại một thời điểm; khi bắn nó tự hẹn lại nếu còn được dùng.
        timer = threading.Timer(self._idle_ttl, self._expire)
        timer.daemon = True
        self._timer = timer
        timer.start()

    def _expire(self) -> None:
        with self._lock:
            self._timer = None
            if self._entry is None:
                return
            idle = self._clock() - self._last_used
            if idle >= self._idle_ttl:
                self._drop_locked()
                return
            delay = max(0.001, self._idle_ttl - idle)
            timer = threading.Timer(delay, self._expire)
            timer.daemon = True
            self._timer = timer
        timer.start()


_VIEWS: dict[Path, GraphView] = {}
_VIEWS_LOCK = threading.Lock()


def view_for(project: Path) -> GraphView:
    """``GraphView`` dùng chung cho một dự án (cache theo đường dẫn ``graph.json`` đã resolve)."""
    path = graph_json_path(Path(project)).resolve()
    with _VIEWS_LOCK:
        view = _VIEWS.get(path)
        if view is None:
            view = GraphView(path)
            _VIEWS[path] = view
        return view


def clear_views() -> None:
    """Nhả mọi đồ thị đã cache (test, hoặc khi engine đổi dự án)."""
    with _VIEWS_LOCK:
        views = list(_VIEWS.values())
        _VIEWS.clear()
    for view in views:
        view.release()


def load_for(project: Path) -> LoadedGraph | None:
    return view_for(project).get()


# ── 8 tool đồ thị: thân hàm chép 1:1 từ graphify/serve.py ────────────────────


def tool_query_graph(view: LoadedGraph, arguments: dict) -> str:
    """graphify/serve.py:3143–3175 ``_tool_query_graph``."""
    import time as _time

    from graphify import querylog
    from graphify.serve import _query_graph_text

    question = arguments["question"]
    mode = arguments.get("mode", "bfs")
    depth = min(int(arguments.get("depth", 3)), 6)
    budget = int(arguments.get("token_budget", 2000))
    context_filter = arguments.get("context_filter")
    demote_docs = arguments.get("demote_docs", True)
    if isinstance(demote_docs, str):
        demote_docs = demote_docs.lower() not in ("false", "0", "no")
    _t0 = _time.perf_counter()
    result = _query_graph_text(
        view.G,
        question,
        mode=mode,
        depth=depth,
        token_budget=budget,
        context_filters=context_filter,
        graph_path=str(view.graph_path),
        demote_docs=demote_docs,
    )
    querylog.log_query(
        kind="mcp_query",
        question=question,
        corpus=str(view.graph_path),
        result=result,
        mode=mode,
        depth=depth,
        token_budget=budget,
        duration_ms=(_time.perf_counter() - _t0) * 1000,
    )
    return result


def tool_get_node(view: LoadedGraph, arguments: dict) -> str:
    """graphify/serve.py:3177–3212 ``_tool_get_node``."""
    import json

    from graphify.security import sanitize_label
    from graphify.sections import is_section_node as _is_section_node
    from graphify.serve import _CONTROL_CHAR_RE, _node_arg, _resolve_single_node

    G = view.G
    raw = _node_arg(arguments)
    if not raw:
        return "Provide a node label or id (accepted keys: label, node_id, id)."
    label = raw
    nid, err = _resolve_single_node(G, label)
    if err:
        return err
    d = G.nodes[nid]
    attrs = d.get("attributes")
    attrs_line = []
    if isinstance(attrs, dict) and attrs:
        raw_attrs = json.dumps(attrs, sort_keys=True)
        if len(raw_attrs) > 1000:
            raw_attrs = raw_attrs[:997] + "..."
        attrs_line = [f"  Attributes: {_CONTROL_CHAR_RE.sub('', raw_attrs)}"]
    # Sanitise every LLM-derived field before concatenation (F-010).
    return "\n".join([
        f"Node: {sanitize_label(d.get('label', nid))}",
        f"  ID: {sanitize_label(nid)}",
        f"  Source: {sanitize_label(str(d.get('source_file', '')))} {sanitize_label(str(d.get('source_location', '')))}",
        # A C/C++/ObjC symbol declared in a header and defined in the sibling
        # impl file is ONE node keyed to the header, so Source alone points at
        # the declaration. Name where it is implemented too, when known.
        *([f"  Defined in: {sanitize_label(str(d.get('definition_file', '')))} "
           f"{sanitize_label(str(d.get('definition_location', '')))}"]
          if d.get("definition_file") else []),
        *(["  Section: get_section returns this Markdown section's text"]
          if _is_section_node(d) else []),
        f"  Type: {sanitize_label(str(d.get('file_type', '')))}",
        f"  Community: {sanitize_label(str(d.get('community_name') or d.get('community', '')))}",
        f"  Degree: {G.degree(nid)}",
        *attrs_line,
    ])


def tool_get_section(view: LoadedGraph, arguments: dict) -> str:
    """graphify/serve.py:3214–3234 ``_tool_get_section``.

    Khác đúng một chỗ: gốc đọc là **gốc dự án** (``view.root``) thay cho
    ``section_root(Path(active_graph_path))`` — với ``graph.json`` trong
    ``graphify-out/`` thì ``section_root`` trả về gốc dự án, còn ``.nexgraph/``
    không khớp mẫu ``graphify-out`` nên helper đó sẽ trả về chính ``.nexgraph/``.
    """
    from graphify.security import sanitize_label
    from graphify.sections import (
        DEFAULT_MAX_CHARS,
        format_section,
        read_section,
        resolve_section_query,
    )
    from graphify.serve import _node_arg

    G = view.G
    raw = _node_arg(arguments)
    if not raw:
        return "Provide a node label or id (accepted keys: label, node_id, id)."
    nid, err = resolve_section_query(G, raw)
    if nid is None:
        return err
    d = G.nodes[nid]
    max_chars = max(1, int(arguments.get("max_chars", DEFAULT_MAX_CHARS)))
    section, reason = read_section(d, view.root, max_chars)
    if section is None:
        return sanitize_label(reason)
    return format_section(section, sanitize_label(d.get("label", nid)))


def tool_get_neighbors(view: LoadedGraph, arguments: dict) -> str:
    """graphify/serve.py:3236–3250 ``_tool_get_neighbors``."""
    from graphify.security import sanitize_label
    from graphify.serve import _cut_lines_to_budget, _neighbor_lines, _node_arg, _resolve_single_node

    G = view.G
    raw = _node_arg(arguments)
    if not raw:
        return "Provide a node label or id (accepted keys: label, node_id, id)."
    label = raw
    rel_filter = (arguments.get("relation_filter") or "").lower()
    nid, err = _resolve_single_node(G, label)
    if err:
        return err
    lines = [f"Neighbors of {sanitize_label(G.nodes[nid].get('label', nid))}:"]
    lines.extend(_neighbor_lines(G, nid, rel_filter))
    budget = int(arguments.get("token_budget", 2000))
    return _cut_lines_to_budget(
        lines, budget, "Narrow with relation_filter or use get_node for a specific symbol"
    )


def tool_get_community(view: LoadedGraph, arguments: dict) -> str:
    """graphify/serve.py:3252–3269 ``_tool_get_community``."""
    from graphify.security import sanitize_label
    from graphify.serve import _community_header, _cut_lines_to_budget

    G = view.G
    cid = int(arguments["community_id"])
    nodes = view.communities.get(cid, [])
    if not nodes:
        return f"Community {cid} not found."
    header = _community_header(cid, G.nodes[nodes[0]].get("community_name"))
    lines = [f"{header} ({len(nodes)} nodes):"]
    for n in nodes:
        d = G.nodes[n]
        # Sanitise label and source_file (F-010).
        lines.append(
            f"  {sanitize_label(d.get('label', n))} "
            f"[{sanitize_label(str(d.get('source_file', '')))}]"
        )
    budget = int(arguments.get("token_budget", 2000))
    return _cut_lines_to_budget(
        lines, budget, "Raise token_budget or use get_node for specific members"
    )


def tool_god_nodes(view: LoadedGraph, arguments: dict) -> str:
    """graphify/serve.py:3271–3280 ``_tool_god_nodes``."""
    from graphify.analyze import god_nodes as _god_nodes

    _pct = arguments.get("exclude_hubs_percentile")
    nodes = _god_nodes(
        view.G, top_n=int(arguments.get("top_n", 10)),
        exclude_hubs_percentile=float(_pct) if _pct is not None else None,
    )
    lines = ["God nodes (most connected):"]
    lines += [f"  {i}. {n['label']} - {n['degree']} edges" for i, n in enumerate(nodes, 1)]
    return "\n".join(lines)


def _build_commit_line(view: LoadedGraph) -> str:
    """graphify/serve.py:3295–3315 ``_build_commit_line`` (closure của ``_build_server``).

    HEAD đọc từ thư mục chứa ``graph.json`` như bản gốc; với ``.nexgraph/`` thì
    thường không có ``.git`` nên chỉ in dòng "Built at commit".
    """
    G = view.G
    commit = getattr(G, "graph", {}).get("_built_at_commit")
    if not commit:
        return ""
    from graphify.export import _git_head

    head = _git_head(view.graph_path.parent)
    if not head:
        return f"Built at commit: {commit}\n"
    if head == commit:
        return f"Built at commit: {commit} (matches HEAD)\n"
    return (
        f"Built at commit: {commit}\n"
        f"HEAD is {head[:7]}, graph built at {commit[:7]}: graph may be stale\n"
    )


def tool_graph_stats(view: LoadedGraph, _arguments: dict) -> str:
    """graphify/serve.py:3282–3293 ``_tool_graph_stats``."""
    G = view.G
    confs = [d.get("confidence", "EXTRACTED") for _, _, d in G.edges(data=True)]
    total = len(confs) or 1
    return (
        f"Nodes: {G.number_of_nodes()}\n"
        f"Edges: {G.number_of_edges()}\n"
        f"Communities: {len(view.communities)}\n"
        f"EXTRACTED: {round(confs.count('EXTRACTED')/total*100)}%\n"
        f"INFERRED: {round(confs.count('INFERRED')/total*100)}%\n"
        f"AMBIGUOUS: {round(confs.count('AMBIGUOUS')/total*100)}%\n"
        f"{_build_commit_line(view)}"
    )


def tool_shortest_path(view: LoadedGraph, arguments: dict) -> str:
    """graphify/serve.py:3317–3318 ``_tool_shortest_path``."""
    from graphify.serve import _shortest_path_text

    return _shortest_path_text(view.G, arguments)


# ── 3 tool PR: thân hàm chép 1:1 từ graphify/serve.py ────────────────────────


def tool_list_prs(view: LoadedGraph, arguments: dict) -> str:
    """graphify/serve.py:3320–3331 ``_tool_list_prs``."""
    from graphify.prs import _detect_default_branch, fetch_prs, fetch_worktrees, format_prs_text

    repo = arguments.get("repo") or None
    base = arguments.get("base") or _detect_default_branch(repo)
    try:
        prs = fetch_prs(repo=repo, base=base)
    except RuntimeError as e:
        raise VendorToolError(f"Error: {e}") from e
    worktrees = fetch_worktrees()
    for pr in prs:
        pr.worktree_path = worktrees.get(pr.branch)
    return format_prs_text(prs, base)


def tool_get_pr_impact(view: LoadedGraph, arguments: dict) -> str:
    """graphify/serve.py:3333–3361 ``_tool_get_pr_impact``."""
    from graphify.prs import _gh, _parse_ci, compute_pr_impact, fetch_pr_files

    G = view.G
    number = int(arguments["pr_number"])
    repo = arguments.get("repo") or None
    # Use gh pr view directly — works for any base branch, not just the default
    view_args = ["pr", "view", str(number), "--json",
                 "title,headRefName,baseRefName,author,isDraft,reviewDecision,statusCheckRollup,updatedAt"]
    if repo:
        view_args += ["--repo", repo]
    pr_data = _gh(*view_args)
    if pr_data is None:
        raise VendorToolError(f"PR #{number} not found or gh not authenticated.")
    files = fetch_pr_files(number, repo)
    if not files:
        return f"PR #{number}: no changed files found (may require gh auth)."
    comms, nodes = compute_pr_impact(files, G)
    ci = _parse_ci(pr_data.get("statusCheckRollup") or [])
    lines = [
        f"PR #{number}: {pr_data['title']}",
        f"CI: {ci}  Review: {pr_data.get('reviewDecision') or 'none'}",
        f"Base: {pr_data['baseRefName']}  Author: {(pr_data.get('author') or {}).get('login', '?')}",
        f"\nGraph impact: {nodes} nodes across {len(comms)} communities",
        f"Communities touched: {comms}",
        f"Files changed ({len(files)}):",
    ]
    lines += [f"  {f}" for f in files[:20]]
    if len(files) > 20:
        lines.append(f"  … and {len(files) - 20} more")
    return "\n".join(lines)


def tool_triage_prs(view: LoadedGraph, arguments: dict) -> str:
    """graphify/serve.py:3363–3403 ``_tool_triage_prs``."""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    from graphify.prs import (
        _STATUS_ORDER,
        _detect_default_branch,
        compute_pr_impact,
        fetch_pr_files,
        fetch_prs,
        fetch_worktrees,
    )

    G = view.G
    repo = arguments.get("repo") or None
    base = arguments.get("base") or _detect_default_branch(repo)
    try:
        prs = fetch_prs(repo=repo, base=base)
    except RuntimeError as e:
        raise VendorToolError(f"Error: {e}") from e
    worktrees = fetch_worktrees()
    for pr in prs:
        pr.worktree_path = worktrees.get(pr.branch)
    actionable = [p for p in prs if p.base_branch == base and p.status not in ("WRONG-BASE", "STALE")]
    if not actionable:
        return f"No actionable PRs targeting {base}."
    # Fetch diffs concurrently then compute graph impact using in-memory G
    workers = min(8, len(actionable))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        future_to_pr = {pool.submit(fetch_pr_files, pr.number, repo): pr for pr in actionable}
        for fut in as_completed(future_to_pr):
            pr = future_to_pr[fut]
            try:
                files = fut.result()
            except Exception:
                files = []
            if files:
                pr.files_changed = files
                pr.communities_touched, pr.nodes_affected = compute_pr_impact(files, G)
    header = (
        f"Actionable PRs targeting {base}: {len(actionable)}\n"
        "Rank these by review priority. Higher blast_radius = more graph communities affected = higher merge risk.\n"
    )
    lines = [header]
    for p in sorted(actionable, key=lambda x: (_STATUS_ORDER.index(x.status) if x.status in _STATUS_ORDER else 99)):
        impact = f"  blast_radius={p.blast_radius}" if p.blast_radius else ""
        wt = f"  worktree={p.worktree_path}" if p.worktree_path else ""
        lines.append(
            f"PR #{p.number} [{p.status}] CI={p.ci_status} review={p.review_decision or 'none'} "
            f"age={p.days_old}d author={p.author}{impact}{wt}\n  title: {p.title}"
        )
    return "\n\n".join(lines)


HANDLERS = {
    "query_graph": tool_query_graph,
    "get_node": tool_get_node,
    "get_section": tool_get_section,
    "get_neighbors": tool_get_neighbors,
    "get_community": tool_get_community,
    "god_nodes": tool_god_nodes,
    "graph_stats": tool_graph_stats,
    "shortest_path": tool_shortest_path,
    "list_prs": tool_list_prs,
    "get_pr_impact": tool_get_pr_impact,
    "triage_prs": tool_triage_prs,
}
