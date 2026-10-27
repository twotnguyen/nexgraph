"""Dựng khối kiến trúc và mũi tên tổng hợp (spec §5.7). Khối tính khi truy vấn từ cây thư mục; cộng đồng chỉ dùng
khi một thư mục có quá nhiều tệp rời. Mũi tên chỉ từ cạnh IMPORTS/CALLS thật giữa hai tệp.
"""
from __future__ import annotations

import posixpath
import sqlite3
from collections import Counter, defaultdict
from dataclasses import dataclass, field

MAX_BLOCKS = 12
KEEP = MAX_BLOCKS - 1          # số mục giữ lại khi phải gộp phần còn lại vào một khối `group`
MANY_LOOSE_FILES = 8           # từ ngần này tệp rời trở lên (và quá nhiều mục) thì chia theo cộng đồng
LINK_TYPES = ("IMPORTS", "CALLS")


class UnknownBlock(KeyError):
    """Id khối không dựng lại được."""


@dataclass(frozen=True)
class Block:
    id: str
    label: str
    kind: str          # directory | community | file | group
    size: int          # số tệp
    symbols: int       # số nút ký hiệu trong các tệp đó (không tính nút tệp)
    drillable: bool


@dataclass(frozen=True)
class Link:
    source: str
    target: str
    count: int
    types: dict[str, int]


@dataclass(frozen=True)
class ArchView:
    parent: tuple[str, str] | None
    blocks: list[Block]
    links: list[Link]


@dataclass
class _Item:
    id: str
    label: str
    kind: str
    files: list[str] = field(default_factory=list)


class _Ctx:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn
        self.files = [r[0] for r in conn.execute("SELECT duong_dan_tuong_doi FROM tep ORDER BY 1")]
        self.file_set = set(self.files)
        self.symbols: Counter[str] = Counter(dict(conn.execute(
            "SELECT t.duong_dan_tuong_doi, count(*) FROM nut n JOIN tep t ON t.ma_tep = n.ma_tep"
            " WHERE n.loai_nut <> 'file' GROUP BY 1").fetchall()))
        self.comm_name = {r[0]: r[1] for r in conn.execute("SELECT ma_khoi, ten FROM khoi_kien_truc")}
        self.comm_files: dict[int, list[str]] = defaultdict(list)
        self.comm_of: dict[str, int] = {}
        for path, k in conn.execute(
                "SELECT t.duong_dan_tuong_doi, n.ma_khoi FROM nut n JOIN tep t ON t.ma_tep = n.ma_tep"
                " WHERE n.loai_nut = 'file' AND n.ma_khoi IS NOT NULL ORDER BY 1"):
            self.comm_files[k].append(path)
            self.comm_of[path] = k


def _partition(ctx: _Ctx, files: list[str], base: str) -> list[_Item]:
    """Quy tắc 1–4 của kế hoạch: nhóm theo thư mục con, thu gọn chuỗi một thư mục, chia tệp rời theo cộng đồng."""
    while True:
        dirs: dict[str, list[str]] = defaultdict(list)
        loose: list[str] = []
        for f in files:
            rest = f[len(base) + 1:] if base else f
            seg, sep, _ = rest.partition("/")
            (dirs[seg] if sep else loose).append(f)
        if not loose and len(dirs) == 1:
            seg = next(iter(dirs))
            base = f"{base}/{seg}" if base else seg
            continue
        break
    items = [_Item(f"dir:{base}/{s}" if base else f"dir:{s}", s, "directory", fs) for s, fs in dirs.items()]
    loose_items = [_Item(f"file:{f}", posixpath.basename(f), "file", [f]) for f in loose]
    if len(items) + len(loose_items) > MAX_BLOCKS and len(loose) >= MANY_LOOSE_FILES and ctx.comm_files:
        loose_set = set(loose)
        pure = sorted(k for k in {ctx.comm_of[f] for f in loose if f in ctx.comm_of}
                      if set(ctx.comm_files[k]) <= loose_set)  # chỉ cộng đồng nằm trọn trong các tệp rời này
        in_comm = {f for k in pure for f in ctx.comm_files[k]}
        loose_items = [i for i in loose_items if i.files[0] not in in_comm]
        items += [_Item(f"com:{k}", ctx.comm_name[k], "community", list(ctx.comm_files[k])) for k in pure]
    items += loose_items
    return sorted(items, key=lambda i: (-len(i.files), i.label))


