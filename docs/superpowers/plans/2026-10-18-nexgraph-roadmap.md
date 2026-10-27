# NexGraph — Lộ trình triển khai (kế hoạch tổng)

**Spec:** `docs/superpowers/specs/2026-10-18-nexgraph-desktop-design.md` (đã duyệt 2026-10-18)

## Vì sao chia thành nhiều kế hoạch con

Spec gồm ba hệ thống con phát triển song song bởi ba người: engine Python, ứng dụng desktop, tích hợp AI. Chi tiết của nhiều phần phụ thuộc vào kết quả spike tuần 2:
- Grammar Dart có chạy cùng phiên bản tree-sitter của Graphify không.
- OpenCode có ép được chỉ đọc không.

Viết sẵn từng hàm cho 9 tuần bây giờ thì sẽ phải viết lại. Vì vậy:
- **Tài liệu này** cố định những gì cả nhóm phải thống nhất trước để làm song song: cấu trúc repo, **hợp đồng API engine v1**, enum schema, các kế hoạch con và mốc kiểm chứng.
- **Mỗi kế hoạch con** được viết chi tiết (TDD, từng bước) ở đầu sprint của nó, dựa trên spec + tài liệu này + kết quả các sprint trước.
- Kế hoạch con 1 (tuần 2) đã được viết chi tiết: `2026-10-18-nexgraph-p1-foundation.md`.

## Repo

- Vị trí local: `/Users/twot/Documents/CODE/DACN-CNTT/nexgraph` (git repo mới). Remote GitHub `nexgraph`, public, Apache-2.0. Việc tạo remote và push do nhóm làm.
- Cấu trúc:

```
nexgraph/
├── engine/                      # Python 3.12, uv — P1 (và P3 cho mcp/)
│   ├── src/nexgraph_engine/     # code NexGraph: api/, index/, store/, schema/, dart/, impact/, arch/, mcp/
│   ├── src/graphify/            # Graphify vendored @ 86c57be (Apache-2.0)
│   ├── third_party/graphify/    # LICENSE, LICENSE-MIT, NOTICE, UPSTREAM.md
│   ├── tests/                   # pytest; tests/graphify_upstream/ = test gốc của Graphify
│   └── packaging/               # PyInstaller spec
├── apps/desktop/                # Electron + React + TS (electron-vite) — P2 (và P3 cho src/main/ai/)
│   ├── src/main/                # engine launcher, IPC, ai/ (ACP, API key), keychain
│   ├── src/preload/
│   └── src/renderer/            # React, React Flow + ELK, i18n vi/en
├── design/mockups/              # mockup HTML (tuần 1, đã xong)
├── spikes/                      # code bỏ đi của các spike
├── docs/                        # spec, plans, srs/, spikes/, test-plan/, report/
├── .github/workflows/ci.yml
├── LICENSE  NOTICE  THIRD_PARTY_LICENSES.md
```

## Hợp đồng API engine v1

Hợp đồng này để P1 (engine) và P2/P3 (desktop, AI) làm song song. Có ba quy tắc chung:

- Mọi route đều dưới `/v1`, yêu cầu `Authorization: Bearer <token>`, và chỉ chấp nhận `Host` là `127.0.0.1:<port>` hoặc `localhost:<port>`.
- Trả lỗi dạng `{"error": {"code": str, "message": str}}`.
- Đổi hợp đồng thì phải sửa file này trong cùng một PR.

| Method & path | Kế hoạch con | Trả về (rút gọn) |
|---|---|---|
| `GET /v1/health` | 1 | `{status:"ok", api_version:"1", engine_version, graphify_commit}` |
| `GET /v1/selftest` | 1 | `{ok:bool, nodes:int}`: extract fixture đóng gói sẵn, kiểm bản đóng gói |
| `POST /v1/projects` `{path}` | 2 | `{project_id, path, is_git:bool}` |
| `GET /v1/projects` | 2 | `[{project_id, path, last_indexed_at, last_index_commit}]` |
| `POST /v1/projects/{pid}/index` | 2 | `{job_id}` |
| `GET /v1/jobs/{job_id}` · `DELETE` (huỷ) | 2 | `{state:"queued"\|"structure"\|"resolve"\|"done"\|"error"\|"cancelled", files_done, files_total, message?}` |
| `GET /v1/events` (SSE) | 2 | `job_progress`, `graph_updated {pid}`, `changes_updated {pid}` |
| `GET /v1/projects/{pid}/stats` | 2 | đếm node/edge theo kind/type, ngôn ngữ |
| `GET /v1/projects/{pid}/search?q&kinds&limit=20` | 3 | `[{node, score}]` |
| `GET /v1/projects/{pid}/nodes/{node_id}` | 2 | `Node` |
| `GET /v1/projects/{pid}/neighbors?node&types&direction=in\|out\|both&depth=1&limit=500` | 2 | `{nodes:[Node], edges:[Edge], truncated:bool}` |
| `GET /v1/projects/{pid}/code?file&start&end` | 2 | `{file, start, end, text, language}` |
| `GET /v1/projects/{pid}/architecture?parent=` | 3 | `{blocks:[{id,label,kind,size}], links:[{from,to,count,types}]}` |
| `GET /v1/projects/{pid}/architecture/evidence?from&to&limit=50` | 3 | `[{edge, file, line}]` |
| `GET /v1/projects/{pid}/changes` | 4 | `{base:"git_head"\|"last_index", changed_files, changed_nodes, impacted:[{node,score,hops}], tests:[Node], test_gaps:[Node]}` |
| `POST /v1/projects/{pid}/paths` `{node_ids, max_hops=4}` | 5 | `{nodes, edges, unconnected:[node_id]}` (chỉ cạnh thật) |
| `GET /v1/projects/{pid}/tour` | 6 | `[{step, title, node_ids, file, start, end, text}]` |
| `GET /v1/projects/{pid}/flutter/widgets?root` · `/flutter/routes` | 6 | cây widget · `[{route, screen_node, navigations}]` |

