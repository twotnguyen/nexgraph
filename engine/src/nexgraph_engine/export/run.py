"""Export đồ thị sang các định dạng của Graphify bằng hàm của bản vendor (spec F10 §3.4)."""
from __future__ import annotations

import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, get_args
from urllib.parse import urlsplit

from nexgraph_engine.bridge.to_nx import Scope, build_nx, write_graph_json
from nexgraph_engine.store.graph_store import GraphStore

os.environ.setdefault("GRAPHIFY_BACKEND", "none")  # không bao giờ để Graphify tự dò claude-cli (spec F10 §5)

ExportFormat = Literal["html", "callflow_html", "obsidian", "wiki", "svg", "graphml", "cypher", "json", "markdown"]
FORMATS: tuple[str, ...] = get_args(ExportFormat)
# Chỉ các scheme của driver đồ thị được phép: chặn file://, http:// (SSRF), v.v. (spec bảo mật export/push).
PUSH_SCHEMES: frozenset[str] = frozenset({"bolt", "bolt+s", "neo4j", "neo4j+s", "redis", "rediss"})
_TARGETS = {"html": "{p}-graph.html", "callflow_html": "{p}-callflow.html", "obsidian": "{p}-obsidian",
            "wiki": "{p}-wiki", "svg": "{p}-graph.svg", "graphml": "{p}.graphml", "cypher": "{p}-cypher.txt",
            "json": "{p}-graph.json", "markdown": "{p}-GRAPH_REPORT.md"}


@dataclass
class ExportResult:
    files: list[str]
    truncated: bool


def safe_name(name: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .")
    return cleaned or "nexgraph"


def validate_push_uri(uri: str) -> str:
    """Trả scheme hợp lệ của URI đẩy; ném ValueError cho mọi scheme khác (kể cả thiếu scheme)."""
    scheme = urlsplit(uri).scheme.lower()
    if scheme not in PUSH_SCHEMES:
        raise ValueError(f"Scheme không được phép: {scheme or '(thiếu)'}; cho phép: {', '.join(sorted(PUSH_SCHEMES))}")
    return scheme


def export_graph(store: GraphStore, fmt: ExportFormat, scope: Scope, out_dir: Path, project_name: str) -> ExportResult:
    from graphify import export as gx
    if fmt not in FORMATS:
        raise ValueError(f"Định dạng không hỗ trợ: {fmt}")
    target = Path(out_dir) / _TARGETS[fmt].format(p=safe_name(project_name))
    if fmt == "markdown":
        from nexgraph_engine.report.build import report_markdown
        target.write_text(report_markdown(store, project_name), encoding="utf-8")
        return ExportResult([str(target)], build_nx(store, scope).truncated)
    bg = build_nx(store, scope)
    if fmt == "html":
        from graphify.exporters.html import to_html
        to_html(bg.G, bg.communities, str(target), community_labels=bg.labels, node_limit=scope.limit)
    elif fmt == "callflow_html":
        from graphify.callflow_html import write_callflow_html
        with tempfile.TemporaryDirectory(prefix="nexgraph-callflow-") as d:
            graph = Path(d) / "graph.json"
            write_graph_json(bg, graph)
            write_callflow_html(None, graph=graph, output=target, lang="en")
    elif fmt == "obsidian":
        target.mkdir(exist_ok=True)
        gx.to_obsidian(bg.G, bg.communities, str(target), community_labels=bg.labels, cohesion=bg.cohesion)
        gx.to_canvas(bg.G, bg.communities, str(target / "graph.canvas"), community_labels=bg.labels)
    elif fmt == "wiki":
        from graphify.analyze import god_nodes
        from graphify.wiki import to_wiki
        to_wiki(bg.G, bg.communities, target, community_labels=bg.labels, cohesion=bg.cohesion,
                god_nodes_data=god_nodes(bg.G))
    elif fmt == "svg":
        gx.to_svg(bg.G, bg.communities, str(target), community_labels=bg.labels)
    elif fmt == "graphml":
        gx.to_graphml(bg.G, bg.communities, str(target))
    elif fmt == "cypher":
        gx.to_cypher(bg.G, str(target))
    elif fmt == "json":
        write_graph_json(bg, target)
    return ExportResult([str(target)], bg.truncated)


def push_graph(store: GraphStore, target: Literal["neo4j", "falkordb"], uri: str, user: str | None,
               password: str | None, scope: Scope) -> dict:
    """Mật khẩu chỉ dùng cho lần đẩy này; không lưu, không ghi log (spec F10 §4.3)."""
    validate_push_uri(uri)  # chặn file://, http(s)://... trước khi đưa URI cho driver
    from graphify.exporters.graphdb import push_to_falkordb, push_to_neo4j
    bg = build_nx(store, scope)
    if target == "neo4j":
        counts = push_to_neo4j(bg.G, uri, user or "neo4j", password or "", communities=bg.communities)
    else:
        counts = push_to_falkordb(bg.G, uri, user, password, communities=bg.communities)
    return {"nodes": counts.get("nodes", 0), "edges": counts.get("edges", 0), "truncated": bg.truncated}
