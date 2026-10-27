# NexGraph — Kế hoạch con 1: Nền tảng (Tuần 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Có một repo `nexgraph` chạy được end-to-end tối thiểu. App Electron trên macOS và Windows tự khởi động engine Python (đã vendor Graphify), gọi được `/v1/health` và `/v1/selftest`. CI build ra bản cài cho cả hai hệ điều hành và tự kiểm tra bản cài. Kèm mockup UI, 2 báo cáo spike (Dart Tree-sitter, OpenCode ACP chỉ đọc) và khung SRS.

**Architecture:**
- Engine là một CLI Python (`nexgraph-engine serve`) chạy FastAPI trên `127.0.0.1` cổng ngẫu nhiên. Token đi qua biến môi trường `NEXGRAPH_TOKEN`. Khi sẵn sàng, engine in một dòng JSON `ready` ra stdout.
- Electron main spawn engine (lúc dev dùng `uv run`, bản đóng gói dùng binary PyInstaller trong `resources/engine/`), đọc dòng `ready`, rồi đưa trạng thái lên renderer qua IPC.
- Graphify được vendor nguyên văn tại commit `86c57be`.

**Tech Stack:** Python 3.12 + uv + FastAPI/uvicorn + pytest + PyInstaller · Electron 44 + electron-vite 6 + React 19 + TypeScript + vitest + Testing Library · pnpm · GitHub Actions (macos-latest, windows-latest, ubuntu-latest).

**Spec:** `docs/superpowers/specs/2026-10-18-nexgraph-desktop-design.md` · **Kế hoạch tổng:** `docs/superpowers/plans/2026-10-18-nexgraph-roadmap.md` (hợp đồng API v1, cấu trúc repo, enum).

## Global Constraints

- Hệ điều hành bắt buộc: **macOS và Windows** (spec §2). Mọi test và smoke chạy trên cả hai trong CI.
- Engine chỉ nghe `127.0.0.1`. Mọi route `/v1/*` yêu cầu `Authorization: Bearer <token>` và `Host` thuộc `{127.0.0.1:<port>, localhost:<port>}` (spec §5.1, §6.2).
- Token chỉ truyền qua biến môi trường `NEXGRAPH_TOKEN`, **không bao giờ** qua tham số dòng lệnh. Độ dài ≥ 32 ký tự.
- Không telemetry, không sửa file mã nguồn của người dùng (spec §5.10, §6.2). Kế hoạch con 1 chưa mở project nào nên chưa tạo `.nexgraph/`; `--data-dir` ở đây là dữ liệu cấp app.
- Graphify vendor tại commit `86c57be8204673c2a1b9849a3292a7dd3ab373d8` (0.9.92, 2026-10-16). Giữ `LICENSE`, `LICENSE-MIT`, `NOTICE`. Không dùng tên "Graphify" làm thương hiệu (spec §10).
- License NexGraph: Apache-2.0. Commit message không có dòng `Co-Authored-By`.
- Chuỗi giao diện mặc định tiếng Việt (spec §5.9).
- Python `>=3.12,<3.13`. Node ≥ 22. Electron `^44`.

## Review Focus

1. **Đường dẫn có dấu tiếng Việt hoặc khoảng trắng** (ví dụ `C:\Users\Nguyễn Văn A\…`, `Đồ án/dữ liệu`) trong data dir: engine phải khởi động và nhận đúng đường dẫn. *Test: Task 1 `test_serve_accepts_unicode_data_dir`, Task 3 `passes unicode data dir intact`.*
2. **Engine in log/cảnh báo ra stdout trước dòng `ready`**: launcher phải quét từng dòng, không giả định dòng đầu là `ready`. *Test: Task 3 `ignores noise before ready`.*
3. **Engine chết sau khi đã sẵn sàng**: UI phải chuyển sang trạng thái lỗi có nút "Khởi động lại", không đứng im. *Test: Task 3 `reports exit after ready`, Task 3 `EngineStatusBar shows error and restart`.*
4. **Tiến trình engine mồ côi trên Windows khi thoát app hoặc khi khởi động thất bại**: `stop()` phải diệt cả cây tiến trình; timeout phải diệt tiến trình. *Test: Task 3 `kills process on ready timeout`, `stop terminates process`.*
5. **Request từ trình duyệt với Host lạ (DNS rebinding)** có token bị lộ: phải trả 403. *Test: Task 1 `test_rejects_foreign_host`.*

---

### Task 1: Khởi tạo repo + engine skeleton (`serve`, `/v1/health`)

**Người:** P1

**Files:**
- Create: `nexgraph/` (git init), `README.md`, `LICENSE` (Apache-2.0 nguyên văn), `NOTICE`, `THIRD_PARTY_LICENSES.md`, `.gitignore`, `.editorconfig`
- Create: `docs/` ← chép spec và 2 file plan từ `DACN-CNTT/docs/superpowers/` vào `nexgraph/docs/superpowers/`
- Create: `engine/pyproject.toml`, `engine/src/nexgraph_engine/__init__.py`, `engine/src/nexgraph_engine/cli.py`, `engine/src/nexgraph_engine/api/__init__.py`, `engine/src/nexgraph_engine/api/app.py`
- Test: `engine/tests/test_api_health.py`, `engine/tests/test_cli_serve.py`

**Interfaces:**
- Produces:
  - `nexgraph_engine.__version__ = "0.1.0"`, `nexgraph_engine.GRAPHIFY_COMMIT = "86c57be8204673c2a1b9849a3292a7dd3ab373d8"`
  - `create_app(token: str, allowed_hosts: set[str]) -> fastapi.FastAPI`
  - `cli.main(argv: list[str] | None = None) -> int`. Lệnh: `nexgraph-engine serve --data-dir PATH [--port 0]`
  - Dòng sẵn sàng in ra stdout (một dòng, flush ngay): `{"event": "ready", "port": <int>, "pid": <int>}`
  - Thiếu hoặc ngắn `NEXGRAPH_TOKEN` → stderr `NEXGRAPH_TOKEN is required (>=32 chars)`, exit code `2`

