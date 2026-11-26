"""Mở dự án từ URL GitHub/GitLab: chỉ nhận https github.com/gitlab.com, clone vào thư mục dữ liệu rồi đăng ký."""
import subprocess
import time

import pytest

from nexgraph_engine.indexing.sources import clone as clone_module
from nexgraph_engine.indexing.sources.clone import parse_repo_url


def wait_job(api, job_id, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        job = api.get(f"/v1/jobs/{job_id}").json()
        if job["state"] in ("done", "error", "cancelled"):
            return job
        time.sleep(0.05)
    raise AssertionError("job không kết thúc")


@pytest.fixture
def local_repo(tmp_path):
    repo = tmp_path / "remote" / "demo"
    repo.mkdir(parents=True)
    (repo / "app.py").write_text("def main():\n    return helper()\n\ndef helper():\n    return 1\n", encoding="utf-8")
    git = ["git", "-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false"]
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    subprocess.run([*git, "-C", str(repo), "add", "."], check=True)
    subprocess.run([*git, "-C", str(repo), "commit", "-qm", "init"], check=True)
    return repo


@pytest.mark.parametrize("url", [
    "https://github.com/owner/repo", "https://github.com/owner/repo.git", "https://github.com/owner/repo/",
    "https://gitlab.com/group/sub/repo", "https://gitlab.com/group/repo.git",
])
def test_parse_accepts_github_and_gitlab(url):
    assert parse_repo_url(url) == "repo"


@pytest.mark.parametrize("url", [
    "http://github.com/owner/repo", "https://evil.com/owner/repo", "https://github.com.evil.com/a/b",
    "https://github.com/owner", "https://github.com/owner/repo/tree/main", "https://github.com/owner/repo;rm",
    "file:///tmp/repo", "ftp://github.com/a/b", "https://user:pw@github.com/a/b", "https://github.com/-x/repo",
    "https://github.com/owner/..", "git@github.com:owner/repo.git", "",
])
def test_parse_rejects_other_urls(url):
    with pytest.raises(ValueError):
        parse_repo_url(url)


def test_clone_bad_host_is_400(api):
    r = api.post("/v1/projects/clone", json={"url": "https://example.com/owner/repo"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_url"


def test_clone_registers_project(api, local_repo, monkeypatch):
    monkeypatch.setattr(clone_module, "git_remote", lambda url: local_repo.as_uri())
    r = api.post("/v1/projects/clone", json={"url": "https://github.com/owner/demo"})
    assert r.status_code == 202, r.text
    job = wait_job(api, r.json()["job_id"])
    assert job["state"] == "done", job
    assert job["kind"] == "clone" and job["project_id"] is None
    project = job["result"]["project"]
    clones = api.app.state.services.data_dir / "clones"
    path = clones / project["path"].rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    assert path.parent == clones and path.name.startswith("demo-") and len(path.name) == len("demo-") + 8
    assert (path / "app.py").is_file() and project["is_git"] is True and project["name"] == path.name
    assert any(p["project_id"] == project["project_id"] for p in api.get("/v1/projects").json())
    assert api.index(project["project_id"])["state"] == "done"


def test_failed_clone_leaves_nothing(api, tmp_path, monkeypatch):
    monkeypatch.setattr(clone_module, "git_remote", lambda url: (tmp_path / "missing").as_uri())
    r = api.post("/v1/projects/clone", json={"url": "https://gitlab.com/group/missing"})
    job = wait_job(api, r.json()["job_id"])
    assert job["state"] == "error" and job["message"]
    clones = api.app.state.services.data_dir / "clones"
    assert not clones.exists() or not any(clones.iterdir())


def test_depth_capped(api):
    r = api.post("/v1/projects/clone", json={"url": "https://github.com/owner/repo", "depth": 51})
    assert r.status_code == 400


def test_clone_size_cap_kills_and_cleans(local_repo, tmp_path, monkeypatch):
    import threading
    monkeypatch.setattr(clone_module, "git_remote", lambda url: local_repo.as_uri())
    dest = tmp_path / "clones" / "demo-1"
    with pytest.raises(RuntimeError, match="vượt"):
        clone_module.clone_repo("https://github.com/owner/demo", dest, depth=1, cancel=threading.Event(), max_bytes=10)
    assert not dest.exists()


def test_failed_open_removes_clone(api, local_repo, monkeypatch):
    monkeypatch.setattr(clone_module, "git_remote", lambda url: local_repo.as_uri())

    def boom(path):
        raise RuntimeError("không mở được")

    monkeypatch.setattr(api.app.state.services.registry, "open_project", boom)
    job = wait_job(api, api.post("/v1/projects/clone", json={"url": "https://github.com/owner/demo"}).json()["job_id"])
    assert job["state"] == "error"
    clones = api.app.state.services.data_dir / "clones"
    assert not clones.exists() or not any(clones.iterdir())
