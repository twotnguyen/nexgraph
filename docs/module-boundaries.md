# Ranh giới module và luật phụ thuộc

Repo đang chuyển sang cấu trúc module hoá theo ADR 0026 (tài liệu dự án). Luật phụ thuộc được viết thành cấu hình và chạy tự động, để ranh giới không chỉ nằm trong tài liệu.

| Pha | Trạng thái luật |
|---|---|
| **0 (hiện tại)** | Chỉ báo cáo. Job CI `module-rules (báo cáo)` ghi vi phạm vào summary, không thuộc 7 check bắt buộc, không chặn merge. |
| 1–3 | Chuyển thư mục (labs, tools, desktop theo tính năng, `packages/contracts`); thêm luật theo tính năng. |
| 4 | Engine chia tầng, cổng `adapters/graphify`; hết vi phạm thì đổi CI sang `pnpm rules:strict` và đưa vào ruleset. |

## Chạy

```sh
pnpm rules:report   # in vi phạm, luôn thoát 0 nếu công cụ chạy được
pnpm rules:strict   # thoát 1 khi còn vi phạm
```

Cần đã `pnpm install`, vì dependency-cruiser dùng TypeScript của `apps/desktop`. Cần `uv` cho import-linter. Phiên bản công cụ ghim trong `tools/ci/module-rules.mjs`.

## Engine (`engine/pyproject.toml`, `[tool.importlinter]`)

**`engine-layers`**: tầng trên được import tầng dưới, không ngược lại; package cùng tầng import lẫn nhau được.

| Tầng | Package hiện tại | Tầng đích (pha 4) |
|---|---|---|
| Giao diện | `cli`, `api`, `mcp`, `hook_guard`, `selftest` | `interfaces` |
| Điều phối | `pipeline` | `interfaces` hoặc tầng điều phối riêng |
| Phân tích | `query`, `arch`, `flows`, `impact`, `changes`, `prs`, `semantic`, `tour`, `report`, `memory`, `global_graph`, `bridge`, `export` | `analysis` |
| Lập chỉ mục | `index`, `graphify_import`, `sources`, `dart`, `docs` | `indexing` |
| Lưu trữ | `store` | `storage` |
| Lõi | `schema`, `ids`, `errors`, `logging_setup`, `subprocesses` | `core` |

**`graphify-gateway`**: chỉ `nexgraph_engine.adapters.graphify` được import `graphify`. **`graphify-gateway-core-only`**: cổng không phụ thuộc tầng nào của engine trừ lõi.

Cổng (pha 4a) chia theo nhóm năng lực của ADR 0026 mục A.4: `extract`, `analysis`, `export`, `llm`, `security`, `ingest`, `serve`, `runner`. Mỗi module có bảng `NAMES` (tên → module vendor, thuộc tính) và `__getattr__` tra tên mỗi lần import. Cách này giữ hai tính chất của import trực tiếp cũ:
- import trễ trong hàm vẫn chỉ tải module vendor khi gọi;
- `monkeypatch` trên module vendor vẫn có tác dụng.

Khối `TYPE_CHECKING` khai báo cùng các tên để IDE có kiểu. Dùng tên mới của Graphify thì thêm vào `NAMES` và `TYPE_CHECKING` của nhóm, rồi chụp lại chữ ký: `UPDATE_GRAPHIFY_GATEWAY=1 pytest tests/test_graphify_gateway.py`. Test đó (chạy trong job bắt buộc `engine`) kiểm:
- mọi tên còn tồn tại với đúng chữ ký đã chụp (`tests/fixtures/graphify_gateway_signatures.json`);
- không tệp nào ngoài cổng import `graphify`.

**`graphify-one-way`**: mã vendor `graphify` không import `nexgraph_engine`.

### Mốc ban đầu (27/11/2026, `main` `399357e`)

