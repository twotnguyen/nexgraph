# Ranh giới module và luật phụ thuộc

Repo đang chuyển sang cấu trúc module hoá theo ADR 0026 (tài liệu dự án). Luật phụ thuộc được viết thành cấu hình và chạy tự động, để ranh giới không chỉ nằm trong tài liệu.

| Pha | Trạng thái luật |
|---|---|
| 0 | Chỉ báo cáo (`pnpm rules:report`), job `module-rules (báo cáo)` không chặn merge. |
| 1–3 | Chuyển thư mục (labs, tools, desktop theo tính năng, `packages/contracts`); thêm luật theo tính năng. |
| 4 | Engine chia tầng, cổng `adapters/graphify`, gỡ vòng. |
| **4e (hiện tại)** | Chặn. Job `module-rules` chạy `pnpm rules:strict`, là một check bắt buộc của ruleset `main-guard`; `release` chờ nó. Vi phạm mới, kể cả cảnh báo vòng phụ thuộc, làm đỏ PR. |

## Chạy

```sh
pnpm rules:report   # in vi phạm, luôn thoát 0 nếu công cụ chạy được
pnpm rules:strict   # thoát 1 khi còn vi phạm
```

Cần đã `pnpm install`, vì dependency-cruiser dùng TypeScript của `apps/desktop`. Cần `uv` cho import-linter. Phiên bản công cụ ghim trong `tools/ci/module-rules.mjs`.

## Engine (`engine/pyproject.toml`, `[tool.importlinter]`)

**`engine-layers`**: tầng trên được import tầng dưới, không ngược lại; package cùng tầng import lẫn nhau được. Từ pha 4c mỗi tầng là một thư mục trong `engine/src/nexgraph_engine/`.

| Tầng | Thư mục | Package |
|---|---|---|
| Giao diện | `interfaces/` | `api`, `mcp`, `cli`, `hook_guard`, `selftest`, `resources` |
| Điều phối | `pipeline/` | đường pipeline Graphify, `job_manager`, `refresh_service`, `legacy_indexer`, `legacy_refresh` |
| Phân tích | `analysis/` | `query`, `arch`, `flows`, `impact`, `changes`, `prs`, `semantic`, `tour`, `report`, `memory`, `global_graph`, `bridge`, `export` |
| Lập chỉ mục | `indexing/` | `index`, `graphify_import`, `sources`, `dart`, `docs` |
| Lưu trữ | `storage/` | `store` |
| Lõi | `core/` | `schema`, `ids`, `errors`, `logging_setup`, `subprocesses`, `text`, `tasks` |

Ngoài tầng còn hai phần:
- `adapters/graphify/`: cổng tới Graphify, chỉ được dùng lõi.
- `cli.py` ở gốc package: **điểm vào công khai** (`python -m nexgraph_engine.cli`, script `nexgraph-engine`, tệp vào của PyInstaller). Module này chỉ gọi `interfaces/cli.py`. Tên được giữ vì desktop ở chế độ chạy từ mã nguồn, hook git và cấu hình MCP đã ghi vào máy người dùng đều gọi nó.

**`graphify-gateway`**: chỉ `nexgraph_engine.adapters.graphify` được import `graphify`. **`graphify-gateway-core-only`**: cổng không phụ thuộc tầng nào của engine trừ lõi.

Cổng (pha 4a) chia theo nhóm năng lực của ADR 0026 mục A.4: `extract`, `analysis`, `export`, `llm`, `security`, `ingest`, `serve`, `runner`. Mỗi module có bảng `NAMES` (tên → module vendor, thuộc tính) và `__getattr__` tra tên mỗi lần import. Cách này giữ hai tính chất của import trực tiếp cũ:
- import trễ trong hàm vẫn chỉ tải module vendor khi gọi;
- `monkeypatch` trên module vendor vẫn có tác dụng.

