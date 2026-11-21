"""Chia khối theo target. Chỉ đọc CSDL đồ thị và tệp tài liệu/ảnh; code không bao giờ vào khối."""
from __future__ import annotations

import base64
import hashlib
import posixpath
from dataclasses import dataclass, field
from pathlib import Path

from graphify.detect import _is_sensitive
from graphify.llm import _IMAGE_MEDIA_TYPES, _IMAGE_TOKEN_ESTIMATE, _MAX_IMAGE_BYTES, _estimate_prompt_tokens

from nexgraph_engine.docs.text import doc_text
from nexgraph_engine.query.source_policy import SourcePolicy
from nexgraph_engine.semantic import prompt
from nexgraph_engine.store.graph_store import GraphStore

TARGETS = ("docs", "images", "deep", "labels", "dedup", "pr_triage")
# Ngôn ngữ tài liệu được gửi: chữ của tài liệu, PDF, bản chép lời. Không có ngôn ngữ code nào ở đây.
DOC_TEXT_LANGUAGES = ("markdown", "text", "html", "docx", "xlsx", "pdf", "media", "google_workspace")
MAX_FILES, MAX_LINES, SOLO_LINES = 20, 6_000, 2_000  # quy tắc chia khối trong skill của graphify
LABEL_BATCH, LABEL_TOP_K, LABEL_MAXLEN = 100, 12, 60  # như `_LABEL_BATCH_SIZE`, `_LABEL_TOP_K`, `_LABEL_MAXLEN`
OUTPUT_TOKENS = 8_192