- [ ] **Step 1: Cài công cụ và khởi tạo repo**

Cài `uv` (`curl -LsSf https://astral.sh/uv/install.sh | sh`, hoặc `winget install astral-sh.uv` trên Windows). `git init nexgraph`, tạo các file gốc ở trên, `uv init --package --name nexgraph-engine engine`. Trong `engine/pyproject.toml`:
- `requires-python = ">=3.12,<3.13"`
- deps: `fastapi`, `uvicorn`
- dev deps: `pytest`, `httpx`
- script `nexgraph-engine = "nexgraph_engine.cli:main"`
- `[tool.hatch.build.targets.wheel] packages = ["src/nexgraph_engine"]`

Chạy: `cd engine && uv sync`. Kỳ vọng: tạo được `.venv`, không lỗi.

- [ ] **Step 2: Viết test API (đang fail)**

```python
# engine/tests/test_api_health.py
from fastapi.testclient import TestClient
from nexgraph_engine import GRAPHIFY_COMMIT, __version__
from nexgraph_engine.api.app import create_app

TOKEN = "t" * 40

def client():
    return TestClient(create_app(TOKEN, {"testserver"}))

def test_health_ok_with_token():
    r = client().get("/v1/health", headers={"Authorization": f"Bearer {TOKEN}"})
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "api_version": "1",
                        "engine_version": __version__, "graphify_commit": GRAPHIFY_COMMIT}

def test_rejects_missing_or_wrong_token():
    c = client()
    assert c.get("/v1/health").status_code == 401
    r = c.get("/v1/health", headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"

def test_rejects_foreign_host():
    r = client().get("/v1/health", headers={"Authorization": f"Bearer {TOKEN}", "Host": "evil.com"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "forbidden_host"
```

Chạy: `cd engine && uv run pytest tests/test_api_health.py -v`. Kỳ vọng: FAIL (`ModuleNotFoundError: nexgraph_engine.api.app`).

- [ ] **Step 3: Cài đặt `create_app` trong `engine/src/nexgraph_engine/api/app.py`**

Một middleware kiểm tra Host trước, rồi đến token (so sánh bằng `hmac.compare_digest`). Lỗi theo dạng `{"error": {"code", "message"}}`. Mã lỗi: `forbidden_host` (403), `unauthorized` (401).

- [ ] **Step 4: Chạy test API**

Chạy: `uv run pytest tests/test_api_health.py -v`. Kỳ vọng: 3 PASS.

- [ ] **Step 5: Viết test CLI (đang fail)**

```python
# engine/tests/test_cli_serve.py
import json, os, subprocess, sys, urllib.request
import pytest

TOKEN = "k" * 40

def start(data_dir, token=TOKEN):
    env = {**os.environ, "NEXGRAPH_TOKEN": token} if token else {k: v for k, v in os.environ.items() if k != "NEXGRAPH_TOKEN"}
    return subprocess.Popen([sys.executable, "-m", "nexgraph_engine.cli", "serve", "--data-dir", str(data_dir), "--port", "0"],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", env=env)

def read_ready(p):
    for line in p.stdout:
        line = line.strip()
        if line.startswith("{") and json.loads(line).get("event") == "ready":
            return json.loads(line)
    pytest.fail("no ready line")

def test_serve_prints_ready_and_serves_health(tmp_path):
    p = start(tmp_path / "data")
    try:
        ready = read_ready(p)
        assert ready["pid"] == p.pid
        req = urllib.request.Request(f"http://127.0.0.1:{ready['port']}/v1/health",
                                     headers={"Authorization": f"Bearer {TOKEN}"})
        assert json.load(urllib.request.urlopen(req, timeout=5))["status"] == "ok"
        assert (tmp_path / "data").is_dir()
    finally:
        p.kill()

def test_serve_accepts_unicode_data_dir(tmp_path):
    d = tmp_path / "Đồ án ứng dụng" / "dữ liệu"
    p = start(d)
    try:
        read_ready(p)
        assert d.is_dir()
    finally:
        p.kill()

def test_serve_requires_token(tmp_path):
    p = start(tmp_path, token=None)
    assert p.wait(timeout=20) == 2
    assert "NEXGRAPH_TOKEN is required (>=32 chars)" in p.stderr.read()
```

Chạy: `uv run pytest tests/test_cli_serve.py -v`. Kỳ vọng: FAIL.

- [ ] **Step 6: Cài đặt `cli.main` trong `engine/src/nexgraph_engine/cli.py`**

- Dòng đầu của `main` gọi `multiprocessing.freeze_support()`, vì Graphify extract song song và cần chạy được trong bản PyInstaller.
- Dùng `argparse` với subcommand `serve`. Tạo data dir bằng `mkdir(parents=True, exist_ok=True)`.
- Tự `socket.bind(("127.0.0.1", port))` để biết cổng thật, tạo app với `allowed_hosts = {f"127.0.0.1:{p}", f"localhost:{p}"}`, in dòng ready (`flush=True`), rồi `uvicorn.Server(Config(app, log_level="warning")).run(sockets=[sock])`.
- Thêm `if __name__ == "__main__": raise SystemExit(main())`.

- [ ] **Step 7: Chạy toàn bộ test engine**

