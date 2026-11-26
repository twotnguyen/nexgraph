"""Luồng gọi giữa các mục của HTML callflow — chỉ in quan hệ có thật trong đồ thị (E9b-1, review-62).

Mã vendored `graphify/callflow_html.py` suy mục lục thành luồng bằng hai fallback:
`derive_flow_chain` nối sang section kế tiếp khi section hiện tại không có cạnh đi ra, và
`generate_overview_graph` vẽ mũi tên nét đứt giữa hai section liền kề khi không có cạnh liên section.
Với mục lục dựng theo cộng đồng thật của NexGraph (A3b-P1 F1), hai fallback đó biến thứ tự sắp xếp
thành quan hệ không có trong đồ thị. Lớp NexGraph thay phần luồng ở đây — không sửa mã vendored:
chuỗi chỉ đi theo cạnh thật (đúng hướng, cộng trọng số), hết cạnh thì dừng; không có cạnh nào giữa
các mục thì ghi rõ và bỏ mũi tên nét đứt.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from html import escape as html_escape

# `derive_flow_chain` của bản vendor cũng dừng ở 7 mục.
MAX_CHAIN = 7

_ARROW_CHAIN = re.compile(r'<div class="arrow-chain">.*?</div>', re.S)
_FLOW_TITLE = re.compile(r"<h4>(?:Core Flow|Luồng chính)</h4>")
# Chỉ `generate_overview_graph` sinh `-.->`, và chỉ khi nó không thấy cạnh liên section nào:
# mũi tên "ngụ ý" giữa hai mục liền kề, không phải cạnh của đồ thị.
_DOTTED_LINK = re.compile(r"^[ \t]*[A-Z0-9_]+ -\.-> [A-Z0-9_]+[ \t]*\n?", re.M)

_FLOW_HEADING = {"en": "Call Flow", "vi": "Luồng gọi"}
_NO_FLOW = {"en": "No call flow between communities.", "vi": "Không có luồng gọi giữa các nhóm."}


def _community_sections(sections: list[dict]) -> dict[int, str]:
    """Cộng đồng (kể cả -1) → id mục trong mục lục."""
    mapping: dict[int, str] = {}
    for section in sections:
        for cid in section.get("communities", []):
            mapping[int(cid)] = section["id"]
    return mapping


def section_edge_weights(bg, sections: list[dict]) -> dict[tuple[str, str], int]:
    """Cạnh thật giữa các mục: `(mục nguồn, mục đích) → tổng trọng số`, theo hướng lưu trong đồ thị.

    Dùng cùng bộ lọc `should_include_edge` của bản vendor để không tính cạnh AMBIGUOUS/tin cậy thấp.
    Không có `sections` (graphify tự suy mục lục) thì đếm theo cộng đồng, đủ để biết có luồng hay không.
    """
    from nexgraph_engine.adapters.graphify.analysis import should_include_edge

    by_community = _community_sections(sections) if sections else {cid: str(cid) for cid in bg.communities}
    community_of = {node: cid for cid, members in bg.communities.items() for node in members}
    weights: Counter[tuple[str, str]] = Counter()
    for src_node, tgt_node, data in bg.G.edges(data=True):
        if not should_include_edge(data):
            continue
        src = by_community.get(community_of.get(src_node))
        tgt = by_community.get(community_of.get(tgt_node))
        if src is None or tgt is None or src == tgt:
            continue
        weights[(src, tgt)] += int(data.get("weight", 1) or 1)
    return dict(weights)


def flow_chain(sections: list[dict], weights: dict[tuple[str, str], int]) -> list[str]:
    """Chuỗi mục theo cạnh thật: bắt đầu ở mục ít cạnh vào nhất, đi theo cạnh ra nặng nhất."""
    order = [section["id"] for section in sections]
    if not order:
        return []
    index = {sid: position for position, sid in enumerate(order)}
    outgoing: dict[str, Counter] = defaultdict(Counter)
    incoming: Counter[str] = Counter()
    for (src, tgt), count in weights.items():
        outgoing[src][tgt] += count
        incoming[tgt] += count
    current = min(order, key=lambda sid: (incoming.get(sid, 0), index[sid]))
    chain = [current]
    seen = {current}
    while len(chain) < min(MAX_CHAIN, len(order)):
        candidates = [(count, index[tgt], tgt) for tgt, count in outgoing.get(current, {}).items() if tgt not in seen]
        if not candidates:  # hết cạnh thật: dừng, không nối bừa sang mục kế tiếp
            break
        nxt = min(candidates, key=lambda item: (-item[0], item[1]))[2]
        chain.append(nxt)
        seen.add(nxt)
        current = nxt
    return chain


def apply_callflow_flow(html: str, bg, sections: list[dict], lang: str) -> str:
    """Thay thẻ luồng của HTML callflow bằng chuỗi suy từ cạnh thật, hoặc câu "không có luồng"."""
    lang = "vi" if lang == "vi" else "en"
    weights = section_edge_weights(bg, sections)
    html = _DOTTED_LINK.sub("", html)
    if not weights:
        html = _FLOW_TITLE.sub(f"<h4>{html_escape(_FLOW_HEADING[lang])}</h4>", html)
        return _ARROW_CHAIN.sub(f'<div class="arrow-chain">{html_escape(_NO_FLOW[lang])}</div>', html)
    if not sections:  # mục lục do graphify tự suy: chuỗi của nó cũng đi theo cạnh thật
        return html
    names = {section["id"]: section.get("name", section["id"]) for section in sections}
    text = " -> ".join(names.get(sid, sid) for sid in flow_chain(sections, weights))
    return _ARROW_CHAIN.sub(f'<div class="arrow-chain">{html_escape(text)}</div>', html)
