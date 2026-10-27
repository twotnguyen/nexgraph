"""Kịch bản demo bước 2 (bản đồ kiến trúc) và tìm kiếm, qua API như giao diện dùng."""
import urllib.parse


def q(s: str) -> str:
    return urllib.parse.quote(s, safe="")


def test_search_and_architecture_flow(api, copy_fixture):
    root = copy_fixture("bookstore_app")
    pid = api.open(root)["project_id"]
    assert api.index(pid)["state"] == "done"

    # tìm kiếm: login ra phương thức và màn hình
    hits = api.get(f"/v1/projects/{pid}/search?q=login").json()
    got = [h["node"]["id"] for h in hits]
    assert got[0] == "lib/services/auth_service.dart::AuthService.login#method"
    assert "lib/screens/login_screen.dart::LoginScreen#widget" in got
    first = hits[0]["node"]
    assert (root / first["file"]).read_text(encoding="utf-8").splitlines()[first["line_start"] - 1].lstrip().startswith("Future<User> login")

    # bản đồ kiến trúc: gốc -> lib -> mũi tên screens -> services
    root_view = api.get(f"/v1/projects/{pid}/architecture").json()
    assert {b["id"] for b in root_view["blocks"]} == {"dir:lib", "dir:test"}
    lib = api.get(f"/v1/projects/{pid}/architecture?parent={q('dir:lib')}").json()
    link = next(l for l in lib["links"] if l["from"] == "dir:lib/screens" and l["to"] == "dir:lib/services")
    ev = api.get(f"/v1/projects/{pid}/architecture/evidence?from={q(link['from'])}&to={q(link['to'])}&limit=200").json()
    assert len(ev) == link["count"]
    lines = (root / "lib/screens/login_screen.dart").read_text(encoding="utf-8").splitlines()
    by_type = {e["edge"]["type"]: e for e in ev}
    assert "auth_service" in lines[by_type["IMPORTS"]["line"] - 1]       # dòng bằng chứng đúng là dòng import
    assert "login(" in lines[by_type["CALLS"]["line"] - 1]               # và dòng gọi hàm
    assert all(e["file"] == "lib/screens/login_screen.dart" for e in ev)

    # khối tệp mở được thành nút; bằng chứng mở được nút nguồn
    file_block = next(b for b in lib["blocks"] if b["kind"] == "file")
    assert api.get(f"/v1/projects/{pid}/nodes/{q(file_block['id'].removeprefix('file:') + '#file')}").status_code == 200
    assert api.get(f"/v1/projects/{pid}/nodes/{q(by_type['CALLS']['edge']['source'])}").status_code == 200

    # lập chỉ mục lại cho cùng kết quả
    stats = api.get(f"/v1/projects/{pid}/stats").json()
    assert api.index(pid)["state"] == "done"
    assert api.get(f"/v1/projects/{pid}/stats").json() == stats
    assert api.get(f"/v1/projects/{pid}/architecture").json() == root_view


def test_subdir_index_then_search_is_scoped(api, copy_fixture):
    pid = api.open(copy_fixture("bookstore_app"))["project_id"]
    import time
    r = api.post(f"/v1/projects/{pid}/index", json={"subdir": "lib/screens"})
    assert r.status_code == 202
    for _ in range(300):
        if api.get(f"/v1/jobs/{r.json()['job_id']}").json()["state"] == "done":
            break
        time.sleep(0.02)
    hits = api.get(f"/v1/projects/{pid}/search?q=login").json()
    assert hits and all(h["node"]["file"].startswith("lib/screens/") for h in hits)
    assert api.get(f"/v1/projects/{pid}/search?q=AuthService").json() == []
    view = api.get(f"/v1/projects/{pid}/architecture").json()
    assert [b["id"] for b in view["blocks"]] == ["file:lib/screens/login_screen.dart"]


def test_scan_before_index(api, copy_fixture):
    pid = api.open(copy_fixture("bookstore_app"))["project_id"]
    scan = api.get(f"/v1/projects/{pid}/scan").json()
    assert scan["files"] == 9 and scan["large"] is False and scan["threshold"] == 5000
