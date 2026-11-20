"""Báo cáo đồ thị kiểu GRAPH_REPORT của Graphify, tính từ SQLite qua cầu nối (spec F10 §3.3)."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

from nexgraph_engine.bridge.to_nx import OTHER_COMMUNITY, BridgeGraph, build_nx, write_graph_json
from nexgraph_engine.query.contracts import node_json
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


AUDIT_FILES = 50


def audit_json(store: GraphStore) -> dict:
    """Tỉ lệ cạnh EXTRACTED/INFERRED/AMBIGUOUS và lỗi phân tích theo loại (resource `audit`)."""
    q = store.conn.execute
    counts = dict(q("SELECT muc_tin_cay, count(*) FROM canh GROUP BY muc_tin_cay").fetchall())
    total = sum(counts.values())
    by_conf = {c: {"count": counts.get(c, 0), "ratio": round(counts.get(c, 0) / total, 4) if total else 0.0}
               for c in ("EXTRACTED", "INFERRED", "AMBIGUOUS")}
    by_kind = dict(q("SELECT loai, count(*) FROM loi_phan_tich GROUP BY loai").fetchall())
    files = [{"file": r[0], "kind": r[1], "detail": r[2]} for r in q(
        "SELECT t.duong_dan_tuong_doi, l.loai, l.chi_tiet FROM loi_phan_tich l JOIN tep t ON t.ma_tep = l.ma_tep"
        " ORDER BY t.duong_dan_tuong_doi, l.loai LIMIT ?", (AUDIT_FILES,))]
    return {"edges": total, "by_confidence": by_conf,
            "parse_errors": {"total": sum(by_kind.values()), "by_kind": by_kind, "files": files}}


def report_markdown(store: GraphStore, project_name: str) -> str:
    return render_report_markdown(build_nx(store), project_name, store.stats()["files"])


def render_report_markdown(bg: BridgeGraph, project_name: str, files: int) -> str:
    from graphify.analyze import god_nodes, suggest_questions, surprising_connections
    from graphify.report import generate
    md = generate(bg.G, bg.communities, bg.cohesion, bg.labels, god_nodes(bg.G), surprising_connections(bg.G, bg.communities),
                  {"total_files": files, "total_words": 0}, {"input": 0, "output": 0}, project_name,
                  suggested_questions=suggest_questions(bg.G, bg.communities, bg.labels))
    # NexGraph không đếm từ và không gọi LLM: bỏ hai số mà Graphify sẽ in ra như thật.
    lines = []
    for line in md.splitlines():
        if line.startswith("- Token cost:"):
            continue
        if line.startswith(f"- {files} files · ~"):
            line = f"- {files} files"
        lines.append(line)
    return "\n".join(lines) + ("\n" if md.endswith("\n") else "")
