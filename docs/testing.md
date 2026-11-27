# Chạy kiểm thử NexGraph

Tài liệu này gom các lệnh chạy test và các nhóm **opt-in** (chỉ chạy khi đặt biến môi trường) để không phải đọc comment trong tệp test. Kế hoạch kiểm thử của bản phát hành ở [release/test-plan.md](release/test-plan.md).

## 1. Lệnh cơ bản

```sh
# engine (Python), song song mỗi lõi một worker (pytest-xdist; bỏ `-n auto` khi cần đọc log tuần tự)
cd engine && env -u PYTHONPATH uv run --locked pytest -q -n auto

# desktop (Electron/Vitest) + typecheck
env -u PYTHONPATH pnpm test
pnpm typecheck
```

`env -u PYTHONPATH` không phải mẹo trang trí: xem mục 4.

### CI chỉ chạy phần bị ảnh hưởng (PR)

Job `changes` của `.github/workflows/ci.yml` đọc danh sách tệp đổi của PR và [tools/ci/changes.mjs](../tools/ci/changes.mjs) quyết định phần việc nặng nào cần chạy:

- **Tài liệu `.md`:** chỉ test che secret của engine (test này quét mọi `.md`).
- **Mã desktop (renderer, main, preload, contracts) hoặc test desktop:** chỉ test desktop.
- **Mã engine:** test engine và test desktop (E2E dùng engine thật), không đóng gói.
- **Test engine:** không đóng gói, không test desktop. Riêng `engine/tests/fixtures/**` thì vẫn test desktop, vì E2E desktop dùng fixture này.
- **Tệp đóng gói** (`electron-builder.yml`, `engine/packaging/`, `nex-runtime.json`, `apps/desktop/scripts/`, `src/main/app/smoke*.ts`) **hoặc dependency** (`pyproject.toml`, `uv.lock`): có đóng gói.
- **Tệp `.github/`, `tools/ci/`, `package.json`, lockfile, hoặc đường dẫn chưa có luật:** chạy đủ.

6 check bắt buộc (`lint`, `module-rules`, `engine`/`desktop` × 2) luôn có kết quả: job vẫn chạy, chỉ các bước nặng được bỏ qua. `package` không bắt buộc ở PR (ADR 0027 của workspace) nên bị bỏ cả job khi không cần. **Push lên `main` và tag luôn chạy đủ, kể cả đóng gói**, nên lỗi lọt qua bộ lọc của PR vẫn bị bắt trên commit merge. `main` đỏ ở `package` thì sửa ngay.

Thêm một test đọc tệp ngoài thư mục của nó (tài liệu, ảnh, workflow) thì phải sửa luật trong `changes.mjs` và `apps/desktop/test/ci-changes.test.ts`.

## 2. Nhóm opt-in

| Biến | Nhóm test | Cách chạy | Vì sao không chạy mặc định |
|---|---|---|---|
| `NEXGRAPH_E2E=1` | `apps/desktop/test/ai-e2e.test.ts` và các test cần engine Python thật + LLM giả | `NEXGRAPH_E2E=1 pnpm --filter @nexgraph/desktop test ai-e2e` | cần engine chạy được và thời gian lâu hơn |
| `NEXGRAPH_DEBUG_IT=1` | `test/debug-manager.test.ts` (10 test) và `test/debug-launch-config.test.ts` (5 test) | `NEXGRAPH_DEBUG_IT=1 pnpm exec vitest run test/debug-manager.test.ts test/debug-launch-config.test.ts` | tải js-debug và debugpy từ mạng về thư mục tạm, chạy tiến trình thật |
| `NEXGRAPH_ANTIGRAVITY_TEST_BINARY` | `test/gemini-installation.test.ts` (chỉ Windows) và một phần `test/gemini-cli-policy.test.ts` | `NEXGRAPH_ANTIGRAVITY_TEST_BINARY=<đường dẫn agy.exe> pnpm test` | cần binary Antigravity CLI thật, có chữ ký |

- CI đặt `NEXGRAPH_E2E: '1'` ở job desktop; không đặt hai biến còn lại. Vì vậy 15 test DAP và 1 test Antigravity chỉ chạy khi có người chạy tay.
- Khi chạy tay, ghi kết quả vào biên bản nghiệm thu (ngày, máy, phiên bản adapter/binary).
- Test Antigravity trên Windows kiểm cả chữ ký số của binary; đừng trỏ vào bản tải từ nguồn lạ.

## 3. Chạy trên bản đóng gói

```sh
pnpm --filter @nexgraph/desktop package:dir          # build app trong apps/desktop/dist
pnpm --filter @nexgraph/desktop smoke:packaged       # smoke bản vừa build
# hoặc kiểm thẳng bộ cài:
node apps/desktop/scripts/smoke-packaged.mjs --installer <tệp .exe|.dmg>
```

Smoke kiểm dòng `SMOKE OK` với đủ trường như CI; danh sách trường ở [release/README.md](release/README.md). Thêm `--disable-webgl` để kiểm fallback Bản đồ.

## 4. Bẫy `PYTHONPATH` (và `PYTHONHOME`)

Nếu môi trường cha đặt `PYTHONPATH` trỏ tới gói Python của dự án khác (ví dụ phiên Hermes), tiến trình engine do app spawn sẽ thừa hưởng biến đó, import nhầm module và thoát ngay; app báo **"Engine thoát trước khi sẵn sàng (exit 1)"**. Đây là bẫy của môi trường, không phải lỗi mã.

Cách tránh:

```sh
env -u PYTHONPATH -u PYTHONHOME pnpm test
env -u PYTHONPATH -u PYTHONHOME pnpm dev
```

Bản sửa trong mã (bỏ `PYTHONPATH`/`PYTHONHOME` khi spawn engine, DSK-01) thuộc đợt hardening; cho tới khi merge, luôn chạy app/test từ shell đã bỏ hai biến này.

## 5. Hồ sơ dữ liệu riêng khi thử

```sh
NEXGRAPH_USER_DATA_DIR=/tmp/nexgraph-test/user-data \
NEXGRAPH_DATA_DIR=/tmp/nexgraph-test/engine-data \
pnpm dev
```

Dùng thư mục riêng cho mỗi lượt để không lẫn phiên chat, chỉ mục và khóa MCP với dữ liệu đang dùng. Trên macOS, đặt trong thư mục có dấu và khoảng trắng để kiểm luôn đường dẫn Unicode.

## 6. Kiểm thử giao diện bằng CDP

Xem skill `nexgraph-desktop-ui-testing` trong workspace (chạy Electron qua CDP, phím/chuột thật, assertion + ảnh). Không dùng app NexGraph làm công cụ để tự kiểm chính nó trong lúc phát triển.