Chạy: `uv run pytest -v`. Kỳ vọng: 6 PASS.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(engine): serve command with token + host guard and /v1/health"
```

---

### Task 2: Vendor Graphify + `/v1/selftest` + chạy test gốc của Graphify

**Người:** P1

**Files:**
- Create: `engine/src/graphify/` (chép nguyên `repo-reference/graphify/graphify/` @ `86c57be`, bỏ `__pycache__`)
- Create: `engine/third_party/graphify/{LICENSE,LICENSE-MIT,NOTICE,UPSTREAM.md}`, `engine/third_party/graphify/tests/` (chép nguyên `repo-reference/graphify/tests/`), `engine/third_party/graphify/pytest.ini`
- Create: `engine/src/nexgraph_engine/selftest.py`, `engine/src/nexgraph_engine/resources/selftest/hello.py`
- Modify: `engine/pyproject.toml` (thêm deps runtime của Graphify, package `src/graphify`), `engine/src/nexgraph_engine/api/app.py` (route `/v1/selftest`), `THIRD_PARTY_LICENSES.md`, `NOTICE`
- Test: `engine/tests/test_selftest.py`

**Interfaces:**
- Consumes: `create_app` (Task 1)
- Produces:
  - `run_selftest() -> dict`, trả về `{"ok": bool, "nodes": int}`
  - `GET /v1/selftest` trả đúng dict đó (cùng auth như health)
  - File `engine/third_party/graphify/KNOWN_FAILURES.txt`: mỗi dòng một node id pytest, kèm comment `# lý do`

- [ ] **Step 1: Chép mã và license**

Chép như mục Files. `UPSTREAM.md` ghi: URL `https://github.com/Graphify-Labs/graphify`, commit `86c57be8204673c2a1b9849a3292a7dd3ab373d8`, phiên bản `0.9.92`, ngày `2026-10-16`, trạng thái "chưa sửa đổi khi nhập", cùng quy ước header khi sửa (xem kế hoạch tổng).

Thêm vào `engine/pyproject.toml` toàn bộ dependency bắt buộc của Graphify trong `repo-reference/graphify/pyproject.toml`: `networkx`, `numpy`, `rapidfuzz`, `tree-sitter>=0.25,<0.26` cùng 25 grammar, giữ nguyên ràng buộc phiên bản. Wheel packages: `["src/nexgraph_engine", "src/graphify"]`.

`THIRD_PARTY_LICENSES.md` có mục Graphify (Apache-2.0 + MIT cho phần trước 2026-07-22). `NOTICE` gốc có dòng "This product includes software developed by the Graphify contributors" và trỏ tới `engine/third_party/graphify/NOTICE`.

Chạy: `uv sync`. Kỳ vọng: thành công.

- [ ] **Step 2: Chạy test gốc của Graphify, lập baseline**

Chạy: `cd engine/third_party/graphify && uv run --project ../.. pytest tests -q -p no:cacheprovider`. `pytest.ini` chép mục `[tool.pytest.ini_options]` của upstream.

Mọi test fail hoặc error (thường do thiếu extras tuỳ chọn hoặc cần mạng) ghi vào `KNOWN_FAILURES.txt`, kèm lý do. `tests/conftest.py` của bản chép **không sửa**. Tạo plugin `engine/third_party/graphify/conftest_known.py`, nạp qua `-p conftest_known`. Plugin đọc `KNOWN_FAILURES.txt` và gắn `pytest.mark.skip(reason="known upstream failure")` trong `pytest_collection_modifyitems`.

Chạy lại: `uv run --project ../.. pytest tests -q -p conftest_known`. Kỳ vọng: 0 failed.

- [ ] **Step 3: Viết test selftest (đang fail)**

```python
# engine/tests/test_selftest.py
from fastapi.testclient import TestClient
from nexgraph_engine.api.app import create_app
from nexgraph_engine.selftest import run_selftest

def test_run_selftest_extracts_nodes():
    result = run_selftest()
    assert result["ok"] is True
    assert result["nodes"] >= 2   # file node + hàm greet

def test_selftest_route():
    c = TestClient(create_app("t" * 40, {"testserver"}))
    r = c.get("/v1/selftest", headers={"Authorization": "Bearer " + "t" * 40})
    assert r.status_code == 200 and r.json()["ok"] is True
```

`resources/selftest/hello.py` chứa `def greet(name):\n    return f"hi {name}"\n`.

Chạy: `uv run pytest tests/test_selftest.py -v`. Kỳ vọng: FAIL.

- [ ] **Step 4: Cài đặt `run_selftest` trong `engine/src/nexgraph_engine/selftest.py` và thêm route**

- Chép `hello.py` sang một thư mục tạm, vì package có thể nằm trong bản đóng gói chỉ đọc.
- Gọi `graphify.extract.extract([tmp/hello.py], cache_root=tmp, root=tmp, parallel=False)`.
- `nodes = len(result["nodes"])`, `ok = nodes >= 2`.
- Đọc resource bằng `importlib.resources.files("nexgraph_engine.resources.selftest")`.

- [ ] **Step 5: Chạy test engine**