Khối `TYPE_CHECKING` khai báo cùng các tên để IDE có kiểu. Dùng tên mới của Graphify thì thêm vào `NAMES` và `TYPE_CHECKING` của nhóm, rồi chụp lại chữ ký: `UPDATE_GRAPHIFY_GATEWAY=1 pytest tests/adapters/test_graphify_gateway.py`. Test đó (chạy trong job bắt buộc `engine`) kiểm:
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

### Sau pha 4b (gỡ vòng, 27/11/2026)

- `engine-layers`: **giữ**. Mọi hợp đồng: 4 giữ, 0 vi phạm.
- Vòng giữa package: 5 → **0**. `tests/repo/test_package_cycles.py` khoá điều này (tìm thành phần liên thông mạnh, tính cả import trễ). Test bắt thêm vòng ba package `arch → semantic → query → arch` mà phép dò vòng hai chiều bỏ sót.
- Cách gỡ: chỉ chuyển chỗ, không đổi logic. Đồ thị (nút, cạnh theo loại, tệp, luồng, bước luồng, cụm) giống hệt `main` sau lập chỉ mục và refresh trên 5 fixture, ở cả chế độ `graphify` lẫn `legacy`.

| Cũ | Mới | Lý do |
|---|---|---|
| `index/keywords.py`, `query/terms.py` | `text/keywords.py`, `text/terms.py` (lõi) | `store` dùng để dựng FTS; là tiện ích văn bản |
| `index/jobs.py` (`TaskCancelled`, `TaskContext`) | `tasks.py` (lõi) | `semantic` dùng ngữ cảnh job |
| `index/jobs.py` (phần còn lại), `index/refresh_service.py` | `pipeline/job_manager.py`, `pipeline/refresh_service.py` | Điều phối job, chọn đường pipeline |
| `index/indexer.py`, `index/refresh.py` | `pipeline/legacy_indexer.py`, `pipeline/legacy_refresh.py` | Bộ trích xuất cũ (`NEXGRAPH_PIPELINE=legacy`) gọi luồng, cụm, `TESTED_BY` sau khi trích xuất, nên là điều phối |
| `index/indexer.py` (`RACY_SECONDS`, `_git_head`), `index/refresh.py` (`real_file_records`) | `index/source_state.py` | Kiểm độ mới (tầng phân tích) dùng chung |
| `impact/tested_by.py` | `index/tested_by.py` | Sinh cạnh lúc lập chỉ mục, `graphify_import` dùng |
| `store/freshness.py` | `changes/freshness.py` | Phân tích độ mới, cần `discover` của tầng lập chỉ mục |
| `query/contracts.py` (`node_json`, `edge_json`) | `store/json_v1.py` (`contracts` import lại) | `flows` cần mà không phụ thuộc `query` |
| `semantic/chunks.py` (`membership_signature`) | `ids.py` (`chunks` import lại) | `arch` cần mà không phụ thuộc `semantic` |

### Sau pha 4c (chia thư mục theo tầng, 27/11/2026)

- 32 package/module chuyển vào 5 thư mục tầng bằng script chuyển module theo AST. Script sửa import, đích `monkeypatch` dạng chuỗi, tên `resources.files("nexgraph_engine.core.schema")`, `tools/`, tài liệu. Không đổi mã chạy.
- `engine-layers` viết lại theo 6 thư mục tầng. Mọi hợp đồng: 4 giữ. `test_package_cycles` so vòng giữa package bên trong tầng (`analysis.query` với `analysis.flows`), không phải giữa tầng. Đã thử bằng đột biến: thêm import `flows → query` thì test đỏ.

### Test engine theo tầng (pha 4d, 27/11/2026)

`engine/tests/` chia theo **đối tượng được test**, không theo phần dựng dữ liệu. Nhiều test đi qua API hoặc `Indexer` để dựng đồ thị, nhưng nhắm vào một module phân tích, nên xếp theo module đó.