- `graphify-one-way`: **giữ**.
- `engine-layers`: **7 cặp vi phạm, 18 import**:
  - `store → index` (`freshness` dùng `discovery`/`indexer._git_head`/`refresh`; `search`, `graph_store` dùng `keywords`) và `store → query` (`search` dùng `terms`). Đây là tiện ích văn bản, cần chuyển xuống lõi.
  - `index → arch`, `index → flows`, `index → impact`: `indexer`/`refresh` chạy hậu xử lý cộng đồng, luồng, `TESTED_BY`. Cần chuyển lên điều phối.
  - `index → pipeline`: `jobs`, `refresh_service` chọn đường pipeline, import trễ trong hàm.
  - `graphify_import → impact`: `importer`, `incremental` sinh `TESTED_BY`.
- `graphify-gateway`: **59 cặp import** từ 32 module thuộc 16 package, tới 36 module `graphify`. Pha 4a (cổng): **giữ**, 74 câu import đổi sang cổng, 102 tên.

## Desktop (`apps/desktop/.dependency-cruiser.cjs`)

| Luật | Ý nghĩa |
|---|---|
| `renderer-khong-import-main`, `main-khong-import-renderer` | Hai tiến trình chỉ nói chuyện qua preload/IPC. Test tích hợp được miễn. |
| `preload-chi-dung-shared` | Preload chỉ dùng `src/shared`. |
| `shared-doc-lap` | `src/shared` (sẽ thành `packages/contracts`) không phụ thuộc main/renderer/preload. |
| `state-khong-import-components` | State/hook không phụ thuộc component. |
| `ma-san-pham-khong-import-test` | Mã sản phẩm không import tệp test. |
| `khong-vong-phu-thuoc` (cảnh báo) | Không có vòng import giữa tệp mã sản phẩm. |

### Mốc ban đầu (27/11/2026, `main` `399357e`, 606 module)

- **12 lỗi `state-khong-import-components`:**
  - `state/workbenchPanels.ts` → 9 component. Tệp này đăng ký panel, thực chất là phần lắp ráp app, nên chuyển sang `app/` ở pha 3.
  - `state/activeEditor.ts`, `state/collab.ts` → `components/editor/monaco.ts`.
  - `state/appMenuBridge.ts` → `components/common/NotificationCenter.tsx`.
- **6 cảnh báo vòng:**
  - `components/common/icons.tsx` ↔ `screens/ProjectOverviewScreen.tsx`, kéo theo 4 dialog/card của màn Tổng quan.
  - `main/git/operations.ts` ↔ `main/git/repo.ts` (sau pha 2b: `main/features/git/`).
- Các luật ranh giới tiến trình và `shared` đang giữ.

### IPC của main theo tính năng (pha 2a)

`src/main/ipc.ts` chỉ còn lắp ráp: dựng `IpcContext` (`platform/ipc-context.ts`) rồi gọi `register<Tính năng>Ipc(ctx)` của `app/ipc.ts` và `features/<tính năng>/ipc.ts` (projects, files, lsp, terminal, git, debug, collab, extensions, indexing, graph, graph-pages, agent, integrations, export, semantic). Quy ước:

- Kênh mới đặt trong `features/<tính năng>/ipc.ts`, đăng ký bằng `ctx.on` / `ctx.onFrom` / `ctx.onTrusted` (kiểm khung gửi). Path luôn suy từ `ctx.rootOf(projectId)`.
- Tính năng giữ trạng thái theo dự án đăng ký việc dọn bằng `ctx.onProjectRemove(hook)`; `project:remove` gọi các hook theo thứ tự đăng ký sau khi engine gỡ xong.
- Hàm vòng đời (`closeAllAgents`, `stopAllWatchers`, `stopEditorProcesses`…) vẫn xuất từ `ipc.ts` cho `index.ts` và `labs/extension`.
- `test/ipc-channels.test.ts` khoá: tập kênh main đăng ký bằng đúng tập kênh preload gọi, không kênh nào đăng ký hai lần, việc dọn khi gỡ dự án chạy đủ.

Pha 2b đưa mọi module của `src/main` vào ba nhóm: `app/` (lắp ráp: menu, cửa sổ, khởi động, smoke), `platform/` (dùng chung: engine, an toàn đường dẫn, lỗi, cài đặt), `features/<x>/` (mã và IPC của một tính năng). Ở gốc chỉ còn `index.ts` (điểm vào electron-vite) và `ipc.ts`. Test của main vẫn ở `apps/desktop/test/`.

