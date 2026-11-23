from nexgraph_engine.report.build import report_json, report_markdown


def test_report_excludes_tests_and_files(copy_fixture, index_project):
    root = copy_fixture("py_mini")
    store, _, _ = index_project(root)
    r = report_json(store, root)
    assert set(r) == {"god_nodes", "communities", "surprising", "questions", "benchmark", "truncated",
                      "warnings", "cycles", "freshness", "gaps"}
    assert r["god_nodes"] and all(not g["node"]["is_test"] and g["node"]["kind"] != "file" for g in r["god_nodes"])
    assert r["god_nodes"] == sorted(r["god_nodes"], key=lambda g: -g["degree"])
    assert all(c["id"].startswith("com:") for c in r["communities"])
    assert all(set(q) == {"question", "why"} for q in r["questions"])
    assert r["truncated"] is False


def test_report_markdown_has_sections(copy_fixture, index_project):
    store, _, _ = index_project(copy_fixture("py_mini"))
    md = report_markdown(store, "py_mini")
    assert md.startswith("#") and "helper" in md


def test_report_markdown_has_no_invented_figures(copy_fixture, index_project):
    # Không có số từ thật và không gọi LLM: không in "~N words" hay "Token cost: 0 input".
    store, _, _ = index_project(copy_fixture("py_mini"))
    md = report_markdown(store, "py_mini")
    assert "words" not in md and "Token cost" not in md
    assert "- 3 files" in md


def test_report_route_unindexed_project(api, tmp_path):
    (tmp_path / "a.py").write_text("x = 1\n")
    pid = api.open(tmp_path)["project_id"]
    r = api.get(f"/v1/projects/{pid}/report")
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_indexed"


def test_report_route_ok(api, copy_fixture):
    pid = api.open(copy_fixture("py_mini"))["project_id"]
    assert api.index(pid)["state"] == "done"
    r = api.get(f"/v1/projects/{pid}/report")
    assert r.status_code == 200 and r.json()["god_nodes"]


def test_report_uses_published_graph_during_reindex(api, copy_fixture, monkeypatch):
    from nexgraph_engine.schema.db import open_graph_db
    from nexgraph_engine.store.graph_store import GraphStore
    pid = api.open(copy_fixture("py_mini"))["project_id"]
    assert api.index(pid)["state"] == "done"
    url = f"/v1/projects/{pid}/report"
    published = api.get(url).json()
    jobs = api.app.state.services.jobs
    monkeypatch.setattr(jobs, "is_active", lambda p: p == pid)
    r = api.get(url)
    assert r.status_code == 200 and r.json() == published
    monkeypatch.undo()
    # Lần lập chỉ mục tại chỗ từ một bản cũ có thể đã làm mất đồ thị tốt.
    conn = open_graph_db(api.app.state.services.registry.get(pid).graph_db)
    store = GraphStore(conn)
    store.set_run_state(store.begin_run(3), "huy")
    conn.close()
    r = api.get(url)
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_indexed"


def test_audit_ratios_sum_to_one(copy_fixture, index_project):
    from nexgraph_engine.report.build import audit_json
    store, _, _ = index_project(copy_fixture("bookstore_app"))
    audit = audit_json(store)
    want = dict(store.conn.execute("SELECT muc_tin_cay, count(*) FROM canh GROUP BY muc_tin_cay").fetchall())
    assert {k: v["count"] for k, v in audit["by_confidence"].items() if v["count"]} == want
    assert audit["edges"] == sum(want.values())
    assert abs(sum(v["ratio"] for v in audit["by_confidence"].values()) - 1) < 1e-3


def test_audit_lists_parse_errors(copy_fixture, index_project):
    from nexgraph_engine.report.build import audit_json
    store, _, _ = index_project(copy_fixture("bookstore_app"))  # lib/broken.dart cú pháp hỏng
    errors = audit_json(store)["parse_errors"]
    assert errors["total"] >= 1
    assert any(f["file"] == "lib/broken.dart" for f in errors["files"])
    assert sum(errors["by_kind"].values()) == errors["total"]


def _write(root, files):
    root.mkdir(parents=True, exist_ok=True)
    for rel, text in files.items():
        (root / rel).write_text(text, encoding="utf-8")
    return root


