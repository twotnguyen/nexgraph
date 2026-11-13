# NexGraph — Lộ trình triển khai (kế hoạch tổng)

**Spec:** `docs/superpowers/specs/2026-10-18-nexgraph-desktop-design.md` (đã duyệt 2026-10-18)

## Vì sao chia thành nhiều kế hoạch con

Spec gồm ba hệ thống con phát triển song song bởi ba người: engine Python, ứng dụng desktop, tích hợp AI. Chi tiết của nhiều phần phụ thuộc vào kết quả spike tuần 2:
- Grammar Dart có chạy cùng phiên bản tree-sitter của engine không.
- Agent cục bộ qua ACP có ép được chỉ đọc không.

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
│   ├── src/graphify/            # mã trích xuất vendored @ 86c57be (Apache-2.0)
│   ├── third_party/graphify/    # LICENSE, LICENSE-MIT, NOTICE, UPSTREAM.md
│   ├── tests/                   # pytest
│   └── packaging/               # PyInstaller spec
├── apps/desktop/                # Electron + React + TS (electron-vite) — P2 (và P3 cho src/main/ai/)
│   ├── src/main/                # engine launcher, IPC, ai/ (ACP, API key), keychain
│   ├── src/preload/
│   └── src/renderer/            # React, React Flow + ELK, i18n vi/en
├── design/mockups/              # mockup HTML (tuần 1, đã xong)
├── docs/                        # spec, plans, srs/, test-plan/, report/
├── .github/workflows/ci.yml
├── LICENSE  NOTICE
```

## Hợp đồng API engine v1

Hợp đồng này để P1 (engine) và P2/P3 (desktop, AI) làm song song. Có ba quy tắc chung:

- Mọi route đều dưới `/v1`, yêu cầu `Authorization: Bearer <token>`, và chỉ chấp nhận `Host` là `127.0.0.1:<port>` hoặc `localhost:<port>`.
- Trả lỗi dạng `{"error": {"code": str, "message": str}}`.
- Đổi hợp đồng thì phải sửa file này trong cùng một PR.

| Method & path | Kế hoạch con | Trả về (rút gọn) |
|---|---|---|
| `GET /v1/health` | 1 | `{status:"ok", api_version:"1", engine_version, vendor_commit}` |
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
| `GET /v1/projects/{pid}/changes?refresh=true` | 4 | `Changes` (xem "Hình dạng JSON bổ sung (kế hoạch con 4)") |
| `POST /v1/projects/{pid}/refresh` | 4 | `Refresh`: lập chỉ mục tăng dần; `status:"skipped"` khi đang lập chỉ mục đầy đủ (`index_running`), đang refresh (`refresh_running`) hoặc chưa lập chỉ mục (`not_indexed`) |
| `POST /v1/projects/{pid}/paths` `{node_ids(2–10), max_hops=4 (1–6), directed=true}` | F10-1 (thay 5) | `{nodes, edges, unconnected:[node_id]}` (chỉ cạnh thật: CALLS, IMPORTS, INHERITS, IMPLEMENTS, REFERENCES, USES_TYPE, COMPOSES, NAVIGATES_TO) |
| `GET /v1/projects/{pid}/impact?node` | F10-1 | `{node, impacted:[{node, score, hops}], tests:[Node], truncated}` (vùng ảnh hưởng nếu sửa một nút) |
| `POST /v1/projects/{pid}/ask` `{question, depth=2 (1–6), budget=2000, mode="bfs"\|"dfs"}` | F10-1 | `{seeds, nodes, edges, truncated}` (hỏi graph không cần AI) |
| `GET /v1/projects/{pid}/report` | F10-1 | `{god_nodes:[{node, degree}], communities:[{id:"com:<n>", label, size, cohesion}], surprising:[{source, target, source_files, relation, why}], questions:[{question, why}], benchmark:{corpus_tokens, graph_tokens, reduction}\|null, truncated}` |
| `POST /v1/projects/{pid}/export` `{format, scope:{kind:"all"\|"community"\|"node", value?}, out_dir}` | F10-1 | `{files, truncated}`; `format` ∈ html, callflow_html, obsidian, wiki, svg, graphml, cypher, json, markdown; tối đa 5.000 node |
| `POST /v1/projects/{pid}/export/push` `{target:"neo4j"\|"falkordb", uri, user?, password?, scope}` | F10-1 | `{nodes, edges, truncated}`; `502 push_failed`; mật khẩu không lưu |
| `POST /v1/projects/{pid}/communities` | F10-1 | `{communities:int}` (gom cụm lại) |

Lỗi chung của các route F10-1: `409 not_indexed` khi dự án chưa lập chỉ mục xong.
| `GET /v1/projects/{pid}/tour` | 6 | `[{step, title, node_ids, file, start, end, text}]` |
| `GET /v1/projects/{pid}/flutter/widgets?root` · `/flutter/routes` | 6 | cây widget · `[{route, screen_node, navigations}]` |

**Tool MCP** (kế hoạch con 5) dùng chung code với các route trên: `search`, `get_node`, `get_neighbors`, `get_impact`, `get_architecture`, `read_code`, `trace_flow`. Chạy được qua `nexgraph-engine mcp --project <path> --data-dir <dir>` (stdio). Từ 2026-10-24 (spec §5.10), CSDL đồ thị của project nằm ở `<path>/.nexgraph/`; `--data-dir` chỉ còn là thư mục dữ liệu cấp app và là nơi dự phòng khi `<path>` không ghi được. Kế hoạch con 2 chốt tham số cụ thể.

**MCP stdio đã cài (2026-11-11, nhánh `feat/p5-mcp`)**: `engine/src/nexgraph_engine/mcp/server.py`, SDK `mcp>=1.10,<2` (FastMCP; bản 2.x đổi API nên ghim dưới 2). Bảy tool, đều khai báo `readOnlyHint`: `search(query, kinds?, limit)`, `get_node(node_id)`, `get_neighbors(node_id, types?, direction, depth, limit)`, `get_architecture(parent?)`, `get_evidence(from_block, to_block, limit)` (thêm so với danh sách trên, cần cho trích dẫn), `get_impact()`, `read_code(file, start?, end?)`. Kết quả cùng hình dạng JSON với route HTTP tương ứng (dùng chung hàm `*_json` trong `api/routes_*.py`). Lỗi nghiệp vụ trả về lỗi tool kèm thông điệp tiếng Việt. `--data-dir` tuỳ chọn; chỉ đọc CSDL đã có, dự án chưa lập chỉ mục thì thoát mã 3. `get_impact` **không** tự refresh (MCP không ghi). `trace_flow` chờ `/paths`. Biến `NEXGRAPH_MCP_TIMEOUT` (giây) giới hạn thời gian mỗi tool, mặc định không giới hạn.

**MCP tương đương Graphify (2026-11-13, F10 đợt 1)**: thêm năm tool chỉ đọc, tổng **12 tool**: `query_graph(question, depth=2, budget=2000, mode=bfs|dfs)` (= `/ask`), `shortest_path(source, target, max_hops=4, directed=true)` (= `/paths`, thay cho `trace_flow`), `god_nodes(top=10)` (lấy từ `/report`), `graph_stats()`, `get_community(community_id "com:<n>", limit=200)` → `{community:{id,label,size,cohesion}, nodes, truncated}`. Transport HTTP: `nexgraph-engine mcp --project P [--data-dir D] --http --port N` chạy Streamable HTTP tại `127.0.0.1:N/mcp` (0 = cổng ngẫu nhiên), in dòng `{"event":"ready","port":…}` như `serve`; bắt buộc `NEXGRAPH_MCP_KEY` (≥ 32 ký tự, thiếu thì thoát mã 2), request thiếu/sai header `X-API-Key` nhận 401.

## Hình dạng JSON v1 (chốt ở kế hoạch con 2, 2026-10-27)

```
Node  = {id, kind, label, qualified_name, language|null, file|null, line_start|null, line_end|null,
         is_test, origin, signature|null, community: null}
