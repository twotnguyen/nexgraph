import pytest


@pytest.fixture
def indexed(api, copy_fixture):
    p = api.open(copy_fixture("bookstore_app"))
    assert api.index(p["project_id"])["state"] == "done"
    return api, p["project_id"]


def test_search_returns_ranked_hits(indexed):
    api, pid = indexed
    r = api.get(f"/v1/projects/{pid}/search?q=login")
    assert r.status_code == 200
    hits = r.json()
    assert hits and set(hits[0]) == {"node", "score"} and "kind" in hits[0]["node"]
    scores = [h["score"] for h in hits]
    assert scores == sorted(scores, reverse=True)
    assert any(h["node"]["id"].endswith("AuthService.login#method") for h in hits)


@pytest.mark.parametrize("q", ["", "%20%20", "%22%22", "***"])
def test_blank_query_is_400(indexed, q):
    api, pid = indexed
    r = api.get(f"/v1/projects/{pid}/search?q={q}")
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_param"


def test_params_validated(indexed):
    api, pid = indexed
    for bad in ("&kinds=nope", "&limit=0", "&limit=101", "&limit=abc"):
        r = api.get(f"/v1/projects/{pid}/search?q=login{bad}")
        assert r.status_code == 400, bad
    assert api.get(f"/v1/projects/{pid}/search").status_code == 400
    ok = api.get(f"/v1/projects/{pid}/search?q=login&kinds=method,class&limit=3").json()
    assert len(ok) <= 3 and all(h["node"]["kind"] in ("method", "class") for h in ok)
    assert api.get("/v1/projects/nope/search?q=x").status_code == 404


def test_weird_queries_do_not_500(indexed):
    api, pid = indexed
    for q in ("%22unclosed", "NEAR(a%20b)", "login%3A", "%28%28%28", "-login", "x" * 3000):
        assert api.get(f"/v1/projects/{pid}/search?q={q}").status_code in (200, 400), q


def test_search_needs_token(indexed):
    api, pid = indexed
    assert api.client.get(f"/v1/projects/{pid}/search?q=login").status_code == 401


def test_all_stopword_query_gives_friendly_suggestion(indexed):
    """M5 (review 23/11): câu toàn hư từ trả gợi ý như ask/context, không phải câu cụt."""
    api, pid = indexed
    r = api.get(f"/v1/projects/{pid}/search", params={"q": "làm sao"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_param"
    assert "Chưa khớp từ khoá nào" in r.json()["error"]["message"]
    assert "AuthService" in r.json()["error"]["message"]


def test_meaningful_vietnamese_words_still_search(indexed):
    """`người dùng` không còn bị coi là toàn từ dừng (I2/M5): 200 + danh sách, không 400."""
    api, pid = indexed
    r = api.get(f"/v1/projects/{pid}/search", params={"q": "người dùng"})
    assert r.status_code == 200 and isinstance(r.json(), list)
