import json


def test_events_stream_receives_progress(api, copy_fixture):
    p = api.open(copy_fixture("bookstore_app"))
    seen = []
    with api.client.stream("GET", "/v1/events", headers=api.headers) as r:
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
        assert api.post(f"/v1/projects/{p['project_id']}/index").status_code == 202
        for line in r.iter_lines():
            if line.startswith("data: "):
                seen.append(json.loads(line[6:]))
                if sum(1 for e in seen if e["type"] == "graph_updated") == 2:
                    break
    states = [e["state"] for e in seen if e["type"] == "job_progress"]
    assert states[0] == "queued" and "structure" in states and "resolve" in states and states[-1] in ("resolve", "done")
    assert all(e["project_id"] == p["project_id"] for e in seen)


def test_events_requires_auth(api):
    assert api.client.get("/v1/events").status_code == 401