Edge  = {id, source, target, type, subtype|null, confidence, confidence_score, origin,
         evidence: {file, line, col|null} | null}
Job   = {job_id, project_id, state: "queued"|"structure"|"resolve"|"done"|"error"|"cancelled",
         files_done, files_total, message|null}
```

- `POST /v1/projects` → `{project_id, path, name, is_git, storage: "in_project"|"app_dir"}` (`400 bad_path`). `GET /v1/projects` thêm `last_indexed_at` (giây Unix hoặc `null`) và `last_index_commit`.
- `POST /v1/projects/{pid}/index` → `202 {job_id}`; `404 unknown_project`, `409 index_running`. `DELETE /v1/jobs/{id}` → `{cancelled: bool}`; hủy cộng tác giữa các tệp.
- `GET /v1/events` (SSE): `data: {"type":"job_progress", ...Job}` và `data: {"type":"graph_updated","project_id":...}` (phát hai lần mỗi lần index: sau giai đoạn 1 và sau giai đoạn 2); dòng `: ping` định kỳ.
- `GET /v1/projects/{pid}/neighbors?node&types&direction&depth(1–3)&limit(1–2000)` → `{nodes, edges, truncated}`; tham số sai `400 bad_param`, nút lạ `404 unknown_node`. `GET .../nodes/{id}` (id mã hoá URL) → `Node`.
- `GET .../code?file&start&end` → `{file, start, end, text, language, stale}`. Chỉ phục vụ **tệp đã lập chỉ mục**; `file` phải là đường dẫn tương đối trong project (`400 bad_path`, `403 outside_project`, `404 file_not_found`); tối đa 2.000 dòng; `stale` là `true` khi tệp đã đổi so với lần lập chỉ mục.
- `GET .../stats` → `{files, nodes_by_kind, edges_by_type, languages, unresolved}`.
- Nút gốc có id `.#repository`; thư mục `{rel_path}#directory`; tệp `{rel_path}#file`.

