import shutil
import uuid

import pytest

from nexgraph_engine.global_graph.store import GlobalStore


def _edge(src_pid, dst_pid, src="a#function", dst="b#function"):
    return {"du_an_nguon": src_pid, "id_nut_nguon": src, "du_an_dich": dst_pid, "id_nut_dich": dst,
            "loai_canh": "CALLS", "loai_con": "member_call", "diem_tin_cay": 0.85,
            "tep_bang_chung": "src/a.ts", "dong_bang_chung": 3}


def test_global_store_add_remove_cascades_edges(tmp_path):
    g = GlobalStore(tmp_path)
    a, b, c = (str(uuid.uuid4()) for _ in range(3))
    assert g.add(a) and g.add(b) and g.add(c)
    assert not g.add(a)  # đã là thành viên
    assert [m[0] for m in g.members()] == [a, b, c]
    g.replace_edges([_edge(a, b), _edge(c, b, "x#function")])
    assert len(g.edges()) == 2
    assert g.remove(a)
    assert not g.remove(a)
    assert [(e["du_an_nguon"], e["du_an_dich"]) for e in g.edges()] == [(c, b)]
    assert (tmp_path / "global.db").is_file()
