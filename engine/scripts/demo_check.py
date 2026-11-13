"""Chạy kịch bản demo (docs/demo-script.md) bằng engine thật qua HTTP, không có giao diện, và bấm giờ từng bước.

Chạy: uv run python scripts/demo_check.py <thư-mục-NestJS> [--runs 3] [--out kết-quả.json]
Dự án được CHÉP sang thư mục tạm (kèm git init + commit). Đây là bằng chứng cho engine, KHÔNG thay cho việc bấm thử trên app Electron.
"""
import argparse
import json
import os
import shutil
import statistics
import subprocess
import tempfile
import time
from pathlib import Path

from fastapi.testclient import TestClient

from nexgraph_engine.api.app import create_app

GIT_ENV = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull}
EDIT_FILE = "src/common/utils/string-util/string-util.service.ts"
TOKEN = "d" * 40


def git(root: Path, *args: str) -> None:
    subprocess.run(["git", "-c", "user.name=d", "-c", "user.email=d@d.d", "-c", "commit.gpgsign=false", *args],
                   cwd=root, env=GIT_ENV, check=True, capture_output=True)


def one_run(src: Path) -> dict:
    tmp = Path(tempfile.mkdtemp(prefix="ng-demo-"))
    try:
        root = tmp / "Đồ án" / "nestjs demo"
        shutil.copytree(src, root, ignore=shutil.ignore_patterns(".git", "node_modules", ".nexgraph"))
        git(root, "init", "-q", "-b", "main")
        git(root, "add", "-A")
        git(root, "commit", "-q", "-m", "init")
        app = create_app(TOKEN, {"testserver"}, data_dir=tmp / "appdata")
        c = TestClient(app)
        h = {"Authorization": f"Bearer {TOKEN}"}
        res: dict = {}

        def get(path, **kw):
            r = c.get(path, headers=h, **kw)
            assert r.status_code == 200, (path, r.text)
            return r.json()

        t = time.perf_counter()  # bước 1+2: mở thư mục, lập chỉ mục
        pid = c.post("/v1/projects", json={"path": str(root)}, headers=h).json()["project_id"]
        jid = c.post(f"/v1/projects/{pid}/index", headers=h).json()["job_id"]
        while (job := get(f"/v1/jobs/{jid}"))["state"] not in ("done", "error"):
            time.sleep(0.05)
        assert job["state"] == "done", job
        res["index_s"] = round(time.perf_counter() - t, 2)
        base = f"/v1/projects/{pid}"
        t = time.perf_counter()
        arch = get(f"{base}/architecture")
        res["architecture_blocks"] = [b["label"] for b in arch["blocks"]]
        res["map_nodes"] = len(get(f"{base}/map", params={"detail": 400})["nodes"])
        res["step2_s"] = round(time.perf_counter() - t, 3)
        t = time.perf_counter()  # bước 3: luồng đăng nhập
        flows = get(f"{base}/flows", params={"limit": 500})["flows"]
        sign_in = next(f for f in flows if f["name"] == "signIn")
        steps = get(f"{base}/flows/{sign_in['id']}")["steps"]
        res["signin_flow"] = [s["node"]["id"].split("#")[0] for s in steps]
        ctx = c.post(f"{base}/context", json={"question": "luồng đăng nhập sign in chạy thế nào?"}, headers=h).json()
        res["context_items"] = len(ctx.get("items", []))
        res["step3_s"] = round(time.perf_counter() - t, 3)
        t = time.perf_counter()  # bước 4: sửa hàm, xem vùng ảnh hưởng và test
        p = root / EDIT_FILE
        p.write_text(p.read_text(encoding="utf-8").replace("return await bcrypt.compare(value, valueHashed);",
                                                            "return await bcrypt.compare(value, valueHashed); // sửa khi demo"), encoding="utf-8")
        ch = get(f"{base}/changes")
        res["changed_nodes"] = [n["id"].split("#")[0] for n in ch["changed_nodes"]]
        res["impacted"] = [i["node"]["id"].split("#")[0] for i in ch["impacted"]][:10]
        res["tests"] = [n["id"].split("#")[0] if isinstance(n, dict) and "id" in n else str(n) for n in ch.get("tests", [])][:10]
        res["step4_s"] = round(time.perf_counter() - t, 3)
        res["stale_after_edit"] = get(f"{base}/stats")["stale"]
        app.state.services.jobs.shutdown()
        return res
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("project", type=Path)
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()
    runs = [one_run(args.project.resolve()) for _ in range(args.runs)]
    total = [r["index_s"] + r["step2_s"] + r["step3_s"] + r["step4_s"] for r in runs]
    out = {"runs": runs, "total_median_s": round(statistics.median(total), 2), "total_max_s": round(max(total), 2)}
    print(json.dumps(out, indent=2, ensure_ascii=False))
    if args.out:
        args.out.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
