"""W11: nguồn bổ sung (PostgreSQL, Cargo, manifest, SCIP, MCP) đi vào cùng CSDL đồ thị."""
import threading
import time
from pathlib import Path, PurePosixPath

import pytest

from nexgraph_engine.index import extra_sources
from nexgraph_engine.index.extra_sources import ExtraSources
from nexgraph_engine.index.indexer import Indexer
from nexgraph_engine.index.refresh import refresh_project
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.store.freshness import freshness
from nexgraph_engine.store.graph_store import GraphStore

SECRET = "matkhau-bi-mat"
DSN = f"postgresql://u:{SECRET}@db.local/shop"


@pytest.fixture
def run(tmp_path):
    """run(root, sources) -> store sau một lần index đầy đủ có nguồn bổ sung."""
    conns = []

    def _run(root: Path, sources: ExtraSources):
        conn = open_graph_db(tmp_path / f"g{len(conns)}.db")
        conns.append(conn)
        store = GraphStore(conn)
        store.init_project(root.name, has_git=False)
        Indexer(store, root, on_progress=lambda e: None, cancel=threading.Event(), sources=sources).run()
        return store
    yield _run
    for c in conns:
        c.close()


def _nodes(store, path):
    return {(r[0], r[1]) for r in store.conn.execute(
        "SELECT n.nhan, n.loai_nut FROM nut n JOIN tep t ON t.ma_tep = n.ma_tep WHERE t.duong_dan_tuong_doi = ?", (path,))}


def _edges(store, path):
    return {(r[0], r[1], r[2]) for r in store.conn.execute(
        "SELECT ns.nhan, c.loai_canh, nd.nhan FROM canh c JOIN nut ns ON ns.ma_nut = c.ma_nut_nguon"
        " JOIN nut nd ON nd.ma_nut = c.ma_nut_dich JOIN tep t ON t.ma_tep = ns.ma_tep"
        " WHERE t.duong_dan_tuong_doi = ? AND c.loai_canh <> 'DEFINES'", (path,))}


def _error(store, path):
    row = store.conn.execute("SELECT l.chi_tiet FROM loi_phan_tich l JOIN tep t ON t.ma_tep = l.ma_tep"
                             " WHERE t.duong_dan_tuong_doi = ?", (path,)).fetchone()
    return row[0] if row else None


def test_scip_cargo_mcp(run, copy_fixture):
    root = copy_fixture("extra_sources")
    store = run(root, ExtraSources(cargo=True, scip_files=("index.scip.json",), mcp_files=(str(root / ".mcp.json"),)))
    assert {("Shape", "class"), ("Circle", "class"), ("area", "method")} <= _nodes(store, "nguon://scip")
    assert ("Circle", "IMPLEMENTS", "Shape") in _edges(store, "nguon://scip")
    assert {("core-lib", "package"), ("app", "package")} <= _nodes(store, "nguon://cargo")
    assert _edges(store, "nguon://cargo") == {("app", "DEPENDS_ON", "core-lib")}
    mcp = _nodes(store, "nguon://mcp")
    assert {("github", "resource"), ("GITHUB_TOKEN", "config_key")} <= mcp
    assert not any("ghp_" in label for label, _ in mcp)
    # tệp thật vẫn được index như thường; tệp ảo nối vào repository
    assert ("main", "function") in _nodes(store, "src/main.py")
    assert store.conn.execute("SELECT count(*) FROM tep WHERE duong_dan_tuong_doi LIKE 'nguon://%'").fetchone()[0] == 3


def test_manifests_link_across_files(run, tmp_path):
    root = tmp_path / "mono"
    for name, deps in (("alpha", '["beta>=1", "requests"]'), ("beta", "[]")):
        (root / name).mkdir(parents=True)
        (root / name / "pyproject.toml").write_text(f'[project]\nname = "{name}"\ndependencies = {deps}\n')
    store = run(root, ExtraSources(manifests=True))
    assert {("alpha", "package"), ("beta", "package")} <= _nodes(store, "nguon://manifest")
    assert _edges(store, "nguon://manifest") == {("alpha", "DEPENDS_ON", "beta")}
    assert store.file_record("alpha/pyproject.toml") is None  # "Tệp cấu hình" tắt: tệp thật không vào đồ thị


