"""Các sự thật dữ liệu của kịch bản demo bước 2–3, qua API như giao diện dùng."""
import hashlib
import urllib.parse
from pathlib import Path


def q(s: str) -> str:
    return urllib.parse.quote(s, safe="")


def tree_hashes(root: Path) -> dict[str, str]:
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(root.rglob("*")) if p.is_file() and ".nexgraph" not in p.parts}


def test_demo_data_flow_over_api(api, copy_fixture):
    root = copy_fixture("bookstore_app")
    before = tree_hashes(root)
    p = api.open(root)
    pid = p["project_id"]
    assert p["storage"] == "in_project"
    assert (root / ".nexgraph" / ".gitignore").read_text() == "*\n"

    assert api.index(pid)["state"] == "done"
    first_stats = api.get(f"/v1/projects/{pid}/stats").json()

    # bước 2: cạnh IMPORTS giữa các tệp, có bằng chứng
    imp = api.get(f"/v1/projects/{pid}/neighbors?node={q('lib/screens/login_screen.dart#file')}&types=IMPORTS&direction=out").json()
    assert "lib/services/auth_service.dart#file" in {e["target"] for e in imp["edges"]}

    # bước 3: đường LoginScreen -> AuthService.login -> ApiClient.post chỉ qua cạnh CALLS
    build = "lib/screens/login_screen.dart::_LoginScreenState.build#method"
    walk = api.get(f"/v1/projects/{pid}/neighbors?node={q(build)}&types=CALLS&direction=out&depth=2").json()
    calls = {(e["source"], e["target"]) for e in walk["edges"]}
    login = "lib/services/auth_service.dart::AuthService.login#method"
    post = "lib/services/api_client.dart::ApiClient.post#method"
    assert (build, login) in calls and (login, post) in calls
    assert all(e["type"] == "CALLS" for e in walk["edges"])

    # mọi cạnh cần bằng chứng đều có tệp:dòng, và dòng đó có thật trong tệp
    everything = api.get(f"/v1/projects/{pid}/neighbors?node={q('.#repository')}&depth=3&limit=2000").json()
    needing = [e for e in everything["edges"] if e["type"] in ("CALLS", "IMPORTS", "INHERITS", "IMPLEMENTS")]
    assert needing
    for e in needing:
        ev = e["evidence"]
        assert ev and ev["file"] and ev["line"] >= 1
        assert ev["line"] <= len((root / ev["file"]).read_text(encoding="utf-8").splitlines())

    # mở code đúng dòng bằng chứng của một cạnh gọi hàm
    ev = next(e["evidence"] for e in walk["edges"] if e["target"] == post)
    code = api.get(f"/v1/projects/{pid}/code?file={q(ev['file'])}&start={ev['line']}&end={ev['line']}").json()
    assert "post" in code["text"] and code["stale"] is False

    # lập chỉ mục lại cho cùng kết quả; mở lại chỉ đọc đọc được ngay
    assert api.index(pid)["state"] == "done"
    assert api.get(f"/v1/projects/{pid}/stats").json() == first_stats
    assert tree_hashes(root) == before  # không sửa tệp nguồn nào
