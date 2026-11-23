"""Export đồ thị sang các định dạng của Graphify bằng hàm của bản vendor (spec F10 §3.4)."""
from __future__ import annotations

import glob
import json
import os
import re
import shutil
import tempfile
import time
import uuid
from dataclasses import dataclass
from html import escape as html_escape
from pathlib import Path
from typing import Literal, get_args
from urllib.parse import urlsplit

from nexgraph_engine.bridge.to_nx import OTHER_COMMUNITY, BridgeGraph, Scope, build_nx, write_graph_json
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


def unique_dir(target: Path) -> Path:
    """Thư mục đích chưa tồn tại: `mkdir` nguyên tử, thêm `-2`, `-3`… khi đã có (GFY-09)."""
    for index in range(1, 1001):
        candidate = target if index == 1 else target.with_name(f"{target.name}-{index}")
        try:
            candidate.mkdir()
            return candidate
        except FileExistsError:
            continue
    raise OSError(f"Không tìm được tên trống cho {target.name}")


def _cleanup_stale_tmp(base: Path) -> None:
    """Dọn `.{tên}.*.tmp` do lần xuất trước bị kill (`finally` không chạy) — chỉ tệp cũ hơn 1 giờ.

    Tệp mới hơn có thể của tiến trình khác đang ghi vào cùng thư mục nên để nguyên.
    """
    cutoff = time.time() - _TMP_MAX_AGE_SECONDS
    for path in base.parent.glob(glob.escape(f".{base.name}.") + "*.tmp"):
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink(missing_ok=True)
        except OSError:
            pass  # tệp vừa bị người khác dọn hoặc không xoá được: lần xuất sau dọn tiếp


def _link_or_copy(tmp: Path, candidate: Path) -> None:
    """Đặt `tmp` vào tên `candidate` mà không đè: hard link, lùi về `O_EXCL` + chép khi FS không hỗ trợ.

    FAT32/exFAT (USB, thẻ SD) và nhiều ổ mạng/SMB không có hard link → `os.link` ném ENOTSUP/EPERM/EXDEV.
    Khi đó giữ nguyên tắc "không đè": mở tên đích bằng `O_CREAT|O_EXCL` (FileExistsError nếu ai đó vừa tạo)
    rồi chép nội dung từ tệp tạm; chép hỏng giữa chừng thì xoá tên đích vừa giữ.
    """
    try:
        os.link(tmp, candidate)
        return
    except FileExistsError:
        raise
    except OSError:
        pass  # ENOTSUP/EPERM/EXDEV/EOPNOTSUPP/EINVAL: định dạng ổ không hỗ trợ hard link
    # FileExistsError ở đây phải nổi lên cho vòng lặp chọn tên khác, nên mở trước `try` bên dưới.
    handle = os.fdopen(os.open(candidate, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644), "wb")
    try:
        with handle as dst, open(tmp, "rb") as src:
            shutil.copyfileobj(src, dst)
    except BaseException:
        candidate.unlink(missing_ok=True)  # không để lại tệp dở khi chép hỏng
        raise


_TMP_MAX_AGE_SECONDS = 3600
_TITLE_TAG = re.compile(r"<title>.*?</title>", re.S)
# Trùng mặc định `max_sections` của graphify (`write_callflow_html`); mục lục của NexGraph chừa một mục gộp.
CALFLOW_MAX_SECTIONS = 15


def write_new_file(base: Path, writer) -> Path:
    """Ghi ra tên tạm rồi đặt sang tên chưa tồn tại (hard link, hoặc `O_EXCL` + chép).

    Không đè tệp cũ và không để lại tệp 0 byte nếu writer hỏng giữa chừng (GFY-09 minor 5).
    Tệp tạm của lần xuất bị kill trước đó (`finally` không chạy) được dọn khi bắt đầu xuất.
    """
    _cleanup_stale_tmp(base)
    stem, suffix = base.stem, base.suffix
    for index in range(1, 1001):
        candidate = base if index == 1 else base.with_name(f"{stem}-{index}{suffix}")
        if candidate.exists():
            continue
        tmp = base.with_name(f".{base.name}.{uuid.uuid4().hex}.tmp")
        try:
            writer(tmp)
            _link_or_copy(tmp, candidate)  # nguyên tử, FileExistsError nếu ai đó vừa tạo
            return candidate
        except FileExistsError:
            continue
        finally:
            tmp.unlink(missing_ok=True)
    raise OSError(f"Không tìm được tên trống cho {base.name}")


def _graph_commit(store: GraphStore) -> str | None:
    """Commit HEAD lúc lập chỉ mục (indexer ghi `commit_sha`), None khi dự án không có git."""
    run = store.last_completed_run()
    return run[1] if run and run[1] else None