**Tool MCP** (kế hoạch con 5) dùng chung code với các route trên: `search`, `get_node`, `get_neighbors`, `get_impact`, `get_architecture`, `read_code`, `trace_flow`. Chạy được qua `nexgraph-engine mcp --project <path> --data-dir <dir>` (stdio). Từ 2026-10-24 (spec §5.10), CSDL đồ thị của project nằm ở `<path>/.nexgraph/`; `--data-dir` chỉ còn là thư mục dữ liệu cấp app và là nơi dự phòng khi `<path>` không ghi được. Kế hoạch con 2 chốt tham số cụ thể.

## Enum schema

Cố định từ đây. Spec §5.3 giao việc chốt tên cho builder.

- `NodeKind`: `repository, package, directory, file, module, class, mixin, enum, extension, function, method, test, widget, screen, route, document, concept`
- `EdgeType`: `CONTAINS, DEFINES, CALLS, IMPORTS, INHERITS, IMPLEMENTS, REFERENCES, USES_TYPE, TESTED_BY, DOCUMENTS, DEPENDS_ON, SEMANTIC_RELATED, COMPOSES, NAVIGATES_TO`
- `Confidence`: `EXTRACTED, INFERRED, AMBIGUOUS`. `Origin`: `ast, resolver, llm`
- Node id: `{rel_path}::{Qualified.Name}#{kind}`. Node file: `{rel_path}#file`. `rel_path` dùng `/` trên mọi hệ điều hành.

## Các kế hoạch con

| # | Sprint | Kế hoạch con | Người | Kết quả kiểm chứng (từ spec §8.2) |
|---|---|---|---|---|
| 1 | Tuần 2 (19–25/10) | **Nền tảng**: repo, engine sidecar + Graphify vendored, Electron shell, CI + bản cài 2 OS, mockup, spike Dart, spike ACP, khung SRS | Cả nhóm | Bản cài từ CI mở được trên Mac + Win, gọi được engine; 2 báo cáo spike |
| 2 | Tuần 3 (26/10–1/11) | **Index & schema** (grammar Dart: `tree-sitter-dart==0.1.0` theo spike 2026-10-27): schema/enum, đa cạnh, SQLite store, extractor Dart Tree-sitter (cấu trúc), job index 2 pha + SSE, projects/nodes/neighbors/code · **Graph explorer v0** | P1 · P2 | Index 1 project Flutter của lớp, xem graph lân cận |
| 3 | Tuần 4 (2–8/11) | **Search & kiến trúc**: FTS5, architecture + evidence, `.gitignore`/generated, cache, huỷ job · UI Search + tab Kiến trúc + Projects/Indexing | P1 · P2 | Tầng S < 60 s trên project của lớp |
| 4 | Tuần 5 (9–15/11) | **Thay đổi & ảnh hưởng**: watcher, diff→node, impact có trọng số, TESTED_BY, test gap, chế độ không Git · UI Changes + code viewer | P1 · P2 | Bước 4 của demo chạy |
| 5 | Tuần 6 (16–22/11) | **AI** (theo spike 2026-10-27: adapter API key là đường chính, adapter ACP/OpenCode ghi "hạn chế yếu" và phải cứng hoá môi trường, ghim OpenCode 2.1.4): MCP (trong app + stdio), adapter ACP OpenCode chỉ đọc (theo kết luận spike) + adapter API key, keychain, chat có trích dẫn + kiểm tra, `/paths` | P3 (+P1 cho `/paths`) · P2 (UI chat) | Bước 3 của demo chạy |
| 6 | Tuần 7 (23–29/11) | **Flutter & tour**: COMPOSES, NAVIGATES_TO, pubspec, tab Flutter, guided tour, i18n hoàn chỉnh. **Alpha** | P1 · P2 | Toàn bộ kịch bản demo chạy |
| 7 | Tuần 8 (30/11–6/12) | **Đánh giá & ổn định**: nhãn tay, so với regex của Graphify, đo tầng S/L (open-design), khảo sát, sửa lỗi, video dự phòng | P3 chủ trì, cả nhóm | Số liệu chương 3; **GVHD đánh giá %** |
| — | Tuần 9–10 (7–20/12) | Báo cáo, UML, slide, tập demo (không có kế hoạch code) | Cả nhóm | Nộp LMS 21–27/12 |

**Việc không phải code chạy song song** (người phụ trách):
- SRS + đặc tả use case: tuần 2–4. UC01, 02, 03, 05 cho P2. UC04, 06, 11 cho P1. UC07, 08, 09, 10 cho P3.
- Test plan: tuần 3–5 (P3).
- Sơ đồ lớp/tuần tự/kiến trúc: vẽ dần theo sprint, chốt tuần 9.
- Phiếu theo dõi tiến độ: sau mỗi sprint review, P1 ghi nội dung tuần và nộp GVHD ký.

**Thứ tự cắt khi trễ** (spec §12): F9 → F7 → F5 chỉ giữ adapter API key.

## Quy ước làm việc (spec §8)
- Nhánh `feat/<plan>-<task>`, PR vào `main`, ít nhất 1 review, CI phải xanh.
- Commit theo Conventional Commits. Không thêm dòng `Co-Authored-By`.
- Sửa file trong `engine/src/graphify/` thì thêm dòng đầu `# Modified by NexGraph contributors, 2026` (Apache-2.0 §4b).