## Hình dạng JSON bổ sung (chốt ở kế hoạch con 3, 2026-10-27)

```
SearchHit = {node: Node, score: float}                      # GET .../search?q&kinds&limit(1–100) → [SearchHit], giảm dần theo score
Block     = {id, label, kind: "directory"|"community"|"file"|"group", size, symbols, drillable}
Link      = {from, to, count, types: {"CALLS": n, "IMPORTS": m}}
ArchView  = {parent: {id, label} | null, blocks: [Block], links: [Link]}   # GET .../architecture?parent=
Evidence  = {edge: Edge, file, line}                        # GET .../architecture/evidence?from&to&limit(1–200) → [Evidence]
Scan      = {files, by_language, large, threshold: 5000, top_dirs: [{path, files}]}   # GET .../scan
```

- Id khối tự mô tả: `dir:<rel_path>`, `file:<rel_path>`, `com:<ma_khoi>`, `more:<id khối cha hoặc rỗng>`. `size` là số tệp, `symbols` là số nút ký hiệu trong các tệp đó. Mỗi màn tối đa 12 khối; phần dư gộp vào một khối `group` "Khác (N mục)".
- Mũi tên chỉ tổng hợp cạnh `IMPORTS` và `CALLS` giữa hai tệp khác nhau; `count` bằng đúng số mục `Evidence` (khi `limit` đủ lớn). Lỗi: `404 unknown_block`, `400 bad_param`.
- `GET .../search`: `400 bad_param` khi chuỗi không có từ nào tìm được; từ khoá nằm trong ngoặc kép nên toán tử FTS5 trong dữ liệu người dùng không có nghĩa.
- `POST .../index` nhận thân tuỳ chọn `{"subdir": "lib/features"}`; `400 bad_path` khi thư mục con không hợp lệ.

## Hình dạng JSON bổ sung (chốt ở kế hoạch con 4, 2026-10-27)

```
Changes = {base: "git_head"|"last_index", base_commit: str|null, note: str|null,
           changed_files: [{path, status: "M"|"A"|"D"|"R", old_path: str|null}],
           changed_nodes: [Node],
           impacted: [{node: Node, score: float, hops: 1|2}],     # giảm dần theo score; không chứa nút kiểm thử
           tests: [Node], test_gaps: [Node], truncated: bool}
Refresh = {status: "ok"|"skipped", reason: "index_running"|"refresh_running"|"not_indexed"|null,
           added, changed, removed, seconds}
SSE: {"type": "changes_updated", "project_id": str}               # sau mỗi refresh có thay đổi (kèm graph_updated)
```

- `note` khác null khi không so với Git: "Không có Git: so với lần lập chỉ mục trước" hoặc "Repo Git chưa có commit: …". Chế độ này so mã băm với mốc `moc_tep` của lần lập chỉ mục đầy đủ; `changed_nodes` là mọi nút của tệp đổi.
- Lan truyền ngược chiều phụ thuộc (CALLS 1.0, INHERITS/IMPLEMENTS 0.9, REFERENCES/USES_TYPE 0.6, IMPORTS 0.5; TESTED_BY xuôi 0.7), decay 0.6, tối đa 2 bước, ngưỡng 0.2, tối đa 200 nút. Test liên quan = `TESTED_BY` của nút đổi hoặc của người gọi trong 2 bước; test gap = hàm/phương thức đổi không có test liên quan.
- `graph.sql` phiên bản 2 (cộng thêm): `kieu_bien`, `moc_tep`, `lan_lap_chi_muc.thu_muc_con`.

