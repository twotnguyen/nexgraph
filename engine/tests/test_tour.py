from nexgraph_engine.tour.build import build_tour


def test_tour_of_flow_app(copy_fixture, index_project):
    store, _, _ = index_project(copy_fixture("flow_app"))
    steps = build_tour(store)["steps"]
    assert [s["order"] for s in steps] == list(range(1, len(steps) + 1)) and len(steps) <= 10
    first = steps[0]
    assert (first["kind"], first["title"], first["node"]["id"]) == ("entry", "Điểm khởi động", "app.py::main#function")
    assert first["body"] == "main trong app.py là nơi chương trình bắt đầu. Từ đây có 4 bước gọi tiếp qua 3 tệp."
    flows = [s for s in steps if s["kind"] == "flow"]
    assert len(flows) == 1
    assert flows[0]["title"] == "Luồng login"
    assert flows[0]["body"] == 'Điểm vào app.post("/auth/login"). Luồng đi qua 6 bước trong 3 tệp, kết thúc ở hash_password.'
    assert flows[0]["flow_id"] is not None and flows[0]["block_id"] is None
    hub = next(s for s in steps if s["kind"] == "hub")
    assert hub["node"]["kind"] in ("function", "method", "class") and not hub["node"]["is_test"]
    tests = steps[-1]
    assert tests["kind"] == "tests" and tests["body"] == "1 tệp kiểm thử, 1 hàm và lớp đã có test trỏ tới."


def test_tour_is_deterministic(copy_fixture, index_project):
    store, _, _ = index_project(copy_fixture("flow_app"))
    assert build_tour(store) == build_tour(store)


def test_tour_of_project_without_calls_is_empty(tmp_path, index_project):
    (tmp_path / "a.py").write_text("X = 1\n")
    store, _, _ = index_project(tmp_path)
    assert build_tour(store) == {"steps": []}


def test_tour_route(api, pid_flow):
    r = api.get(f"/v1/projects/{pid_flow}/tour")
    assert r.status_code == 200 and r.json()["steps"][0]["kind"] == "entry"


def test_tour_in_english(copy_fixture, index_project):
    """A6 #2: Tour phải theo ngôn ngữ UI; `lang=en` không được còn câu tiếng Việt."""
    import json
    store, _, _ = index_project(copy_fixture("flow_app"))
    steps = build_tour(store, lang="en")["steps"]
    first = steps[0]
    assert (first["title"], first["body"]) == (
        "Entry point", "main in app.py is where the program starts. From here 4 calls continue through 3 files.")
    flow = next(s for s in steps if s["kind"] == "flow")
    assert flow["title"] == "Flow login"
    assert flow["body"] == 'Entry point app.post("/auth/login"). The flow goes through 6 steps across 3 files and ends at hash_password.'
    community = next(s for s in steps if s["kind"] == "community")
    assert community["title"] == "Community: Cluster around service.py"
    assert community["body"] == "4 files are tightly coupled around service.py."
    assert next(s for s in steps if s["kind"] == "hub")["title"] == "Hotspot: login_user"
    assert steps[-1]["title"] == "Tests"
    assert steps[-1]["body"] == "1 test files, 1 functions and classes have tests pointing to them."
    # Không còn ký tự tiếng Việt nào trong toàn bộ tour.
    text = json.dumps(steps, ensure_ascii=False)
    assert not any(ch in text for ch in "ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ")


def test_tour_lang_vi_is_the_default(copy_fixture, index_project):
    store, _, _ = index_project(copy_fixture("flow_app"))
    assert build_tour(store, lang="vi") == build_tour(store)


def test_tour_route_accepts_lang(api, pid_flow):
    default = api.get(f"/v1/projects/{pid_flow}/tour").json()
    assert default["steps"][0]["title"] == "Điểm khởi động"
    en = api.get(f"/v1/projects/{pid_flow}/tour", params={"lang": "en"})
    assert en.status_code == 200 and en.json()["steps"][0]["title"] == "Entry point"
    bad = api.get(f"/v1/projects/{pid_flow}/tour", params={"lang": "fr"})
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "bad_param"
