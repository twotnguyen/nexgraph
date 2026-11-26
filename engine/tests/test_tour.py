from nexgraph_engine.analysis.tour.build import build_tour


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
    # M1 (review 23/11): nhãn cụm đã có tiền tố "Cụm" thì không ghép thêm lần nữa.
    community = next(s for s in steps if s["kind"] == "community")
    assert community["title"] == "Cụm quanh service.py" and "Cụm Cụm" not in community["title"]


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
    assert steps[-1]["body"] == "1 test file, 1 function or class has tests pointing to it."
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


def test_tour_english_plural_agreement(copy_fixture, index_project):
    """M4 (review 23/11): '1 test files'/'1 callers' sai số ít."""
    store, _, _ = index_project(copy_fixture("flow_app"))
    bodies = {s["title"]: s["body"] for s in build_tour(store, lang="en")["steps"]}
    assert bodies["Hotspot: books"] == "1 caller reaches books. Changes here have wide impact."
    assert bodies["Hotspot: login_user"] == "2 callers reach login_user. Changes here have wide impact."
    assert bodies["Tests"] == "1 test file, 1 function or class has tests pointing to it."


def test_tour_route_in_english_has_no_vietnamese(api, pid_flow):
    """rereview-45 Minor 1: tour EN không còn chuỗi Việt, kể cả nhãn cụm lưu tiếng Việt trong CSDL."""
    import json

    payload = api.get(f"/v1/projects/{pid_flow}/tour", params={"lang": "en"}).json()
    text = json.dumps(payload, ensure_ascii=False)
    assert "Cụm" not in text and "Cộng đồng" not in text
    assert "Điểm" not in text and "Kiểm thử" not in text
    assert not any(ch in text for ch in
                   "ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ")
    community = next(s for s in payload["steps"] if s["kind"] == "community")
    assert community["title"] == "Community: Cluster around service.py"


def test_community_label_covers_all_stored_forms():
    """Nhãn cụm engine lưu luôn là tiếng Việt (`Cụm quanh …`, `Cộng đồng N`, `Khác`) — EN phải dịch hết."""
    from nexgraph_engine.analysis.tour.build import _community_label

    assert _community_label("Cộng đồng 3", True) == "Community 3"
    assert _community_label("Khác", True) == "Other"
    assert _community_label("Cụm quanh service.py", True) == "Cluster around service.py"
    assert _community_label("Cộng đồng 3", False) == "Cộng đồng 3"
    assert _community_label("Khác", False) == "Khác"


def test_community_label_does_not_double_prefix():
    from nexgraph_engine.analysis.tour.build import _community_label
    assert _community_label("Cụm quanh auth_service.dart", False) == "Cụm quanh auth_service.dart"
    assert _community_label("Cụm quanh auth_service.dart", True) == "Cluster around auth_service.dart"
    assert _community_label("service", False) == "Cụm service"
