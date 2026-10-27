import urllib.parse

import pytest


def q(s: str) -> str:
    return urllib.parse.quote(s, safe="")


@pytest.fixture
def indexed(api, copy_fixture):
    p = api.open(copy_fixture("bookstore_app"))
    assert api.index(p["project_id"])["state"] == "done"
    return api, p["project_id"]


def test_root_view_shape(indexed):
    api, pid = indexed
    r = api.get(f"/v1/projects/{pid}/architecture")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"parent", "blocks", "links"} and body["parent"] is None
    assert {b["id"] for b in body["blocks"]} == {"dir:lib", "dir:test"}
    assert set(body["blocks"][0]) == {"id", "label", "kind", "size", "symbols", "drillable"}
    assert set(body["links"][0]) == {"from", "to", "count", "types"}
    assert api.get(f"/v1/projects/{pid}/architecture?parent=").json() == body  # rỗng = gốc


def test_drill_down_with_encoded_id(indexed):
    api, pid = indexed
    body = api.get(f"/v1/projects/{pid}/architecture?parent={q('dir:lib/services')}").json()
    assert body["parent"] == {"id": "dir:lib/services", "label": "services"}
    assert {b["id"] for b in body["blocks"]} == {"file:lib/services/api_client.dart", "file:lib/services/auth_service.dart"}


def test_unknown_block_404(indexed):
    api, pid = indexed
    r = api.get(f"/v1/projects/{pid}/architecture?parent={q('dir:nope')}")
    assert r.status_code == 404 and r.json()["error"]["code"] == "unknown_block"
    r = api.get(f"/v1/projects/{pid}/architecture/evidence?from={q('dir:nope')}&to={q('dir:lib')}")
    assert r.status_code == 404 and r.json()["error"]["code"] == "unknown_block"
    assert api.get("/v1/projects/nope/architecture").status_code == 404


def test_link_count_equals_evidence_total(indexed):
    api, pid = indexed
    for parent in ("", "dir:lib", "dir:lib/services"):
        view = api.get(f"/v1/projects/{pid}/architecture?parent={q(parent)}").json()
        assert view["links"]
        for l in view["links"]:
            ev = api.get(f"/v1/projects/{pid}/architecture/evidence?from={q(l['from'])}&to={q(l['to'])}&limit=200").json()
            assert len(ev) == l["count"], (parent, l)
            assert all(set(e) == {"edge", "file", "line"} and e["line"] == e["edge"]["evidence"]["line"] for e in ev)


def test_evidence_params(indexed):
    api, pid = indexed
    base = f"/v1/projects/{pid}/architecture/evidence?from={q('dir:lib/screens')}&to={q('dir:lib/services')}"
    assert api.get(f"/v1/projects/{pid}/architecture/evidence?from={q('dir:lib')}").status_code == 400  # thiếu to
    assert api.get(f"/v1/projects/{pid}/architecture/evidence").status_code == 400
    for bad in ("&limit=0", "&limit=201", "&limit=abc"):
        assert api.get(base + bad).status_code == 400, bad
    assert len(api.get(base + "&limit=1").json()) == 1


def test_unicode_block_ids(api, tmp_path):
    root = tmp_path / "Đồ án" / "proj"
    for rel, text in (("lib/màn hình/a.dart", "class A {}\n"), ("lib/màn hình/b.dart", "import 'a.dart';\nclass B {}\n")):
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(text, encoding="utf-8")
    pid = api.open(root)["project_id"]
    assert api.index(pid)["state"] == "done"
    view = api.get(f"/v1/projects/{pid}/architecture?parent={q('dir:lib/màn hình')}").json()
    (link,) = view["links"]
    ev = api.get(f"/v1/projects/{pid}/architecture/evidence?from={q(link['from'])}&to={q(link['to'])}").json()
    assert ev[0]["file"] == "lib/màn hình/b.dart"


def test_arch_routes_need_token_and_host(indexed):
    api, pid = indexed
    for u in (f"/v1/projects/{pid}/architecture", f"/v1/projects/{pid}/architecture/evidence?from=a&to=b"):
        assert api.client.get(u).status_code == 401
        assert api.client.get(u, headers={**api.headers, "Host": "evil.com"}).status_code == 403
