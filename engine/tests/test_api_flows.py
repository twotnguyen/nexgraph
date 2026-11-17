def test_list_flows_sorted_and_searchable(api, pid_flow):
    pid = pid_flow
    r = api.get(f"/v1/projects/{pid}/flows").json()
    assert r["total"] == 3 and r["truncated"] is False
    assert [f["name"] for f in r["flows"]][0] == "login"
    f = r["flows"][0]
    assert set(f) == {"id", "name", "kind", "detail", "entry", "steps", "files", "depth", "criticality", "truncated"}
    assert f["entry"]["id"] == "app.py::login#function" and f["kind"] == "route" and f["detail"] == 'app.post("/auth/login")'
    assert [x["name"] for x in api.get(f"/v1/projects/{pid}/flows", params={"q": "save_session"}).json()["flows"]] == ["login"]
    assert [x["name"] for x in api.get(f"/v1/projects/{pid}/flows", params={"q": "/BOOKS"}).json()["flows"]] == ["books"]
    assert api.get(f"/v1/projects/{pid}/flows", params={"kind": "main"}).json()["total"] == 1
    assert api.get(f"/v1/projects/{pid}/flows", params={"kind": "x"}).status_code == 400
    by_node = api.get(f"/v1/projects/{pid}/flows", params={"node": "repo.py::all_books#function"}).json()
    assert {x["name"] for x in by_node["flows"]} == {"books", "main"}
    page = api.get(f"/v1/projects/{pid}/flows", params={"limit": 1, "offset": 1}).json()
    assert len(page["flows"]) == 1 and page["total"] == 3 and page["truncated"] is True


def test_list_flows_combines_search_with_kind_and_node(api, pid_flow):
    """Tổ hợp q+kind/q+node: placeholder của WHERE, ORDER BY, LIMIT phải bind đúng thứ tự."""
    pid = pid_flow
    by_kind = api.get(f"/v1/projects/{pid}/flows", params={"q": "login", "kind": "route"}).json()
    assert by_kind["total"] == 1 and [f["name"] for f in by_kind["flows"]] == ["login"]

    by_node = api.get(f"/v1/projects/{pid}/flows", params={
        "q": "save_session", "node": "repo.py::save_session#function"}).json()
    assert by_node["total"] == 1 and [f["name"] for f in by_node["flows"]] == ["login"]

    no_match = api.get(f"/v1/projects/{pid}/flows", params={"q": "login", "kind": "main"}).json()
    assert no_match["total"] == 0 and no_match["flows"] == []


def test_flow_detail_has_caller_and_line(api, pid_flow):
    pid = pid_flow
    fid = api.get(f"/v1/projects/{pid}/flows", params={"q": "login"}).json()["flows"][0]["id"]
    d = api.get(f"/v1/projects/{pid}/flows/{fid}").json()
    assert [s["order"] for s in d["steps"]] == [0, 1, 2, 3, 4, 5]
    assert d["steps"][0]["caller"] is None and d["steps"][0]["depth"] == 0
    s1 = d["steps"][1]
    assert (s1["node"]["id"], s1["caller"], s1["line"], s1["depth"]) == (
        "service.py::login_user#function", "app.py::login#function", 9, 1)
    assert api.get(f"/v1/projects/{pid}/flows/999999").json()["error"]["code"] == "unknown_flow"


def test_flows_require_finished_index(api, tmp_path):
    p = api.open(tmp_path)
    assert api.get(f"/v1/projects/{p['project_id']}/flows").status_code in (404, 409)