| Thư mục | Số tệp | Ví dụ |
|---|---|---|
| `core/` | 3 | schema, tiến trình con, từ khoá |
| `storage/` | 4 | `graph_store`, dự án, FTS, phát hành chỉ mục |
| `indexing/` | 28 | phát hiện tệp, bộ trích xuất, tài liệu, nhập Graphify, nguồn ngoài mã |
| `analysis/` | 25 | kiến trúc, luồng, ảnh hưởng, thay đổi, truy vấn, PR, tour |
| `pipeline/` | 13 | `Indexer`/refresh cũ, job, đường pipeline Graphify |
| `interfaces/` | 24 | HTTP API (`test_api_*`), MCP, CLI, hook-guard, logging |
| `e2e/` | 3 | kịch bản đầu-cuối trên fixture |
| `adapters/` | 3 | cổng Graphify, vendor, grammar |
| `repo/` | 6 | CI, phát hành, phiên bản, script `tools/`, vòng phụ thuộc |

- `conftest.py`, `fixtures/`, `gh_fake.py` vẫn ở `tests/`. `conftest.py` đưa `tests/` vào `sys.path`.
- Hàm dùng chung giữa hai thư mục để ở `tests/support.py`: `call`, `payload` (gọi tool MCP), `make` (dựng dự án nhỏ cho bản đồ kiến trúc). Import theo tên trần từ tệp test ở thư mục khác chỉ chạy được khi thư mục kia đã được thu thập trước, nên không dùng cách đó.
- Test mới đặt vào thư mục của module nó nhắm tới. Không thêm `__init__.py`: tên tệp test phải khác nhau trên toàn `tests/`.

## Desktop (`apps/desktop/.dependency-cruiser.cjs`)

| Luật | Ý nghĩa |
|---|---|
| `renderer-khong-import-main`, `main-khong-import-renderer` | Hai tiến trình chỉ nói chuyện qua preload/IPC. Test tích hợp được miễn. |
| `preload-chi-dung-shared` | Preload chỉ dùng `@nexgraph/contracts`. |
| `contracts-doc-lap` | `packages/contracts` (trước là `src/shared`, pha 3a) không phụ thuộc main/renderer/preload. |
| `renderer-shared-doc-lap` | `renderer/src/shared/` (`ui`, `lib`) và `i18n/` không phụ thuộc `app/` hay `features/` (pha 3b, thay `state-khong-import-components`). |
| `features-khong-import-app` | `features/<x>/` không phụ thuộc `app/` (phần lắp ráp workbench). |
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

### Renderer theo tính năng (pha 3b, 27/11/2026)

`src/renderer/src` có 3 tầng, chiều phụ thuộc một hướng: `app/` → `features/<x>/` → `shared/` + `i18n/`.

| Tầng | Chứa |
|---|---|
| `app/` | Lắp ráp: `workbenchPanels.ts` (đăng ký panel), `layout/` (khung workbench), `screens/` (các màn hình), `hosted/` (điểm vào khi nhúng), cầu menu, hành động menu Tệp. `App.tsx` và `main.tsx` ở gốc. |
| `features/<x>/` | Component, hook, state và test của một tính năng (22 tính năng, cùng tên với `components/<x>` cũ, thêm `extensions`). |
| `shared/ui/` | Component dùng chung: biểu tượng, thông báo, `Picker`, `PaneStack`, `FileFinder`, thanh trạng thái. |
| `shared/lib/` | Tiện ích, state không thuộc tính năng nào: lệnh và phím tắt, giao diện, bố cục, tuỳ chọn editor, lỗi, ngôn ngữ, `waitJob`. |
| `i18n/` | `strings.ts` (trước ở gốc) và bảng dịch. |