## Đường dẫn đã chuyển

Mỗi PR chuyển thư mục thêm dòng vào bảng này. Tài liệu ngoài repo dùng bảng này để sửa đường dẫn cũ.

| Pha | Cũ | Mới | Ghi chú |
|---|---|---|---|
| 1 | `apps/extension/` | `labs/extension/` | Ngoài pnpm workspace mặc định, lockfile riêng `labs/extension/pnpm-lock.yaml` (cùng phiên bản đã khoá trước đó). Cài: `pnpm --dir labs/extension install --ignore-workspace`. CI: job `labs (báo cáo)`, không bắt buộc. |
| 1 | `apps/shell/` | `labs/shell/` | Không phải gói pnpm. `node labs/shell/build.mjs` |
| 1 | `docs/superpowers/specs/2026-10-24-nexgraph-{csdl-chuan-hoa,csdl-design,csdl-tan-tu,phan-tich-chuc-nang}.md` | `docs/srs/csdl/` (cùng tên tệp) | Bản công khai; bản có ghi chú nội bộ ở tài liệu dự án |
| 1 | `docs/superpowers/specs/2026-10-18-nexgraph-desktop-design.md`, `docs/superpowers/plans/` | bỏ khỏi repo | Bản cũ đã lệch; spec và kế hoạch hiện hành ở tài liệu dự án |
| 1 | `design/` (hai bản: workspace và repo) | `design/` của repo | Thêm `diagrams/uml-hd-lap-chi-muc.html` |
| 1 | `scripts/ci/` | `tools/ci/` | `pnpm rules:report`, `node tools/ci/check-version.mjs <tag>` |
| 1 | `engine/scripts/{bench_all,bench_index,bench_refresh,bench_search_arch,demo_check}.py` | `tools/bench/` | Chạy từ gốc repo: `env -u PYTHONPATH uv run --project engine python tools/bench/<script>.py` |
| 1 | `engine/scripts/{eval_sample,eval_score}.py` | `tools/eval/` | Như trên |
| 2 | `apps/desktop/src/main/ipc.ts` (1.338 dòng) | `ipc.ts` (lắp ráp) + `app/ipc.ts` + `features/<x>/ipc.ts` | Pha 2a, xem mục IPC ở trên |
| 2 | `src/main/engine/` | `src/main/platform/engine/` | Tiến trình engine, HTTP client |
| 2 | `src/main/{user-error,ipc-result,process-env,external-links}.ts`, `fs/project-fs.ts`, `watch/ignore.ts`, `ai/settings.ts` | `src/main/platform/` (cùng tên; `ai/settings.ts` → `platform/settings.ts`) | Dùng chung bởi nhiều tính năng |
| 2 | `src/main/{appMenu,app-menu-labels,app-menu-locale,windows,unload-guard,licenses,license-file,smoke,smoke-desktop,dev-hooks}.ts`, `security/permissions.ts` | `src/main/app/` (cùng tên; `security/permissions.ts` → `app/permissions.ts`) | Lắp ráp app |
| 2 | `src/main/agent/`, `gemini/`, `agent-router.ts`, `window-owners.ts`, `gemini-consent.ts`, `ai/{citations,tools}.ts` | `src/main/features/agent/` (`gemini/` → `features/agent/gemini/`) | |
| 2 | `src/main/ai/semantic-{models,runner,usage}.ts` | `src/main/features/semantic/` | |
| 2 | `src/main/fs/project-operations.ts`, `search/text-search.ts` | `src/main/features/files/` | |
| 2 | `src/main/watch/{error-notice,project-watcher}.ts`, `index-options.ts`, `index-sources.ts` | `src/main/features/indexing/` | |
| 2 | `src/main/{mcp-http,git-hook,integrations}.ts` | `src/main/features/integrations/` | |
| 2 | `src/main/{collab,debug,extensions,git,lsp,terminal,graph-pages}/` | `src/main/features/<cùng tên>/` | |
| 2 | `src/main/tasks/` | `src/main/features/terminal/tasks/` | |