## Enum schema

Cố định từ đây. Spec §5.3 giao việc chốt tên cho builder.

- `NodeKind`: `repository, package, directory, file, module, class, mixin, enum, extension, function, method, test, widget, screen, route, document, concept`
- `EdgeType`: `CONTAINS, DEFINES, CALLS, IMPORTS, INHERITS, IMPLEMENTS, REFERENCES, USES_TYPE, TESTED_BY, DOCUMENTS, DEPENDS_ON, SEMANTIC_RELATED, COMPOSES, NAVIGATES_TO`
- `Confidence`: `EXTRACTED, INFERRED, AMBIGUOUS`. `Origin`: `ast, resolver, llm`
- Node id: `{rel_path}::{Qualified.Name}#{kind}`. Node file: `{rel_path}#file`. `rel_path` dùng `/` trên mọi hệ điều hành.

## Các kế hoạch con

| # | Sprint | Kế hoạch con | Người | Kết quả kiểm chứng (từ spec §8.2) |
|---|---|---|---|---|
| 1 | Tuần 2 (19–25/10) | **Nền tảng**: repo, engine sidecar + mã trích xuất vendored, Electron shell, CI + bản cài 2 OS, mockup, spike Dart, spike ACP, khung SRS | Cả nhóm | Bản cài từ CI mở được trên Mac + Win, gọi được engine; 2 báo cáo spike |
| 2 | Tuần 3 (26/10–1/11) | *(chi tiết: `2026-10-27-nexgraph-p2-index-schema.md`)* **Index & schema** (grammar Dart: `tree-sitter-dart==0.1.0` theo spike 2026-10-27): schema/enum, đa cạnh, SQLite store, extractor Dart Tree-sitter (cấu trúc), job index 2 pha + SSE, projects/nodes/neighbors/code · **Graph explorer v0** | P1 · P2 | Index 1 project Flutter của lớp, xem graph lân cận |
| 3 | Tuần 4 (2–8/11) | *(chi tiết: `2026-10-27-nexgraph-p3-search-architecture.md`; cache và parse song song chuyển sang kế hoạch con 4 và tuần 8)* **Search & kiến trúc**: FTS5, architecture + evidence, `.gitignore`/generated, cache, huỷ job · UI Search + tab Kiến trúc + Projects/Indexing | P1 · P2 | Tầng S < 60 s trên project của lớp |
| 4 | Tuần 5 (9–15/11) | *(chi tiết: `2026-10-27-nexgraph-p4-changes-impact.md`; đề xuất `graph.sql` v2 cộng thêm 2 bảng + 1 cột, chờ người dùng xác nhận)* **Thay đổi & ảnh hưởng** (kèm cache theo mã băm và lập chỉ mục tăng dần: cần lưu mọi tham chiếu, kể cả đã phân giải, nên phải quyết định có đổi `graph.sql` lên phiên bản 2 hay không): watcher, diff→node, impact có trọng số, TESTED_BY, test gap, chế độ không Git · UI Changes + code viewer | P1 · P2 | Bước 4 của demo chạy |
| 5 | Tuần 6 (16–22/11) | **AI** (theo spike 2026-10-27: adapter API key là đường chính, adapter ACP ghi "hạn chế yếu" và phải cứng hoá môi trường, ghim phiên bản agent đã kiểm thử): MCP (trong app + stdio), adapter ACP chỉ đọc (theo kết luận spike) + adapter API key, keychain, chat có trích dẫn + kiểm tra, `/paths` | P3 (+P1 cho `/paths`) · P2 (UI chat) | Bước 3 của demo chạy |
| 6 | Tuần 7 (23–29/11) | **Flutter & tour**: COMPOSES, NAVIGATES_TO, pubspec, tab Flutter, guided tour, i18n hoàn chỉnh. **Alpha** | P1 · P2 | Toàn bộ kịch bản demo chạy |
| 7 | Tuần 8 (30/11–6/12) | **Đánh giá & ổn định**: nhãn tay, so với extractor regex gốc, đo tầng S/L, khảo sát, sửa lỗi, video dự phòng | P3 chủ trì, cả nhóm | Số liệu chương 3; **GVHD đánh giá %** |
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