def test_postgres_with_mocked_introspect(run, tmp_path, monkeypatch):
    from graphify.extract import extract_sql
    ddl = ('CREATE TABLE "public"."users" (id INT);\nCREATE TABLE "public"."orders" (id INT);\n'
           'ALTER TABLE "public"."orders" ADD CONSTRAINT "fk" FOREIGN KEY ("uid") REFERENCES "public"."users"("id");\n')
    seen = []
    monkeypatch.setattr(extra_sources, "introspect_postgres",
                        lambda dsn: seen.append(dsn) or extract_sql(PurePosixPath("postgresql://db.local/shop"), content=ddl))
    (tmp_path / "p").mkdir()
    store = run(tmp_path / "p", ExtraSources(postgres_dsn=DSN))
    assert seen == [DSN + "?connect_timeout=10"]
    assert {("public.users", "table"), ("public.orders", "table")} <= _nodes(store, "nguon://postgres")
    assert ("public.orders", "REFERENCES", "public.users") in _edges(store, "nguon://postgres")
    assert SECRET not in repr(ExtraSources(postgres_dsn=DSN))


def test_failing_sources_are_file_errors_not_job_errors(run, tmp_path, monkeypatch):
    def boom(dsn):
        raise ConnectionError(f"could not connect: {dsn}")
    monkeypatch.setattr(extra_sources, "introspect_postgres", boom)
    root = tmp_path / "p"
    root.mkdir()
    (root / "a.py").write_text("x = 1\n")
    (root / "bad.scip").write_bytes(b"\x0a\x03abc")
    store = run(root, ExtraSources(postgres_dsn=DSN, cargo=True, scip_files=("bad.scip", "missing.json")))
    assert store.last_completed_run() is not None
    assert "Cargo.toml" in _error(store, "nguon://cargo")
    assert "JSON" in _error(store, "nguon://scip") and "missing.json" in _error(store, "nguon://scip")
    pg = _error(store, "nguon://postgres")
    assert pg and SECRET not in pg and DSN not in pg


def test_rb22_edge_lines_widen_node_range():
    nodes, edges = extra_sources.convert("nguon://x", lambda n: extra_sources.NodeKind.TABLE, [{
        "nodes": [{"id": "a", "label": "a", "source_location": "L2"}, {"id": "b", "label": "b", "source_location": "L1"}],
        "edges": [{"source": "a", "target": "b", "relation": "references", "source_location": "L9"},
                  {"source": "b", "target": "a", "relation": "references"},
                  {"source": "a", "target": "ghost", "relation": "references"}]}])
    a = next(n for n in nodes if n.label == "a")
    assert (a.line_start, a.line_end) == (2, 9)
    refs = [e for e in edges if e.type.value == "REFERENCES"]
    assert len(refs) == 2 and all(e.line for e in refs)


def test_refresh_and_freshness_keep_virtual_files(run, copy_fixture):
    root = copy_fixture("extra_sources")
    store = run(root, ExtraSources(cargo=True))
    assert freshness(store, root)["changed_files"] == 0
    time.sleep(1.1)
    (root / "src" / "main.py").write_text("def main():\n    return 2\n")
    result = refresh_project(store, root)
    assert result.removed == 0 and result.changed == 1
    assert ("app", "package") in _nodes(store, "nguon://cargo")
    assert freshness(store, root)["changed_files"] == 0


# --- API ------------------------------------------------------------------------------------------
def _wait(api, job_id):
    for _ in range(400):
        job = api.get(f"/v1/jobs/{job_id}").json()
        if job["state"] in ("done", "error", "cancelled"):
            return job
        time.sleep(0.05)
    raise AssertionError("job không xong")


def _virtual(api, pid):
    langs = api.get(f"/v1/projects/{pid}/stats").json()["languages"]
    return {lang for lang in langs if lang.startswith("nguon_")}


def test_index_route_sources(api, copy_fixture):
    pid = api.open(copy_fixture("extra_sources"))["project_id"]
    assert _wait(api, api.post(f"/v1/projects/{pid}/index", json={}).json()["job_id"])["state"] == "done"
    assert _virtual(api, pid) == set()
    r = api.post(f"/v1/projects/{pid}/index", json={"sources": {"cargo": True, "scip_files": ["index.scip.json"]}})
    assert _wait(api, r.json()["job_id"])["state"] == "done"
    assert _virtual(api, pid) == {"nguon_cargo", "nguon_scip"}
    assert "nguon_cargo" not in api.get(f"/v1/projects/{pid}/stats").json()["generic_languages"]


