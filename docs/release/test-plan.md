# Kế hoạch kiểm thử NexGraph 0.2.0

Áp dụng cho bản ứng viên **0.2.0** (bản đang phát hành: 0.1.2). Mục tiêu: chứng minh F1–F16 và các yêu cầu phi chức năng trong [SRS](../srs/SRS.md) đạt trên bản cài thật ở cả hai hệ điều hành, và ghi lại bằng chứng đủ để bảo vệ trước hội đồng.

## 1. Phạm vi

| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Bộ cài Electron + Monaco trên macOS arm64 và Windows x64 | Mac Intel, Windows ARM (R2) |
| F1–F16, trừ phần ghi chú riêng | Bản xem trước Code-OSS (có biên bản riêng) |
| AI qua API key/nhà cung cấp tương thích, Gemini qua Antigravity CLI nếu có tài khoản | OAuth thật của ChatGPT/Claude (chỉ ghi nếu thử được) |
| MCP bằng client thật (Claude Code, Codex CLI) | Marketplace extension, chỉnh sửa cộng tác ngoài LAN |
| Hiệu năng theo ngưỡng SRS §NFR | Đo lại toàn bộ benchmark lịch sử (chỉ đo các mốc trong SRS) |

## 2. Môi trường

| Môi trường | Dùng cho | Ghi chú |
|---|---|---|
| CI GitHub (`macos-latest`, `windows-latest`) | test engine/desktop, typecheck, lint, đóng gói, smoke bộ cài | 7 check + job `release` khi có tag; run id ghi vào biên bản |
| macOS Apple silicon của nhóm | cài DMG, chạy checklist, demo, CDP | dùng `NEXGRAPH_DATA_DIR` riêng cho từng lượt |
| Windows 11 x64 của nhóm | cài NSIS, chạy checklist, demo | máy này từng bị Code Integrity chặn; xem [README](../release/README.md#mở-bộ-cài-chưa-ký-số) |
| Máy có GPU rời/không WebGL | kiểm fallback Bản đồ | thêm `--disable-webgl` |

Phần cứng và hệ điều hành của từng máy ghi vào biên bản theo mẫu ở [traceability](../srs/traceability.md#biên-bản-cho-bản-bàn-giao).

## 3. Mức kiểm và lệnh chạy

### 3.1 Tự động (chặn merge)

```sh
# engine
cd engine && env -u PYTHONPATH uv run --locked pytest -q -n auto
# desktop
pnpm typecheck && env -u PYTHONPATH pnpm test
# lint đúng như CI
npx --yes @biomejs/biome@2.3.0 lint --diagnostic-level=error --skip=a11y --skip=correctness/useExhaustiveDependencies --skip=correctness/noVoidTypeReturn --skip=suspicious/noAssignInExpressions --skip=suspicious/useIterableCallbackReturn --skip=suspicious/noShadowRestrictedNames --skip=suspicious/noImplicitAnyLet --skip=suspicious/noControlCharactersInRegex --skip=suspicious/noArrayIndexKey --skip=security/noDangerouslySetInnerHtml apps/desktop/src
```

Số test thực tế của bản RC ghi theo run CI của commit merge, không chép số cũ.

### 3.2 Opt-in (chạy tay, có điều kiện)

| Nhóm | Biến/kênh | Điều kiện | Ghi chú |
|---|---|---|---|
| E2E agent với engine thật + LLM giả | `NEXGRAPH_E2E=1` | macOS/Linux, không đặt `PYTHONPATH` | CI đặt biến này ở job desktop |
| Gỡ lỗi DAP thật (js-debug + debugpy) | `NEXGRAPH_DEBUG_IT=1` | cần mạng tải adapter | 15 test, CI không chạy |
| Antigravity CLI thật | `NEXGRAPH_ANTIGRAVITY_TEST_BINARY=<đường dẫn>` | Windows + binary có chữ ký | 1 test |

Hướng dẫn chi tiết và bẫy `PYTHONPATH` ở [docs/testing.md](../testing.md).

### 3.3 Smoke bộ cài (CI)

Mỗi bộ cài được cài vào thư mục tạm rồi chạy `smoke-packaged.mjs`; dòng `SMOKE OK` phải có đủ `fs agent index edit_policy acceptance workspace_controls sessions plan process rollback draft_context gemini_status gemini_ui`, thêm `webgl_fallback` khi tắt WebGL. Chi tiết trường ở [README](../release/README.md).

### 3.4 Tay trên bản cài (chặn phát hành)

Chạy [checklist Windows/macOS](../windows-checklist.md) mục A–E trên bản cài đã đối chiếu hash, và [checklist graphify](acceptance/checklist-graphify.md) cho các mục F10 dùng được trên macOS; mục nào không chạy được thì ghi "Chưa chạy" + lý do.

## 4. Ca kiểm theo chức năng

| Mã | Ca kiểm chính | Nguồn | Môi trường |
|---|---|---|---|
| F1 | mở dự án, index, huỷ giữa chừng, mở lại; dự án lớn chọn thư mục con | traceability F1, checklist B/C | cả hai |
| F2 | kiến trúc, mở bằng chứng tệp:dòng | checklist B | cả hai |
| F3/F4 | graph, tìm trong đồ thị, Hỏi graph | demo bước 2–3 | cả hai |
| F5/F14 | Hỏi/Kế hoạch/Sửa: trích dẫn, duyệt, từ chối, dừng, chạy lệnh có duyệt | demo bước 3–4, UC15 | cả hai |
| F6 | sửa tệp → Vùng ảnh hưởng, test liên quan, không Git | checklist C | cả hai |
| F7 | tour khi AI tắt | checklist D | một máy |
| F8 | MCP stdio + HTTP, 25 tool, 6 resource, client thật | checklist D, mục 5 | macOS trước |
| F9/F10 | xuất 9 định dạng, báo cáo, tài liệu, clone/URL, graph chung | checklist graphify §3.4, §3.6 | cả hai |
| F11/F12 | luồng `signIn`, bản đồ, fallback WebGL | demo bước 2, checklist C | cả hai |
| F13 | Monaco, CRLF/BOM, xung đột tệp | checklist D | cả hai |
| F15 | tích hợp Codex, giữ cấu hình có sẵn | checklist D | một máy |
| F16 | LSP TS/Python, terminal, Git, DAP, cộng tác LAN, extension | UC18 | cả hai; LAN cần 2 máy |
| NFR | index < 60 s (S), < 10 phút (L), mở lại < 3 s (dự án nhỏ) / < 5 s (dự án lớn), RAM < 2 GB, bộ cài < 500 MB, UI ≤ 2.000 node | SRS NFR, benchmark | macOS + CI |

## 5. Dữ liệu thử

| Dữ liệu | Dùng cho |
|---|---|
| `engine/tests/fixtures/flow_app` | demo nhanh, Monaco, luồng, trích dẫn, duyệt sửa |
| `engine/tests/fixtures/polyglot` | đa ngôn ngữ, LSP, MCP query |
| `engine/tests/fixtures/docs_app` | tài liệu, section, che secret |
| `engine/tests/fixtures/global_ts_app` + `global_ts_lib` | graph chung, cộng tác nhiều repo |
| Bản sao `ecommerce-backend-nestjs` tại `d11f4ef` | demo 5 phút, hiệu năng tầng S, Git |
| Một repo nhỏ ngoài GitHub | clone/URL, pull request (cần `gh`) |

Mỗi lượt dùng bản sao sạch, hồ sơ dữ liệu riêng; đặt ít nhất một bản sao trong thư mục có dấu và khoảng trắng.

## 6. Tiêu chí đạt

- **Đạt phát hành** khi: 7 check CI xanh trên commit merge; smoke cả hai bộ cài đạt; checklist A–E không còn mục **Lỗi** ở luồng chính; ba lượt demo chạy trọn; không có lỗi mất dữ liệu hoặc ghi ngoài phạm vi dự án.
- **Chặn phát hành (blocker):** crash khi mở dự án/index; mất hoặc hỏng tệp người dùng; duyệt AI ghi khi chưa duyệt; engine không thoát khi đóng app; bộ cài không mở được trên máy đích (trừ khi do chính sách máy, ghi rõ); trích dẫn sai vẫn hiện như đã xác minh.
- **Không chặn:** lỗi giao diện nhỏ, thiếu bản dịch một nhãn, giới hạn đã biết trong [ghi chú phát hành](notes-0.2.0.md), mục "Chưa chạy" có lý do và người chịu trách nhiệm.
- Mọi mục "Chưa chạy" phải có lý do và kế hoạch; không được để trống.

## 7. Phân công

| Việc | macOS | Windows | Ghi chú |
|---|---|---|---|
| Chạy test tự động, typecheck, lint | bot/CI | CI | kết quả theo run id |
| Cài bộ cài + checklist A–E | Tình | Đông/Tùng (máy thật) | ai chạy ghi tên vào biên bản |
| Demo 3 lượt | Tình | Đông/Tùng | cùng commit, cùng fixture |
| AI thật (provider.env, cockpit-tools) | Tình | — | đường B; đường A ghi "chưa kiểm" nếu chưa có |
| MCP với client thật | Tình (Claude Code/Codex CLI) | — | ghi tên client + phiên bản |
| Graphify checklist | Tình | Đông/Tùng phần chạy được | mục cần mạng/gh ghi rõ |
| Đo hiệu năng | Tình | Đông/Tùng | cùng máy, cùng fixture |
| Ký/nộp biên bản | Tình | — | BM03 |

## 8. Biên bản và lịch

- Biên bản đặt tại `docs/release/acceptance/<ngày>-<hệ-điều-hành>.md`, theo mẫu trường trong [traceability](../srs/traceability.md#biên-bản-cho-bản-bàn-giao).
- Mỗi lượt ghi: commit, run id, tệp cài + SHA-256, hệ điều hành/kiến trúc, provider/model, kết quả từng mục, ảnh hoặc video, log lỗi.
- Mốc: RC xong trước **29/11** (Alpha); nghiệm thu đầy đủ trước **20/12**; báo cáo tuần 8 dùng số của đợt đo lại, không dùng số 13/11.
- Lỗi phát hiện trong nghiệm thu mở đợt sửa riêng, không sửa trực tiếp trong lúc chạy biên bản.