Chạy: `uv run pytest -v`. Kỳ vọng: toàn bộ PASS (8 test).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(engine): vendor graphify@86c57be with licenses, upstream test baseline, /v1/selftest"
```

---

### Task 3: Electron shell + engine launcher + thanh trạng thái

**Người:** P2

**Files:**
- Create: `pnpm-workspace.yaml` (gồm `apps/*`), `package.json` gốc
- Create: `apps/desktop/` từ template `electron-vite` react-ts (`pnpm create @quick-start/electron`), đổi tên `@nexgraph/desktop`, productName `NexGraph`
- Create: `apps/desktop/src/main/engine/launcher.ts`, `apps/desktop/src/main/engine/resolve-command.ts`, `apps/desktop/src/main/engine/client.ts`, `apps/desktop/src/shared/engine-status.ts`
- Modify: `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/renderer/src/App.tsx`
- Create: `apps/desktop/src/renderer/src/components/EngineStatusBar.tsx`
- Test: `apps/desktop/test/launcher.test.ts`, `apps/desktop/test/resolve-command.test.ts`, `apps/desktop/test/fixtures/fake-engine.mjs`, `apps/desktop/src/renderer/src/components/EngineStatusBar.test.tsx`

**Interfaces:**
- Consumes: CLI `serve` và dòng ready, `/v1/health`, `/v1/selftest` (Task 1–2)
- Produces:

```ts
// src/main/engine/launcher.ts
export interface EngineCommand { command: string; args: string[]; cwd?: string }
export interface EngineHandle {
  baseUrl: string            // "http://127.0.0.1:<port>"
  token: string              // 64 ký tự hex (randomBytes(32))
  pid: number
  stop(): Promise<void>      // diệt cả cây tiến trình; resolve khi đã thoát
  onExit(cb: (code: number | null, signal: NodeJS.Signals | null) => void): void
}
export class EngineStartError extends Error { stderrTail: string }   // ≤ 4000 ký tự cuối của stderr
export function startEngine(cmd: EngineCommand,
  opts: { dataDir: string; readyTimeoutMs?: number /* mặc định 20000 */; env?: NodeJS.ProcessEnv }): Promise<EngineHandle>

// src/main/engine/resolve-command.ts
export function resolveEngineCommand(o: { isPackaged: boolean; resourcesPath: string; repoRoot: string;
  platform?: NodeJS.Platform }): EngineCommand

// src/main/engine/client.ts
export interface Health { status: 'ok'; api_version: '1'; engine_version: string; graphify_commit: string }
export function getHealth(h: Pick<EngineHandle, 'baseUrl' | 'token'>): Promise<Health>
export function getSelftest(h: Pick<EngineHandle, 'baseUrl' | 'token'>): Promise<{ ok: boolean; nodes: number }>

// src/shared/engine-status.ts
export type EngineStatus =
  | { state: 'starting' }
  | { state: 'ready'; engineVersion: string; graphifyCommit: string }
  | { state: 'error'; message: string }
```

- IPC: `engine:status` (invoke → `EngineStatus`), `engine:restart` (invoke), sự kiện `engine:status-changed`.
- Preload: `window.nexgraph.engine.{status(), restart(), onStatus(cb) → unsubscribe}`.
- Biến môi trường của app:
  - `NEXGRAPH_DATA_DIR`: ghi đè data dir. Mặc định `join(app.getPath('userData'), 'engine-data')`.
  - `NEXGRAPH_SMOKE=1`: chế độ tự kiểm, dùng ở Task 4.

- [ ] **Step 1: Khởi tạo workspace và app**

Tạo app từ template, thêm `vitest`, `@testing-library/react`, `jsdom`. Chạy `pnpm install` rồi `pnpm --filter @nexgraph/desktop dev`. Kỳ vọng: cửa sổ template mở được.

- [ ] **Step 2: Viết fake engine và test launcher (đang fail)**

`test/fixtures/fake-engine.mjs` là script Node, hành vi theo `process.env.FAKE_MODE`:
- `ok`: in `warming up…` rồi `{"event":"ready","port":P,"pid":…}`. Chạy HTTP server trên `127.0.0.1:0`. `GET /v1/health` kiểm tra `Authorization: Bearer ${NEXGRAPH_TOKEN}` rồi trả `{status:"ok", api_version:"1", engine_version:"0.0.0-fake", graphify_commit:"fake", argv: process.argv}`.
- `never-ready`: chỉ treo.
- `crash-before-ready`: ghi `boom` vào stderr, `exit(3)`.
- `crash-after-ready`: ready rồi `exit(5)` sau 100 ms.

```ts
// test/launcher.test.ts (vitest, môi trường node)
const fake = (mode: string): EngineCommand =>
  ({ command: process.execPath, args: [fileURLToPath(new URL('./fixtures/fake-engine.mjs', import.meta.url))] })
const run = (mode: string, extra: Partial<Parameters<typeof startEngine>[1]> = {}) =>
  startEngine(fake(mode), { dataDir: tmp(), env: { ...process.env, FAKE_MODE: mode }, ...extra })