def test_dsn_never_reaches_disk_or_job(api, copy_fixture, tmp_path, monkeypatch):
    def boom(dsn):
        raise RuntimeError(f"invalid dsn {dsn}")
    monkeypatch.setattr(extra_sources, "introspect_postgres", boom)
    pid = api.open(copy_fixture("py_mini"))["project_id"]
    r = api.post(f"/v1/projects/{pid}/index", json={"sources": {"postgres_dsn": DSN}})
    job = _wait(api, r.json()["job_id"])
    assert job["state"] == "done" and SECRET not in str(job)
    for f in tmp_path.rglob("*"):
        if f.is_file():
            assert SECRET.encode() not in f.read_bytes(), f


def test_tools_report_psycopg(api):
    assert "psycopg" in api.get("/v1/tools").json()


# --- sửa sau kiểm thử độc lập ---------------------------------------------------------------------
LEAKY_DSNS = ["host=h password=se SECRETtail", "host=h password='a b SECRETq'", "postgresql://u:p%40SECRET@h/db"]


class _ProgrammingError(Exception):
    """Giống psycopg.ProgrammingError: không đi qua vendor nên thông báo chưa được làm sạch."""


@pytest.mark.parametrize("dsn", LEAKY_DSNS)
def test_postgres_errors_never_leak_password(run, tmp_path, monkeypatch, dsn):
    def boom(d):
        raise _ProgrammingError(f'invalid dsn: missing "=" after "{d.split()[-1]}" in {d} / p@SECRET')
    monkeypatch.setattr(extra_sources, "introspect_postgres", boom)
    (tmp_path / "p").mkdir()
    store = run(tmp_path / "p", ExtraSources(postgres_dsn=dsn))
    store.conn.commit()
    assert "_ProgrammingError" in _error(store, "nguon://postgres")
    for f in tmp_path.rglob("*"):
        if f.is_file():
            assert b"SECRET" not in f.read_bytes(), f


def test_postgres_keeps_vendor_sanitised_messages(run, tmp_path, monkeypatch):
    seen = []

    def fail(d):
        seen.append(d)
        raise ConnectionError("could not connect to PostgreSQL: connection refused")
    monkeypatch.setattr(extra_sources, "introspect_postgres", fail)
    (tmp_path / "p").mkdir()
    store = run(tmp_path / "p", ExtraSources(postgres_dsn="host=h dbname=d"))
    assert "connection refused" in _error(store, "nguon://postgres")
    assert seen == ["host=h dbname=d connect_timeout=10"]


def test_connect_timeout_added_once():
    t = extra_sources._with_timeout
    assert t("postgresql://u@h/db") == "postgresql://u@h/db?connect_timeout=10"
    assert t("postgresql://u@h/db?sslmode=require") == "postgresql://u@h/db?sslmode=require&connect_timeout=10"
    assert t("host=h connect_timeout=3") == "host=h connect_timeout=3"


def test_scip_bom_and_bad_shapes(run, tmp_path, copy_fixture):
    root = copy_fixture("extra_sources")
    (root / "bom.json").write_bytes(b"\xef\xbb\xbf" + (root / "index.scip.json").read_bytes())
    (root / "list.json").write_text("[1, 2, 3]")
    (root / "docs.json").write_text('{"documents": {}}')
    store = run(root, ExtraSources(scip_files=("bom.json", "list.json", "docs.json")))
    assert ("Circle", "class") in _nodes(store, "nguon://scip")
    err = _error(store, "nguon://scip")
    assert "list.json" in err and "docs.json" in err and "bom.json" not in err


def test_scip_size_cap_is_16mb():
    assert extra_sources.MAX_FILE_BYTES == 16 * 1024 * 1024


def test_code_route_explains_virtual_nodes(api, copy_fixture):
    pid = api.open(copy_fixture("extra_sources"))["project_id"]
    r = api.post(f"/v1/projects/{pid}/index", json={"sources": {"cargo": True}})
    assert _wait(api, r.json()["job_id"])["state"] == "done"
    r = api.get(f"/v1/projects/{pid}/code", params={"file": "nguon://cargo", "start": 1, "end": 1})
    assert r.status_code == 404
    assert "nguồn bổ sung" in r.json()["error"]["message"]