def _callflow_sections(bg: BridgeGraph, lang: str) -> list[dict]:
    """Mục lục callflow theo cộng đồng thật của đồ thị (`bg.labels`), không theo archetype của graphify.

    `derive_sections_from_communities` của bản vendor gộp cộng đồng vào bộ từ khoá cứng của graphify
    ("Extraction Pipeline", "CLI & Skill Installers"…) nên dự án thường bị dán nhãn sai (A3b-P1 F1).
    Truyền `sections` cho `write_callflow_html` là đủ — không phải sửa mã vendored.
    """
    from nexgraph_engine.report.i18n import community_label
    ordered = sorted(((cid, members) for cid, members in bg.communities.items() if cid != OTHER_COMMUNITY),
                     key=lambda item: (-len(item[1]), str(item[0])))
    keep = ordered[:CALFLOW_MAX_SECTIONS - 2]  # chừa chỗ cho "Tổng quan" và mục gộp
    merged = [cid for cid, _ in ordered[len(keep):]]
    if OTHER_COMMUNITY in bg.communities:
        merged.append(OTHER_COMMUNITY)
    sections = [{"id": f"community-{cid}", "name": community_label(bg.labels.get(cid) or f"Cộng đồng {cid}", lang),
                 "communities": [str(cid)]} for cid, _ in keep]
    if merged:
        sections.append({"id": "other", "name": "Khác" if lang == "vi" else "Other",
                         "communities": [str(cid) for cid in merged]})
    return sections


def _retitle_html(target: Path, title: str) -> None:
    """Đặt `<title>` cho HTML do graphify sinh — `to_html` lấy tên tệp tạm làm tiêu đề (A3b-P1 F3).

    Hậu xử lý ở lớp NexGraph như `localize_callflow_html`, không thêm tham số vào mã vendored.
    """
    text = target.read_text(encoding="utf-8")
    updated, count = _TITLE_TAG.subn(f"<title>{html_escape(title)}</title>", text, count=1)
    if count:
        target.write_text(updated, encoding="utf-8")


def validate_push_uri(uri: str) -> str:
    """Trả scheme hợp lệ của URI đẩy; ném ValueError cho mọi scheme khác (kể cả thiếu scheme)."""
    scheme = urlsplit(uri).scheme.lower()
    if scheme not in PUSH_SCHEMES:
        raise ValueError(f"Scheme không được phép: {scheme or '(thiếu)'}; cho phép: {', '.join(sorted(PUSH_SCHEMES))}")
    return scheme


def export_graph(store: GraphStore, fmt: ExportFormat, scope: Scope, out_dir: Path, project_name: str,
                 *, lang: str = "en") -> ExportResult:
    from graphify import export as gx
    from nexgraph_engine.report.i18n import check_lang
    if fmt not in FORMATS:
        raise ValueError(f"Định dạng không hỗ trợ: {fmt}")
    lang = check_lang(lang, "en")  # HTML callflow theo ngôn ngữ của lần xuất (M2, review 23/11)
    directory = fmt in ("obsidian", "wiki")
    base = Path(out_dir) / _TARGETS[fmt].format(p=safe_name(project_name))
    if directory:
        target = unique_dir(base)
        try:
            return ExportResult([str(target)], _write(store, fmt, scope, target, project_name, gx, lang=lang))
        except BaseException:
            shutil.rmtree(target, ignore_errors=True)  # không để lại thư mục dở dang
            raise
    # Tệp đã tồn tại thì chọn tên mới; ghi tạm rồi link nên không đè và không để lại tệp 0 byte.
    holder: dict[str, bool] = {}

    def writer(tmp: Path) -> None:
        holder["truncated"] = _write(store, fmt, scope, tmp, project_name, gx, lang=lang)

    target = write_new_file(base, writer)
    return ExportResult([str(target)], holder["truncated"])


def _write(store: GraphStore, fmt: ExportFormat, scope: Scope, target: Path, project_name: str, gx,
           lang: str = "en") -> bool:
    bg = build_nx(store, scope)
    if fmt == "markdown":
        from nexgraph_engine.report.build import render_report_markdown
        files = store.stats()["files"] if scope.kind == "all" else len({
            node["source_file"] for _, node in bg.G.nodes(data=True) if node["source_file"]
        })
        target.write_text(render_report_markdown(bg, project_name, files), encoding="utf-8")
    elif fmt == "html":
        from graphify.exporters.html import to_html
        to_html(bg.G, bg.communities, str(target), community_labels=bg.labels, node_limit=scope.limit)
        _retitle_html(target, f"{project_name} — NexGraph")
    elif fmt == "callflow_html":
        from graphify.callflow_html import write_callflow_html
        from nexgraph_engine.export.callflow_i18n import localize_callflow_html
        sections = _callflow_sections(bg, lang)
        with tempfile.TemporaryDirectory(prefix="nexgraph-callflow-") as d:
            graph = Path(d) / "graph.json"
            write_graph_json(bg, graph, project_name=project_name, built_at_commit=_graph_commit(store))
            labels = Path(d) / "labels.json"
            labels.write_text(json.dumps({str(cid): name for cid, name in bg.labels.items()}, ensure_ascii=False),
                              encoding="utf-8")
            options: dict = {"labels": labels, "output": target, "lang": lang}
            if sections:  # graphify tự thêm mục "Tổng quan"; không có cộng đồng nào thì để nó tự suy
                sections_path = Path(d) / "sections.json"
                sections_path.write_text(json.dumps(sections, ensure_ascii=False), encoding="utf-8")
                options["sections"] = sections_path
            write_callflow_html(None, graph=graph, **options)
        if lang == "vi":  # graphify chỉ có zh/en: dịch ở lớp NexGraph, không sửa mã vendored
            target.write_text(localize_callflow_html(target.read_text(encoding="utf-8"), lang), encoding="utf-8")
    elif fmt == "obsidian":
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
    return bg.truncated


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