def test_report_lists_import_cycles(tmp_path, index_project):
    root = _write(tmp_path / "p", {"a.py": "import b\n\ndef fa():\n    return b.fb()\n",
                                   "b.py": "import a\n\ndef fb():\n    return 1\n"})
    store, _, _ = index_project(root)
    cycles = report_json(store, root)["cycles"]
    assert cycles["total"] == 1 and cycles["cycles"][0]["files"] == ["a.py", "b.py"]


def test_report_freshness_without_git(copy_fixture, index_project):
    root = copy_fixture("py_mini")
    store, _, _ = index_project(root)
    r = report_json(store, root)
    assert r["freshness"]["head_commit"] is None and r["freshness"]["stale"] is False
    assert r["cycles"]["total"] == 0


def test_report_gaps_isolated_and_ambiguous(tmp_path, index_project):
    # Như Graphify: nút chỉ có một cạnh chứa (khai báo không ai dùng) là bình thường, không phải lỗ hổng;
    # cô lập = không có láng giềng nào, hoặc đúng một láng giềng qua cạnh không phải cấu trúc chứa.
    root = _write(tmp_path / "p", {"m.py": "def lonely():\n    return 1\n\ndef caller():\n    return used()\n\n"
                                           "def used():\n    return 2\n\ndef orphan():\n    return 3\n"})
    store, _, _ = index_project(root)
    store.conn.execute("UPDATE canh SET muc_tin_cay = 'AMBIGUOUS', diem_tin_cay = 0.2 WHERE loai_canh = 'CALLS'")
    store.conn.execute("DELETE FROM canh WHERE ma_nut_dich = (SELECT ma_nut FROM nut WHERE nhan = 'orphan')")
    gaps = report_json(store, root)["gaps"]
    assert [n["label"] for n in gaps["isolated"]["nodes"]] == ["orphan"] and gaps["isolated"]["total"] == 1
    assert gaps["ambiguous_edges"]["total"] == 1
    assert gaps["ambiguous_edges"]["edges"][0]["confidence"] == "AMBIGUOUS"


def test_report_surfaces_benchmark_failure(copy_fixture, index_project, monkeypatch):
    """M3: benchmark hỏng thì mục benchmark biến mất nhưng phải kèm cảnh báo cho người dùng."""
    root = copy_fixture("py_mini")
    store, _, _ = index_project(root)

    def boom(**_kwargs):
        raise RuntimeError("benchmark nổ")

    monkeypatch.setattr("graphify.benchmark.run_benchmark", boom)
    report = report_json(store, root)
    assert report["benchmark"] is None
    assert any("benchmark" in message and "benchmark nổ" in message for message in report["warnings"])


def test_report_questions_in_vietnamese(copy_fixture, index_project):
    """A6 #2: câu hỏi/báo cáo do engine sinh phải theo `lang`, không luôn tiếng Anh."""
    root = copy_fixture("py_mini")
    store, _, _ = index_project(root)
    report = report_json(store, root, lang="vi")
    assert report["questions"] and report["surprising"]
    text = " ".join([*(q["question"] or "" for q in report["questions"]),
                     *(q["why"] for q in report["questions"]), *(s["why"] for s in report["surprising"])])
    for english in ("Are the", "inferred relationships", "actually correct", "model-reasoned",
                    "not explicitly stated", "weakly-connected", "Should `"):
        assert english not in text
    assert "quan hệ suy luận" in text and "INFERRED" in text
    assert any("không được nêu rõ trong mã nguồn" in s["why"] for s in report["surprising"])


def test_report_default_stays_english(copy_fixture, index_project):
    root = copy_fixture("py_mini")
    store, _, _ = index_project(root)
    report = report_json(store, root)
    assert report["questions"][0]["question"].startswith("Are the ")


def test_report_route_accepts_lang(api, copy_fixture):
    pid = api.open(copy_fixture("py_mini"))["project_id"]
    assert api.index(pid)["state"] == "done"
    default = api.get(f"/v1/projects/{pid}/report").json()
    assert default["questions"][0]["question"].startswith("Are the ")
    vi = api.get(f"/v1/projects/{pid}/report", params={"lang": "vi"})
    assert vi.status_code == 200
    assert vi.json()["questions"][0]["question"].startswith("2 quan hệ suy luận")
    bad = api.get(f"/v1/projects/{pid}/report", params={"lang": "fr"})
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "bad_param"