def _full_items(ctx: _Ctx, parent: str | None) -> list[_Item]:
    """Danh sách mục (đã sắp xếp, chưa gộp `group`) của màn có khối cha `parent`."""
    if not parent:
        return _partition(ctx, ctx.files, "")
    kind, _, rest = parent.partition(":")
    if kind == "dir":
        files = [f for f in ctx.files if f.startswith(rest + "/")] if rest else []
        if not files:
            raise UnknownBlock(parent)
        return _partition(ctx, files, rest)
    if kind == "com":
        try:
            files = ctx.comm_files[int(rest)]
        except (ValueError, KeyError):
            raise UnknownBlock(parent) from None
        dirs = sorted({posixpath.dirname(f) for f in files})
        return _partition(ctx, list(files), posixpath.commonpath(dirs) if dirs else "")
    if kind == "more":
        items = _full_items(ctx, rest or None)
        if len(items) <= MAX_BLOCKS:
            raise UnknownBlock(parent)
        return items[KEEP:]
    raise UnknownBlock(parent)


def _shown(items: list[_Item], parent: str | None) -> list[_Item]:
    if len(items) <= MAX_BLOCKS:
        return items
    rest = items[KEEP:]
    group = _Item(f"more:{parent or ''}", f"Khác ({len(rest)} mục)", "group", [f for i in rest for f in i.files])
    return [*items[:KEEP], group]


def _label(ctx: _Ctx, parent: str) -> str:
    kind, _, rest = parent.partition(":")
    if kind == "dir":
        return rest.rsplit("/", 1)[-1]
    if kind == "com":
        return ctx.comm_name[int(rest)]
    return f"Khác ({len(_full_items(ctx, parent))} mục)"


def files_of_block(conn: sqlite3.Connection, block_id: str) -> list[str]:
    ctx = _Ctx(conn)
    kind, _, rest = block_id.partition(":")
    if kind == "file":
        if rest in ctx.file_set:
            return [rest]
        raise UnknownBlock(block_id)
    if kind == "dir":
        files = [f for f in ctx.files if f.startswith(rest + "/")] if rest else []
    elif kind == "com":
        try:
            files = list(ctx.comm_files[int(rest)])
        except (ValueError, KeyError):
            files = []
    elif kind == "more":
        files = [f for i in _full_items(ctx, block_id) for f in i.files]
    else:
        files = []
    if not files:
        raise UnknownBlock(block_id)
    return files


def build_view(conn: sqlite3.Connection, parent: str | None = None) -> ArchView:
    ctx = _Ctx(conn)
    parent = parent or None
    if parent and parent.startswith("file:"):
        raise UnknownBlock(parent)
    items = _shown(_full_items(ctx, parent), parent)
    scope = set(ctx.files) if parent is None else set(files_of_block(conn, parent))
    block_of = {f: i.id for i in items for f in i.files}
    blocks = [Block(i.id, i.label, i.kind, len(i.files), sum(ctx.symbols[f] for f in i.files), i.kind != "file")
              for i in items]
    agg: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
    for a, b, t, n in conn.execute(
            "SELECT ts.duong_dan_tuong_doi, td.duong_dan_tuong_doi, c.loai_canh, count(*)"
            " FROM canh c JOIN nut ns ON ns.ma_nut = c.ma_nut_nguon JOIN nut nd ON nd.ma_nut = c.ma_nut_dich"
            " JOIN tep ts ON ts.ma_tep = ns.ma_tep JOIN tep td ON td.ma_tep = nd.ma_tep"
            f" WHERE c.loai_canh IN ({','.join('?' * len(LINK_TYPES))}) AND ns.ma_tep <> nd.ma_tep GROUP BY 1, 2, 3",
            LINK_TYPES):
        if a in scope and b in scope:
            src, dst = block_of.get(a), block_of.get(b)
            if src and dst and src != dst:
                agg[(src, dst)][t] += n
    links = [Link(s, d, sum(c.values()), dict(sorted(c.items()))) for (s, d), c in agg.items()]
    links.sort(key=lambda l: (-l.count, l.source, l.target))
    return ArchView((parent, _label(ctx, parent)) if parent else None, blocks, links)