- **Kết quả:** desktop từ 12 lỗi và 6 cảnh báo còn **0 lỗi và 1 cảnh báo**. Cảnh báo còn lại là vòng `main/features/git/operations.ts` ↔ `repo.ts`.
- **Cách sửa 12 lỗi cũ:**
  - `workbenchPanels` chuyển sang `app/`.
  - `activeEditor` và `collab` chuyển vào tính năng của chúng; import `features/editor/monaco` từ trong tính năng thì không vi phạm.
  - `appMenuBridge` chuyển sang `app/`.
- **Gỡ vòng `icons` ↔ `ProjectOverviewScreen`:** chuyển kiểu `WorkspaceTab` sang `shared/lib/workspaceTab.ts`; màn Tổng quan xuất lại kiểu này.
- **Đổi tên:** `state/savedPrompts.ts` thành `features/agent/savedPromptsStore.ts`. Trên macOS và Windows, hệ tệp không phân biệt hoa thường, nên nếu giữ tên cũ thì `./savedPrompts` và `./SavedPrompts` (component) sẽ trỏ nhầm sang nhau.
- **Còn lại:** tính năng import lẫn nhau, 31 import ở 22 cặp, nhiều nhất là `collab`/`viewers` → `editor`. Chưa có luật cho trường hợp này. Muốn tách thì đưa phần dùng chung xuống `shared/`.

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
| 3 | `apps/desktop/src/shared/` (8 tệp) | `packages/contracts/src/` (gói `@nexgraph/contracts`) | Import `@shared/x` và `../shared/x` → `@nexgraph/contracts/x` (267 chỗ). Alias trong `electron.vite.config.ts`, `vitest.config.mts`, hai `tsconfig`; không có bước build, mã được gom vào bundle. `labs/extension` import theo đường dẫn tương đối. |
| 3 | `renderer/src/components/<x>/` (22 thư mục) | `renderer/src/features/<x>/` | `common/` → `shared/ui/`, `layout/` → `app/layout/` (trừ `Picker`, `PaneStack`, `FileFinder` → `shared/ui/`), `EngineStatusBar` → `shared/ui/`. |
| 3 | `renderer/src/state/` (57 tệp) | `app/`, `shared/lib/`, `features/<x>/` | Theo nơi dùng; xem mục "Renderer theo tính năng". `savedPrompts.ts` → `features/agent/savedPromptsStore.ts`. |
| 3 | `renderer/src/{screens,hosted}/`, `services/`, `strings.ts` | `app/{screens,hosted}/`, `features/architecture/layout/`, `i18n/strings.ts` | 311 tệp chuyển, 659 đường dẫn import sửa bằng script. |
| 4 | `engine/src/nexgraph_engine/{schema,ids,errors,logging_setup,subprocesses,text,tasks}` | `nexgraph_engine/core/…` | Pha 4c. Import `nexgraph_engine.schema` → `nexgraph_engine.core.schema`. |
| 4 | `nexgraph_engine/store/` | `nexgraph_engine/storage/store/` | |
| 4 | `nexgraph_engine/{index,graphify_import,sources,dart,docs}/` | `nexgraph_engine/indexing/…` | |
| 4 | `nexgraph_engine/{query,arch,flows,impact,changes,prs,semantic,tour,report,memory,global_graph,bridge,export}/` | `nexgraph_engine/analysis/…` | |
| 4 | `nexgraph_engine/{api,mcp,resources}/`, `hook_guard.py`, `selftest.py`, `cli.py` | `nexgraph_engine/interfaces/…` | `nexgraph_engine/cli.py` vẫn có, là điểm vào công khai gọi `interfaces/cli.py`. |
| 4 | Các module chuyển ở pha 4b | xem mục "Sau pha 4b" | Đường dẫn ở đó là trước pha 4c; thêm tiền tố tầng (ví dụ `index/source_state.py` → `indexing/index/source_state.py`). |
| 4 | `engine/tests/test_<x>.py` (109 tệp) | `engine/tests/<tầng>/test_<x>.py` | Pha 4d; xem mục "Test engine theo tầng". `Path(__file__)` trong test tăng một cấp. |
