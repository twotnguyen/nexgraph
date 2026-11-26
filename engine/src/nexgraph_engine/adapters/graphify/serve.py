"""Cổng Graphify — Truy vấn đồ thị kiểu `graphify serve` và các tool MCP: `serve`, `sections`, `prs`, `reflect`, `paths`, `build`, `cross_repo_*`, `querylog`.

Kiểm bởi `tests/test_graphify_gateway.py` (ADR 0026 mục A.4–A.5); thêm tên thì sửa tay `NAMES` và khối
`TYPE_CHECKING`, rồi chụp lại chữ ký. Mã engine chỉ import Graphify qua đây.

Tên được tra **mỗi lần** `from nexgraph_engine.adapters.graphify.serve import X` chạy (module `__getattr__`,
không lưu lại), nên import trễ trong hàm vẫn tải module vendor lúc gọi như trước và `monkeypatch` trên
module vendor vẫn có tác dụng.
"""
from __future__ import annotations

from importlib import import_module
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from graphify.build import prefix_graph_for_global
    from graphify.cross_repo_calls import CROSS_REPO_CALL_MARKER, link_cross_repo_member_calls
    from graphify.cross_repo_types import SHARED_TYPE_RELATION, link_shared_type_declarations
    from graphify.paths import write_json_atomic
    from graphify.prs import PRInfo, _PR_JSON_FIELDS, _STATUS_ORDER, _detect_default_branch, _gh, _parse_ci, _parse_pr_dict, compute_pr_impact, fetch_pr_files, fetch_prs, fetch_worktrees, format_prs_text
    from graphify import querylog
    from graphify.reflect import aggregate_lessons
    from graphify.sections import DEFAULT_MAX_CHARS, _BODY_CONTROL_RE, format_section, is_section_node, read_section, resolve_section_query
    from graphify import serve
    from graphify.serve import _CONTROL_CHAR_RE, _RELATIONAL_INTENT_TERMS, _community_header, _cut_lines_to_budget, _find_node_tiers, _neighbor_lines, _node_arg, _pick_seeds, _query_graph_text, _query_name_refusal, _query_path_weight, _query_terms, _resolve_single_node, _score_query, _shortest_path_text, find_node_ambiguity

#: tên cổng → (module vendor, thuộc tính; None = chính module)
NAMES: dict[str, tuple[str, str | None]] = {
    "CROSS_REPO_CALL_MARKER": ("graphify.cross_repo_calls", "CROSS_REPO_CALL_MARKER"),
    "DEFAULT_MAX_CHARS": ("graphify.sections", "DEFAULT_MAX_CHARS"),
    "PRInfo": ("graphify.prs", "PRInfo"),
    "SHARED_TYPE_RELATION": ("graphify.cross_repo_types", "SHARED_TYPE_RELATION"),
    "_BODY_CONTROL_RE": ("graphify.sections", "_BODY_CONTROL_RE"),
    "_CONTROL_CHAR_RE": ("graphify.serve", "_CONTROL_CHAR_RE"),
    "_PR_JSON_FIELDS": ("graphify.prs", "_PR_JSON_FIELDS"),
    "_RELATIONAL_INTENT_TERMS": ("graphify.serve", "_RELATIONAL_INTENT_TERMS"),
    "_STATUS_ORDER": ("graphify.prs", "_STATUS_ORDER"),
    "_community_header": ("graphify.serve", "_community_header"),
    "_cut_lines_to_budget": ("graphify.serve", "_cut_lines_to_budget"),
    "_detect_default_branch": ("graphify.prs", "_detect_default_branch"),
    "_find_node_tiers": ("graphify.serve", "_find_node_tiers"),
    "_gh": ("graphify.prs", "_gh"),
    "_neighbor_lines": ("graphify.serve", "_neighbor_lines"),
    "_node_arg": ("graphify.serve", "_node_arg"),
    "_parse_ci": ("graphify.prs", "_parse_ci"),
    "_parse_pr_dict": ("graphify.prs", "_parse_pr_dict"),
    "_pick_seeds": ("graphify.serve", "_pick_seeds"),
    "_query_graph_text": ("graphify.serve", "_query_graph_text"),
    "_query_name_refusal": ("graphify.serve", "_query_name_refusal"),
    "_query_path_weight": ("graphify.serve", "_query_path_weight"),
    "_query_terms": ("graphify.serve", "_query_terms"),
    "_resolve_single_node": ("graphify.serve", "_resolve_single_node"),
    "_score_query": ("graphify.serve", "_score_query"),
    "_shortest_path_text": ("graphify.serve", "_shortest_path_text"),
    "aggregate_lessons": ("graphify.reflect", "aggregate_lessons"),
    "compute_pr_impact": ("graphify.prs", "compute_pr_impact"),
    "fetch_pr_files": ("graphify.prs", "fetch_pr_files"),
    "fetch_prs": ("graphify.prs", "fetch_prs"),
    "fetch_worktrees": ("graphify.prs", "fetch_worktrees"),
    "find_node_ambiguity": ("graphify.serve", "find_node_ambiguity"),
    "format_prs_text": ("graphify.prs", "format_prs_text"),
    "format_section": ("graphify.sections", "format_section"),
    "is_section_node": ("graphify.sections", "is_section_node"),
    "link_cross_repo_member_calls": ("graphify.cross_repo_calls", "link_cross_repo_member_calls"),
    "link_shared_type_declarations": ("graphify.cross_repo_types", "link_shared_type_declarations"),
    "prefix_graph_for_global": ("graphify.build", "prefix_graph_for_global"),
    "querylog": ("graphify.querylog", None),
    "read_section": ("graphify.sections", "read_section"),
    "resolve_section_query": ("graphify.sections", "resolve_section_query"),
    "serve": ("graphify.serve", None),
    "write_json_atomic": ("graphify.paths", "write_json_atomic"),
}

__all__ = ["CROSS_REPO_CALL_MARKER", "DEFAULT_MAX_CHARS", "PRInfo", "SHARED_TYPE_RELATION", "_BODY_CONTROL_RE", "_CONTROL_CHAR_RE", "_PR_JSON_FIELDS", "_RELATIONAL_INTENT_TERMS", "_STATUS_ORDER", "_community_header", "_cut_lines_to_budget", "_detect_default_branch", "_find_node_tiers", "_gh", "_neighbor_lines", "_node_arg", "_parse_ci", "_parse_pr_dict", "_pick_seeds", "_query_graph_text", "_query_name_refusal", "_query_path_weight", "_query_terms", "_resolve_single_node", "_score_query", "_shortest_path_text", "aggregate_lessons", "compute_pr_impact", "fetch_pr_files", "fetch_prs", "fetch_worktrees", "find_node_ambiguity", "format_prs_text", "format_section", "is_section_node", "link_cross_repo_member_calls", "link_shared_type_declarations", "prefix_graph_for_global", "querylog", "read_section", "resolve_section_query", "serve", "write_json_atomic"]


def __getattr__(name: str) -> Any:
    try:
        module, attr = NAMES[name]
    except KeyError:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}") from None
    mod = import_module(module)
    return mod if attr is None else getattr(mod, attr)