@dataclass
class Chunk:
    id: str
    files: list[str]
    system: str
    user: str
    images: list[str] = field(default_factory=list)  # base64
    image_types: list[str] = field(default_factory=list)
    max_output_tokens: int = OUTPUT_TOKENS
    meta: dict = field(default_factory=dict)  # labels: số thứ tự trong khối → (ma_khoi, chữ ký thành viên)

    @property
    def key(self) -> str:
        h = hashlib.sha256()
        for part in (self.system, self.user, *self.images):
            h.update(part.encode("utf-8"))
            h.update(b"\0")
        return h.hexdigest()

    @property
    def input_tokens(self) -> int:
        return _estimate_prompt_tokens(self.system + self.user) + _IMAGE_TOKEN_ESTIMATE * len(self.images)

    @property
    def output_tokens(self) -> int:
        """Ước tính: khoảng một phần tư đầu vào, không quá trần của khối."""
        return min(self.max_output_tokens, max(256, self.input_tokens // 4))

    def wire(self) -> dict:
        """Hình dạng gửi cho main ở đường A (`GET /v1/jobs/{id}/llm/next`)."""
        out = {"chunk_id": self.id, "system": self.system, "user": self.user, "max_output_tokens": self.max_output_tokens}
        if self.images:
            out |= {"images": self.images, "image_types": self.image_types}
        return out


@dataclass(frozen=True)
class Sources:
    root: Path
    sources_dir: Path | None
    transcript_dir: Path


def file_path(src: Sources, rel: str) -> Path:
    """Như discovery: tệp trong dự án được ưu tiên, `sources/…` không có trong dự án thì lấy ở gốc phụ."""
    inside = src.root / rel
    if rel.startswith("sources/") and src.sources_dir is not None and not inside.exists():
        return src.sources_dir / rel[len("sources/"):]
    return inside


def _sendable(store: GraphStore, src: Sources):
    """Tệp được gửi cho model: không bị graphify coi là nhạy cảm, không bị .gitignore/mẫu loại trừ/tên chặn của AI."""
    policy = SourcePolicy(src.root, store.last_exclude())
    return lambda rel: not _is_sensitive(Path(rel)) and policy.allows(rel)


def _doc_units(store: GraphStore, src: Sources) -> list[tuple[str, str]]:
    marks = ",".join("?" * len(DOC_TEXT_LANGUAGES))
    rows = store.conn.execute(f"SELECT duong_dan_tuong_doi, ngon_ngu, ma_bam FROM tep WHERE ngon_ngu IN ({marks})"
                              " ORDER BY duong_dan_tuong_doi", DOC_TEXT_LANGUAGES).fetchall()
    units = []
    sendable = _sendable(store, src)
    for rel, language, sha in rows:
        if not sendable(rel):
            continue
        try:
            if language in ("media", "google_workspace"):  # chữ đã chép/xuất lúc index, lưu theo mã băm
                cached = src.transcript_dir / f"{sha}.txt"
                text = cached.read_text(encoding="utf-8") if cached.is_file() else ""
            else:
                text = doc_text(file_path(src, rel), language)
        except (OSError, ValueError):
            continue
        if text.strip():
            units.append((rel, text))
    return units


def _pack(units: list[tuple[str, str]]) -> list[list[tuple[str, str]]]:
    """Gom theo thứ tự đường dẫn (cùng thư mục đứng cạnh nhau); tối đa 20 tệp, 6.000 dòng; tệp > 2.000 dòng đứng riêng."""
    groups: list[list[tuple[str, str]]] = []
    current: list[tuple[str, str]] = []
    lines = 0
    current_dir = None
    for unit in sorted(units, key=lambda u: (posixpath.dirname(u[0]), u[0])):
        n = unit[1].count("\n") + 1
        directory = posixpath.dirname(unit[0])
        if n > SOLO_LINES:
            groups.append([unit])
            continue
        if current and (len(current) >= MAX_FILES or lines + n > MAX_LINES or directory != current_dir):
            groups.append(current)
            current, lines = [], 0
        current.append(unit)
        lines += n
        current_dir = directory
    if current:
        groups.append(current)
    return groups


def _docs(store: GraphStore, src: Sources, *, deep: bool) -> list[Chunk]:
    system = prompt.extraction_system(deep=deep)
    return [Chunk(id=f"c{i}", files=[rel for rel, _ in group], system=system, user=prompt.docs_user(group))
            for i, group in enumerate(_pack(_doc_units(store, src)), 1)]


def _images(store: GraphStore, src: Sources) -> list[Chunk]:
    system = prompt.extraction_system()
    chunks = []
    sendable = _sendable(store, src)
    for (rel,) in store.conn.execute("SELECT duong_dan_tuong_doi FROM tep WHERE ngon_ngu = 'image'"
                                     " ORDER BY duong_dan_tuong_doi"):
        media_type = _IMAGE_MEDIA_TYPES.get(posixpath.splitext(rel)[1].lower())
        if media_type is None or not sendable(rel):  # .svg là XML, không phải ảnh raster
            continue
        try:
            raw = file_path(src, rel).read_bytes()
        except OSError:
            continue
        if len(raw) > _MAX_IMAGE_BYTES:
            continue
        chunks.append(Chunk(id=f"c{len(chunks) + 1}", files=[rel], system=system, user=prompt.image_user(rel),
                            images=[base64.standard_b64encode(raw).decode("ascii")], image_types=[media_type]))
    return chunks


def membership_signature(files: list[str]) -> str:
    """Chữ ký thành viên của một cụm (như `.graphify_labels.json.sig`): SHA256 danh sách tệp đã sắp xếp."""
    return hashlib.sha256("\n".join(sorted(files)).encode("utf-8")).hexdigest()


def _labels(store: GraphStore) -> list[Chunk]:
    lines: list[tuple[str, int, str]] = []
    for community in store.communities():
        # Chỉ nhãn node (tên symbol/tệp), không có thân hàm hay chú thích: nút có nhiều quan hệ nhất trước.
        rows = store.conn.execute(
            "SELECT n.nhan FROM nut n WHERE n.ma_khoi = ? AND n.loai_nut NOT IN ('repository', 'directory')"
            " ORDER BY (SELECT count(*) FROM canh c WHERE c.ma_nut_nguon = n.ma_nut OR c.ma_nut_dich = n.ma_nut) DESC,"
            " n.ma_nut LIMIT 200", (community["id"],)).fetchall()
        names: list[str] = []
        for (label,) in rows:
            label = label.strip().strip("()")[:LABEL_MAXLEN]
            if label and label.lower() not in {n.lower() for n in names}:
                names.append(label)
            if len(names) >= LABEL_TOP_K:
                break
        if names:
            lines.append((", ".join(names), community["id"], membership_signature(community["files"])))
    chunks = []
    for start in range(0, len(lines), LABEL_BATCH):
        batch = lines[start:start + LABEL_BATCH]
        # Số thứ tự trong khối (không dùng ma_khoi) để cùng cụm luôn ra cùng prompt và trúng cache sau khi index lại.
        meta = {str(i): [community_id, sig] for i, (_, community_id, sig) in enumerate(batch, 1)}
        user = prompt.labels_user([f"{i}: {names}" for i, (names, _, _) in enumerate(batch, 1)])
        chunks.append(Chunk(id=f"c{len(chunks) + 1}", files=[], system=prompt.LABEL_SYSTEM, user=user,
                            max_output_tokens=min(256 + 48 * len(batch), OUTPUT_TOKENS), meta=meta))
    return chunks


def plan(target: str, store: GraphStore, src: Sources, prs: list[dict] | None = None) -> list[Chunk]:
    if target in ("docs", "deep"):
        return _docs(store, src, deep=target == "deep")
    if target == "images":
        return _images(store, src)
    if target == "labels":
        return _labels(store)
    if target == "pr_triage":
        if not prs:
            return []
        return [Chunk(id="c1", files=[], system=prompt.TRIAGE_SYSTEM, user=prompt.triage_user(prs),
                      max_output_tokens=min(256 + 96 * len(prs), OUTPUT_TOKENS),
                      meta={"numbers": [pr["number"] for pr in prs]})]
    if target == "dedup":  # chạy cục bộ, không gọi model
        return []
    raise ValueError(target)
