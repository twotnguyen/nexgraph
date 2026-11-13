"""Báo cáo đồ thị kiểu GRAPH_REPORT của Graphify, tính từ SQLite qua cầu nối (spec F10 §3.3)."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

from nexgraph_engine.api.serialize import node_json
from nexgraph_engine.bridge.to_nx import OTHER_COMMUNITY, BridgeGraph, build_nx, write_graph_json
from nexgraph_engine.store.graph_store import GraphStore

os.environ.setdefault("GRAPHIFY_BACKEND", "none")  # không bao giờ để Graphify tự dò claude-cli (spec F10 §5)

GOD_NODES = 10


def _god_nodes(store: GraphStore, bg: BridgeGraph) -> list[dict]:
    from graphify.analyze import god_nodes
    out = []
    for g in god_nodes(bg.G, top_n=GOD_NODES * 5):
        attrs = bg.G.nodes[g["id"]]
        if attrs["is_test"] or attrs["kind"] == "file":  # test và tệp làm nhiễu xếp hạng (danh-gia-repo-lon.md)
            continue
        node = store.get_node(g["id"])
        if node is not None:
            out.append({"node": node_json(node), "degree": g["degree"]})
        if len(out) == GOD_NODES:
            break
    return out


def _benchmark(bg: BridgeGraph) -> dict | None:
    from graphify.benchmark import run_benchmark
    with tempfile.TemporaryDirectory(prefix="nexgraph-bench-") as d:
        path = Path(d) / "graph.json"
        try:
            write_graph_json(bg, path)
            r = run_benchmark(graph_path=str(path))
        except Exception:  # benchmark chỉ là mục phụ của báo cáo
            return None
    if "error" in r:
        return None
    return {"corpus_tokens": r["corpus_tokens"], "graph_tokens": r["avg_query_tokens"], "reduction": r["reduction_ratio"]}


def report_json(store: GraphStore) -> dict:
    from graphify.analyze import suggest_questions, surprising_connections
    bg = build_nx(store)
    communities = [{"id": f"com:{cid}", "label": bg.labels[cid], "size": len(members), "cohesion": bg.cohesion[cid]}
                   for cid, members in sorted(bg.communities.items()) if cid != OTHER_COMMUNITY]
    surprising = [{"source": s["source"], "target": s["target"], "source_files": s.get("source_files", []),
                   "relation": s.get("relation", ""), "why": s.get("why") or s.get("note", "")}
                  for s in surprising_connections(bg.G, bg.communities, top_n=5)]
    questions = [{"question": q["question"], "why": q.get("why", "")}
                 for q in suggest_questions(bg.G, bg.communities, bg.labels, top_n=7)]
    return {"god_nodes": _god_nodes(store, bg), "communities": communities, "surprising": surprising,
            "questions": questions, "benchmark": _benchmark(bg), "truncated": bg.truncated}


def report_markdown(store: GraphStore, project_name: str) -> str:
    from graphify.analyze import god_nodes, suggest_questions, surprising_connections
    from graphify.report import generate
    bg = build_nx(store)
    stats = store.stats()
    return generate(bg.G, bg.communities, bg.cohesion, bg.labels, god_nodes(bg.G), surprising_connections(bg.G, bg.communities),
                    {"total_files": stats["files"], "total_words": bg.G.number_of_nodes() * 50},
                    {"input": 0, "output": 0}, project_name,
                    suggested_questions=suggest_questions(bg.G, bg.communities, bg.labels))