def test_translate_every_graphify_message():
    from nexgraph_engine.report.i18n import translate_questions, translate_surprising
    questions = [
        {"type": "ambiguous_edge", "question": "What is the exact relationship between `A` and `B`?",
         "why": "Edge tagged AMBIGUOUS (relation: calls) - confidence is low."},
        {"type": "bridge_node", "question": "Why does `x` connect `C1` to `C2`, `C3`?",
         "why": "High betweenness centrality (0.123) - this node is a cross-community bridge."},
        {"type": "verify_inferred",
         "question": "Are the 2 inferred relationships involving `a` (e.g. with `b` and `c`) actually correct?",
         "why": "`a` has 2 INFERRED edges - model-reasoned connections that need verification."},
        {"type": "isolated_nodes", "question": "What connects `a`, `b` to the rest of the system?",
         "why": "2 weakly-connected nodes found - possible missing edges."},
        {"type": "low_cohesion", "question": "Should `C` be split into smaller, more focused modules?",
         "why": "Cohesion score 0.1 - nodes in this community are weakly interconnected."},
        {"type": "no_signal", "question": None,
         "why": "Not enough signal to generate questions. This usually means the corpus has no AMBIGUOUS edges, "
                "no bridge nodes, no INFERRED relationships, and all communities are tightly cohesive. "
                "Add more files or run with --mode deep to extract richer edges."},
    ]
    out = translate_questions(questions, "vi")
    assert out[0]["question"] == "Mối quan hệ chính xác giữa `A` và `B` là gì?"
    assert out[0]["why"] == "Cạnh được gắn nhãn AMBIGUOUS (quan hệ: calls) - độ tin cậy thấp."
    assert out[1]["question"] == "Vì sao `x` nối `C1` với `C2`, `C3`?"
    assert out[1]["why"] == "Betweenness centrality cao (0.123) - nút này là cầu nối giữa các cộng đồng."
    assert out[2]["question"] == "2 quan hệ suy luận liên quan tới `a` (ví dụ với `b` và `c`) có thực sự đúng không?"
    assert out[2]["why"] == "`a` có 2 cạnh INFERRED - các kết nối do mô hình suy ra, cần kiểm chứng."
    assert out[3]["question"] == "Điều gì nối `a`, `b` với phần còn lại của hệ thống?"
    assert out[3]["why"] == "Có 2 nút ít kết nối - nghi thiếu cạnh."
    assert out[4]["question"] == "Có nên tách `C` thành các mô-đun nhỏ hơn, tập trung hơn không?"
    assert out[4]["why"] == "Độ gắn kết 0.1 - các nút trong cộng đồng này liên kết lỏng."
    assert out[5]["why"].startswith("Không đủ tín hiệu để sinh câu hỏi.")
    assert translate_questions(questions, "en") == questions

    surprising = [
        {"why": "inferred connection - not explicitly stated in source; "
                "peripheral node `login` unexpectedly reaches hub `login_user`"},
        {"why": "crosses file types (code ↔ doc)"},
        {"why": "connects across different repos/directories"},
        {"why": "bridges separate communities"},
        {"why": "semantically similar concepts with no structural link"},
        {"why": "Bridges graph structure (betweenness=0.123)"},
        {"why": "Bridges community 1 → community 2"},
        {"why": "cross-file semantic connection"},
    ]
    vi = translate_surprising(surprising, "vi")
    assert vi[0]["why"] == ("kết nối INFERRED - không được nêu rõ trong mã nguồn; "
                            "nút ngoại vi `login` bất ngờ chạm tới hub `login_user`")
    assert vi[1]["why"] == "vượt loại tệp (mã ↔ tài liệu)"
    assert vi[2]["why"] == "nối các repo/thư mục khác nhau"
    assert vi[3]["why"] == "bắc cầu giữa các cộng đồng riêng"
    assert vi[4]["why"] == "khái niệm tương đồng ngữ nghĩa nhưng không có liên kết cấu trúc"
    assert vi[5]["why"] == "Bắc cầu cấu trúc đồ thị (betweenness=0.123)"
    assert vi[6]["why"] == "Bắc cầu cộng đồng 1 → cộng đồng 2"
    assert vi[7]["why"] == "kết nối ngữ nghĩa giữa các tệp"
    assert translate_surprising(surprising, "en") == surprising