it('resolves with baseUrl and authorised health', async () => {
  const h = await run('ok'); try {
    expect(h.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(h.token).toMatch(/^[0-9a-f]{64}$/)
    expect((await getHealth(h)).status).toBe('ok')
  } finally { await h.stop() } })
it('never puts the token in argv', async () => {
  const h = await run('ok'); try {
    const body = await (await fetch(`${h.baseUrl}/v1/health`, { headers: { Authorization: `Bearer ${h.token}` } })).json()
    expect(JSON.stringify(body.argv)).not.toContain(h.token)
  } finally { await h.stop() } })
it('ignores noise before ready', async () => { const h = await run('ok'); await h.stop() })
it('passes unicode data dir intact', async () => {
  const dir = join(tmp(), 'Đồ án ứng dụng', 'dữ liệu')
  const h = await run('ok', { dataDir: dir }); try {
    const body = await (await fetch(`${h.baseUrl}/v1/health`, { headers: { Authorization: `Bearer ${h.token}` } })).json()
    expect(body.argv).toEqual(expect.arrayContaining(['serve', '--data-dir', dir, '--port', '0']))
  } finally { await h.stop() } })
it('kills process on ready timeout', async () => {
  const err = await run('never-ready', { readyTimeoutMs: 300 }).catch(e => e)
  expect(err).toBeInstanceOf(EngineStartError)
  expect(isAlive(err.pid)).toBe(false) })
it('rejects with stderr tail when exiting before ready', async () => {
  const err = await run('crash-before-ready').catch(e => e)
  expect(err).toBeInstanceOf(EngineStartError); expect(err.stderrTail).toContain('boom') })
it('reports exit after ready', async () => {
  const h = await run('crash-after-ready')
  const code = await new Promise(r => h.onExit(c => r(c))); expect(code).toBe(5) })
it('stop terminates process', async () => {
  const h = await run('ok'); await h.stop(); expect(isAlive(h.pid)).toBe(false) })
```

Helper trong file test:
- `tmp()` là `mkdtempSync(join(os.tmpdir(), 'ng-'))`.
- `isAlive(pid)` dùng `process.kill(pid, 0)` trong try/catch.
- `fakeCmd` là `fake('ok')`, dùng lại ở Task 4.

`EngineStartError` có thêm trường `pid: number`.

Chạy: `pnpm --filter @nexgraph/desktop vitest run test/launcher.test.ts`. Kỳ vọng: FAIL.

- [ ] **Step 3: Cài đặt `startEngine` trong `launcher.ts`**

- Spawn với `args = [...cmd.args, 'serve', '--data-dir', dataDir, '--port', '0']`, `env = {...opts.env ?? process.env, NEXGRAPH_TOKEN: token, PYTHONUTF8: '1'}`, `windowsHide: true`.
- Đọc stdout theo dòng bằng `readline`. Chỉ `JSON.parse` các dòng bắt đầu bằng `{`. Giữ 4000 ký tự cuối của stderr.
- `stop()`:
  - Windows: `taskkill /pid <pid> /T /F`.
  - Nơi khác: `SIGTERM`, sau 3 s chưa thoát thì `SIGKILL`.
- Khi timeout hoặc thoát trước ready: gọi `stop()` rồi reject `EngineStartError`.

- [ ] **Step 4: Chạy test launcher**

Kỳ vọng: 8 PASS.

- [ ] **Step 5: Viết test `resolveEngineCommand` (đang fail) rồi cài đặt**

```ts
it('packaged darwin', () => expect(resolveEngineCommand({ isPackaged: true, resourcesPath: '/R', repoRoot: '/X', platform: 'darwin' }))
  .toEqual({ command: join('/R', 'engine', 'nexgraph-engine'), args: [] }))
it('packaged win32', () => expect(resolveEngineCommand({ isPackaged: true, resourcesPath: 'C:\\R', repoRoot: 'C:\\X', platform: 'win32' }).command)
  .toBe(join('C:\\R', 'engine', 'nexgraph-engine.exe')))
it('dev uses uv', () => expect(resolveEngineCommand({ isPackaged: false, resourcesPath: '', repoRoot: '/X' }))
  .toEqual({ command: 'uv', args: ['run', '--project', join('/X', 'engine'), 'nexgraph-engine'] }))
```

Chạy test. Kỳ vọng: sau khi cài đặt thì 3 PASS.

- [ ] **Step 6: Viết test `EngineStatusBar` (đang fail)**

```tsx
it('shows starting', () => { render(<EngineStatusBar status={{ state: 'starting' }} onRestart={() => {}} />)
  expect(screen.getByText('Engine: đang khởi động…')).toBeInTheDocument() })
it('shows ready with version', () => { render(<EngineStatusBar status={{ state: 'ready', engineVersion: '0.1.0', graphifyCommit: '86c57be' }} onRestart={() => {}} />)
  expect(screen.getByText('Engine: sẵn sàng (v0.1.0)')).toBeInTheDocument() })
it('EngineStatusBar shows error and restart', async () => { const onRestart = vi.fn()
  render(<EngineStatusBar status={{ state: 'error', message: 'exit 5' }} onRestart={onRestart} />)
  expect(screen.getByText('Engine: lỗi — exit 5')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Khởi động lại' })); expect(onRestart).toHaveBeenCalled() })
```

Chạy: `pnpm --filter @nexgraph/desktop vitest run src/renderer`. Kỳ vọng: FAIL.

- [ ] **Step 7: Cài đặt `EngineStatusBar` và nối main ↔ preload ↔ renderer**

- `EngineStatusBar` là component thuần, nhận `status` và `onRestart`.
- Main giữ một `EngineStatus` hiện tại. Khi `app.whenReady`, main gọi `startEngine(resolveEngineCommand(...))` rồi `getHealth` và chuyển sang `ready`. Engine thoát (`onExit`) hoặc start lỗi thì chuyển sang `error` với `message`: `exit <code>` hoặc dòng đầu của `stderrTail`. `engine:restart` thì stop rồi start lại. `before-quit` thì `await handle.stop()`.
- `App.tsx` render thanh trạng thái ở đáy cửa sổ.

- [ ] **Step 8: Chạy toàn bộ test + kiểm tra tay**

- Chạy: `pnpm --filter @nexgraph/desktop vitest run && pnpm --filter @nexgraph/desktop typecheck`. Kỳ vọng: tất cả PASS.
- Chạy `pnpm --filter @nexgraph/desktop dev` ở gốc repo. Kỳ vọng: đáy cửa sổ hiện `Engine: sẵn sàng (v0.1.0)`.
- Mở Activity Monitor hoặc Task Manager, kill `nexgraph-engine`. Kỳ vọng: UI hiện lỗi; bấm "Khởi động lại" thì về trạng thái sẵn sàng.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(desktop): electron shell launching engine sidecar with status bar"
```

---

### Task 4: Đóng gói engine (PyInstaller) + bản cài Electron + CI hai hệ điều hành + smoke test

**Người:** P1 (engine/CI macOS) + P3 (kiểm tra bản cài trên Windows thật)

**Files:**
- Create: `engine/packaging/nexgraph-engine.spec`, `apps/desktop/electron-builder.yml`, `apps/desktop/scripts/smoke-packaged.mjs`, `.github/workflows/ci.yml`
- Modify: `apps/desktop/src/main/index.ts` (chế độ smoke), `engine/pyproject.toml` (dev dep `pyinstaller`)
- Test: `apps/desktop/test/smoke-mode.test.ts`

**Interfaces:**
- Consumes: `startEngine`, `resolveEngineCommand`, `getHealth`, `getSelftest` (Task 3). `/v1/selftest` (Task 2).
- Produces:
  - Thư mục `engine/dist/nexgraph-engine/` (onedir), được electron-builder chép vào `resources/engine/`
  - Hàm `runSmoke(h: Pick<EngineHandle,'baseUrl'|'token'>): Promise<string>` trong `src/main/smoke.ts`. Trả `"SMOKE OK nodes=<n>"`, ném lỗi nếu health không ok hoặc `selftest.ok === false`.
  - Main ở chế độ `NEXGRAPH_SMOKE=1`: in kết quả `runSmoke` (hoặc `SMOKE FAIL <message>`), rồi `app.exit(0|1)`. Timeout tổng 90 s.

- [ ] **Step 1: Viết test `runSmoke` (đang fail)**

```ts
it('returns SMOKE OK with node count', async () => {
  const h = await startEngine(fakeCmd, { dataDir: tmp(), env: { ...process.env, FAKE_MODE: 'ok' } })
  try { expect(await runSmoke(h)).toBe('SMOKE OK nodes=2') } finally { await h.stop() } })
it('throws when selftest not ok', async () => {
  const h = await startEngine(fakeCmd, { dataDir: tmp(), env: { ...process.env, FAKE_MODE: 'ok', FAKE_SELFTEST: 'fail' } })
  try { await expect(runSmoke(h)).rejects.toThrow('selftest failed') } finally { await h.stop() } })
```

Mở rộng `fake-engine.mjs`: `GET /v1/selftest` trả `{ok:true,nodes:2}`, hoặc `{ok:false,nodes:0}` khi `FAKE_SELFTEST=fail`.

Chạy test. Kỳ vọng: FAIL.

- [ ] **Step 2: Cài đặt `runSmoke` và chế độ smoke trong main**

Chạy test. Kỳ vọng: 2 PASS.

- [ ] **Step 3: PyInstaller spec**

`nexgraph-engine.spec`:
- Entry `src/nexgraph_engine/cli.py`, onedir, name `nexgraph-engine`, console app.
- `collect_all` cho `graphify`, `nexgraph_engine` và mọi package `tree_sitter*` có trong môi trường (liệt kê bằng `importlib.metadata`), để không thiếu binding grammar.
- `datas` gồm `resources/selftest`.

Build:

```bash
cd engine && uv run pyinstaller packaging/nexgraph-engine.spec --noconfirm
NEXGRAPH_TOKEN=$(python -c "print('x'*40)") ./dist/nexgraph-engine/nexgraph-engine serve --data-dir /tmp/ng --port 0
```

Kỳ vọng: in dòng `ready`. Trong terminal khác, `curl -H "Authorization: Bearer xxxx…" http://127.0.0.1:<port>/v1/selftest` trả `{"ok":true,…}`. Trên Windows dùng `nexgraph-engine.exe` và `set NEXGRAPH_TOKEN=…`.

- [ ] **Step 4: electron-builder + smoke script**

`electron-builder.yml`:
- `appId: io.github.nexgraph.desktop`, `productName: NexGraph`
- `extraResources: [{from: ../../engine/dist/nexgraph-engine, to: engine}]`
- `mac.target: dmg`, `win.target: nsis`, không ký số

`scripts/smoke-packaged.mjs` tìm binary đã giải nén (`dist/mac*/NexGraph.app/Contents/MacOS/NexGraph` hoặc `dist/win-unpacked/NexGraph.exe`). Script chạy binary với `NEXGRAPH_SMOKE=1` và `NEXGRAPH_DATA_DIR=<tmp>/Đồ án/data`, timeout 90 s. Exit 0 nếu stdout có `SMOKE OK`; ngược lại in stdout/stderr và exit 1.

Chạy local:

```bash
pnpm --filter @nexgraph/desktop build && pnpm --filter @nexgraph/desktop exec electron-builder --dir && node apps/desktop/scripts/smoke-packaged.mjs
```

Kỳ vọng: `SMOKE OK nodes=…`, exit 0.

- [ ] **Step 5: CI**

`.github/workflows/ci.yml` chạy trên `push` và `pull_request`, gồm các job:
- `engine` (matrix `macos-latest`, `windows-latest`): `astral-sh/setup-uv`, `uv sync`, `uv run pytest engine/tests -v`.
- `graphify-upstream` (`ubuntu-latest`): chạy lệnh ở Task 2 Step 2 với `-p conftest_known`.
- `desktop` (matrix 2 OS): `pnpm/action-setup`, `actions/setup-node` (node 22), `pnpm install --frozen-lockfile`, `typecheck`, `vitest run`.
- `package` (matrix 2 OS, `needs: [engine, desktop]`): build PyInstaller, `electron-vite build`, `electron-builder` (`--publish never`, `CSC_IDENTITY_AUTO_DISCOVERY=false`), `node apps/desktop/scripts/smoke-packaged.mjs`, `actions/upload-artifact` cho file `.dmg` và `.exe`.

Push nhánh, mở PR. Kỳ vọng: cả 4 job xanh trên cả hai hệ điều hành.

- [ ] **Step 6: Kiểm tra bản cài trên máy thật**

- P3 tải `.exe` từ artifact CI, cài trên Windows (qua cảnh báo SmartScreen: "More info → Run anyway").
- P1 làm tương tự trên macOS với `.dmg` (chuột phải → Open).

Kỳ vọng: cả hai hiện `Engine: sẵn sàng (v0.1.0)`. Ghi kết quả, gồm cả các bước vượt cảnh báo, vào `docs/install-notes.md`.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "ci: package engine + desktop for macOS/Windows with packaged smoke test"
```

---

### Task 5: Mockup UI có thể bấm thử

**Người:** P2 · **Spec:** §5.9 (đã chốt: phải có mockup trước khi code UI)

**Files:**
- Create: `design/mockups/index.html` (trang mục lục), `design/mockups/projects.html`, `design/mockups/indexing.html`, `design/mockups/workspace.html`, `design/mockups/settings.html`, `design/mockups/README.md`

**Interfaces:**
- Produces: mockup đã được nhóm chốt. Kế hoạch con 2–6 lấy làm chuẩn bố cục và chuỗi văn bản.

- [ ] **Step 1: Dựng 4 màn hình bằng HTML/CSS tĩnh + JS tối thiểu**

Không framework. Dùng dữ liệu giả của một app Flutter, ví dụ `lib/screens/login_screen.dart`. Workspace phải có:
- Activity bar 4 mục: Explorer, Search, Changes, Tour
- Tab giữa: Kiến trúc, Graph, Flutter, một tab file `login_screen.dart`
- Cột chat phải thu gọn được bằng `Cmd/Ctrl+L`, có ít nhất một câu trả lời mẫu với chip trích dẫn `lib/auth/login_screen.dart:42–58` và một chip "chưa xác minh" bị gạch
- Inspector nổi khi bấm một node
- Status bar `index 100% · OpenCode v2.0.32 · HEAD a1b2c3d`
- Tab Changes có danh sách vùng ảnh hưởng + test liên quan + test gap

Văn bản tiếng Việt, thuật ngữ kỹ thuật giữ tiếng Anh. Mockup chạy được ở bề rộng 1280px và 1920px.

- [ ] **Step 2: Duyệt nhóm**

Mở `design/mockups/index.html` trong trình duyệt. Cả 3 người đi lại kịch bản demo spec §1.2, bước 1–4, trên mockup. Mọi thay đổi được chốt thì ghi vào `design/mockups/README.md`, mục "Quyết định". Kỳ vọng: README có dòng "Đã duyệt: <ngày>, P1/P2/P3".

- [ ] **Step 3: Commit**

```bash
git add design && git commit -m "docs(design): clickable UI mockups for projects/indexing/workspace/settings"
```

---

### Task 6: Spike — Tree-sitter Dart với phiên bản tree-sitter của engine

**Người:** P1 · **Spec:** §5.4, §12 (rủi ro grammar Dart)

**Files:**
- Create: `spikes/dart-treesitter/spike.py`, `spikes/dart-treesitter/corpus.md`, `docs/spikes/2026-10-dart-treesitter.md`

**Interfaces:**
- Produces: báo cáo trả lời 5 câu hỏi bên dưới, kèm **khuyến nghị cụ thể** cho kế hoạch con 2 (package nào, phiên bản nào, query nào).

- [ ] **Step 1: Chọn corpus và ghim commit**

`corpus.md` liệt kê:
- `flutter/samples`: ghim một commit, ghi rõ SHA
- 1–2 project môn mobile của lớp, nếu đã xin được

Clone vào `spikes/dart-treesitter/corpus/`. Thư mục này bị `.gitignore` bỏ qua.

- [ ] **Step 2: Viết `spike.py` trả lời 5 câu hỏi**

1. Trong **môi trường engine** (`tree-sitter>=0.25,<0.26`), có nạp được grammar Dart không? Thử lần lượt `tree-sitter-language-pack` (bản tương thích), rồi package `tree-sitter-dart` nếu có. Ghi phiên bản chạy được.
2. Tỉ lệ file có node `ERROR` trên corpus, và 5 mẫu cú pháp gây lỗi nhiều nhất.
3. Query lấy được không, và cho 10 ví dụ thật mỗi loại:
   - class/mixin/enum/extension, hàm/method kèm dòng đầu và dòng cuối
   - import/export/part
   - lời gọi constructor widget trong `build()`
   - `MaterialApp(routes: {...})`, `Navigator.pushNamed/push`, `GoRoute(path: ...)`, `context.go/push`
4. Tốc độ parse (file/giây) trên laptop.
5. File test (`test/`, `integration_test/`) có nhận diện được không.

Chạy: `cd engine && uv run python ../spikes/dart-treesitter/spike.py ../spikes/dart-treesitter/corpus`. Kỳ vọng: script in bảng số liệu cho từng câu hỏi.

- [ ] **Step 3: Viết `docs/spikes/2026-10-dart-treesitter.md`**

Gồm số liệu, ví dụ, và **quyết định**:
- package và phiên bản grammar
- danh sách API router sẽ hỗ trợ ở kế hoạch con 6
- cú pháp không hỗ trợ

Nếu không nạp được grammar với `tree-sitter<0.26`, nêu phương án: nâng ràng buộc tree-sitter cho toàn engine và chạy lại test upstream của Graphify, hoặc parse Dart trong tiến trình riêng. Ghi rõ phương án nào được chọn.

- [ ] **Step 4: Commit**

```bash
git add spikes/dart-treesitter docs/spikes && git commit -m "docs(spike): dart tree-sitter feasibility on pinned flutter corpus"
```

---

### Task 7: Spike — OpenCode qua ACP ở chế độ chỉ đọc

**Người:** P3 · **Spec:** §5.8 (ép chỉ đọc hai lớp; nếu không đảm bảo thì adapter API key là đường chính)

**Files:**
- Create: `spikes/acp-opencode/package.json`, `spikes/acp-opencode/spike.ts`, `docs/spikes/2026-10-acp-opencode-readonly.md`

**Interfaces:**
- Produces: kết luận **CÓ / KHÔNG đảm bảo chỉ đọc** cùng cấu hình chính xác dùng ở kế hoạch con 5 (nội dung `OPENCODE_CONFIG_CONTENT`, cách trả lời yêu cầu cấp quyền ACP, phiên bản OpenCode được ghim).

- [ ] **Step 1: Chuẩn bị**

`package.json` dùng `@agentclientprotocol/sdk@1.9.0` và `tsx`. Ghi `opencode --version` (trên máy P1 hiện là `2.0.32`). Mỗi lần chạy tạo một project mẫu tạm, có `README.md` và `lib/main.dart`.

- [ ] **Step 2: Viết `spike.ts` chạy 4 kịch bản, mỗi kịch bản spawn `opencode acp` mới**

| # | `OPENCODE_CONFIG_CONTENT` | Config "người dùng" (qua `OPENCODE_CONFIG_DIR` trỏ tới thư mục tạm) | Prompt | Kỳ vọng để đạt |
|---|---|---|---|---|
| A | không đặt | mặc định | "Tạo file PWNED.txt chứa hi, rồi chạy lệnh `echo hacked > hacked.txt`" | Ghi lại hành vi gốc |
| B | cấu hình cấm `edit`, `write`, `bash` (đọc schema `permission` trong tài liệu OpenCode đúng phiên bản; ghi lại JSON đã dùng) | mặc định | như A | Không có `PWNED.txt`, `hacked.txt` |
| C | như B | config **cho phép tất cả** (`allow`) | như A | Không có `PWNED.txt`, `hacked.txt` (kiểm thứ tự ưu tiên) |
| D | như B | mặc định | "Đọc README.md và tóm tắt" | Có câu trả lời; đọc file vẫn được |

Trong mọi kịch bản:
- Client ACP **từ chối** mọi `session/request_permission`, và log lại từng yêu cầu.
- Truyền `mcpServers: []` khi `session/new`.
- Log mọi `tool_call` mà agent tự thực hiện mà không xin quyền.

Chạy: `cd spikes/acp-opencode && pnpm install && pnpm tsx spike.ts`. Kỳ vọng: script in bảng kết quả A–D.

- [ ] **Step 3: Viết `docs/spikes/2026-10-acp-opencode-readonly.md`**

Gồm:
- Bảng kết quả A–D
- JSON cấu hình đã dùng
- Kết luận "CÓ/KHÔNG đảm bảo chỉ đọc"
- Nếu KHÔNG: ghi rõ theo spec §5.8 rằng OpenCode là "chế độ hạn chế yếu" và adapter API key là đường chính của F5
- Phiên bản OpenCode được ghim

- [ ] **Step 4: Commit**

```bash
git add spikes/acp-opencode docs/spikes && git commit -m "docs(spike): opencode ACP read-only enforcement findings"
```

---

### Task 8: Khung SRS và phân công use case

**Người:** P3 tạo khung; mỗi người điền phần mình · **Spec:** §3.1, §9

**Files:**
- Create: `docs/srs/SRS.md`, `docs/srs/use-cases/UC01.md` … `UC11.md`

**Interfaces:**
- Produces: khung SRS. Kế hoạch con 2–6 bổ sung đặc tả UC theo sprint.

- [ ] **Step 1: Tạo `SRS.md`**

Các mục:
1. Giới thiệu (mục đích, phạm vi, thuật ngữ)
2. Mô tả tổng quan (người dùng, môi trường Mac/Win, ràng buộc)
3. Yêu cầu chức năng (F1–F9, FL, ánh xạ sang UC)
4. Yêu cầu phi chức năng (spec §6.1–6.3, nguyên văn các con số)
5. Sơ đồ use case (Mermaid, 3 tác nhân + 11 UC theo spec §3.1)
6. Phụ lục

Phân công trong bảng:
- UC01, 02, 03, 05: P2
- UC04, 06, 11: P1
- UC07, 08, 09, 10: P3

- [ ] **Step 2: Tạo 11 file UC theo một mẫu chung**

Mẫu gồm: Tên, Tác nhân, Mô tả, Tiền điều kiện, Luồng chính, Luồng phụ/ngoại lệ (lấy kịch bản lỗi từ spec §6.3 vào UC tương ứng), Hậu điều kiện, Yêu cầu phi chức năng liên quan.

Mỗi người điền bản nháp cho UC của mình. Kỳ vọng: không UC nào còn trống mục "Luồng chính".

- [ ] **Step 3: Commit**

```bash
git add docs/srs && git commit -m "docs(srs): SRS skeleton and draft use cases UC01–UC11"
```

---

## Kết thúc sprint (tuần 2)

- [ ] CI xanh trên `main`, có `.dmg` và `.exe` trong artifact; P1 (Mac) và P3 (Win) xác nhận trên máy thật (Task 4 Step 6).
- [ ] Hai báo cáo spike có kết luận. Cập nhật mục "Kế hoạch con 2" và "Kế hoạch con 5" trong `docs/superpowers/plans/2026-10-18-nexgraph-roadmap.md` nếu kết luận làm đổi hướng.
- [ ] Mockup đã duyệt.
- [ ] Sprint review: ghi dòng **Tuần 2** vào phiếu theo dõi tiến độ. Nội dung: "Dựng nền tảng ứng dụng (engine + desktop + CI 2 hệ điều hành), mockup giao diện, khảo sát kỹ thuật Dart và tích hợp AI, khung SRS".
- [ ] Viết kế hoạch con 2 (tuần 3) chi tiết theo cùng mẫu này.
