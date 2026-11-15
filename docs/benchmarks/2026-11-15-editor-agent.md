# Kiểm chứng editor + agent — 2026-11-15

Nhánh `feat/editor-agent`, worktree `nexgraph-editor-agent`. Tiếp quản sau commit `6cea8ca` (Task 0–5); triển khai Task 6–8 và phần có thể chạy trên macOS của Task 9. Không push/PR hoặc merge `main`.

## Kiểm tự động

| Kiểm | Kết quả quan sát |
|---|---|
| Engine `uv run pytest -q` | 466 passed, 5 warnings (Starlette/httpx và cache-root Graphify) |
| Desktop `pnpm --filter @nexgraph/desktop test` | 409 passed, 1 skipped |
| Desktop typecheck | Node + renderer sạch |
| PyInstaller | Build complete, engine 232.096 KiB trên đĩa |
| `package:dir` và `package` | Thành công trên macOS arm64, chưa ký số |
| `smoke:packaged` sau bản cuối | `SMOKE OK nodes=2 fs=OK agent=OK` |
| DMG | 239.223.266 byte, khoảng 239,2 MB, dưới ngưỡng 400 MB |
| `.app` giải nén | 701.224 KiB trên đĩa; không nhầm với kích thước DMG |

Desktop suite chạy trước thay đổi cuối chỉ về thứ tự dispose/dạng hiển thị Monaco diff; sau thay đổi này typecheck, package và smoke đều chạy lại. Hành vi dispose được kiểm trực tiếp trên Monaco thật, không dùng mock để tuyên bố đúng runtime.

## Kiểm trên bản đóng gói Electron thật

Dùng CDP cổng 9447, cửa sổ 1280×772, **bản sao** fixture `engine/tests/fixtures/flow_app` (4 tệp Python) tại `/tmp/nexgraph-editor-demo.16ni0W/project`. Engine thật đã lập chỉ mục. `NEXGRAPH_USER_DATA_DIR` và `NEXGRAPH_DATA_DIR` đều trỏ vào dữ liệu tạm, không dùng tài khoản hoặc sửa project thật của người dùng.

LLM là `scripts/fake-llm.mjs` cục bộ, không phải nhà cung cấp AI thật. Kịch bản demo edit chỉ dành cho fixture này; máy chủ gọi `list_flows` → `trace_flow` → `get_impact` → `edit`, sau đó trả lời có trích dẫn thật lẫn một trích dẫn giả có chủ đích.

- Settings: thêm custom provider, chọn model, **Kiểm tra kết nối** hiện “Kết nối được”. Cảnh báo OAuth hiện nguyên văn. Ảnh: `2026-11-15-editor-accounts.png`.
- Monaco: mở `service.py` từ Cây, cú pháp Python có màu, sửa hàm `login_user`, thẻ có ●; Cmd+S lưu và hết ●. Panel Thay đổi tự hiện vùng ảnh hưởng (`login`, `main`, …), kiểm thử liên quan `test_login`.
- Hỏi: hộp đồng ý gửi mã xuất hiện trước lần gửi đầu; `list_flows` → `trace_flow` trả 3/4 trích dẫn hợp lệ, chip giả khoá. Chip thật mở Monaco đúng dòng; **Tô luồng** hiện 3 nút/2 cạnh thật. Ảnh: `2026-11-15-editor-ask.png`.
- Sửa: chuyển chế độ hiện confirm cảnh báo không có sandbox. Diff Monaco hiện đường dẫn và Duyệt/Từ chối. Duyệt đổi byte tệp thật, thẻ sạch tự nạp lại và panel Thay đổi vẫn hiện ảnh hưởng/test. Ảnh bản cuối: `2026-11-15-editor-approval.png`.
- Từ chối và Dừng khi đang chờ duyệt: không thay đổi tệp. SHA1 trước/sau hai thao tác: `5abd1f35f517b7cda167a411ee6b18696be2a6d0`.
- Sau khi mở lại bản cuối: lặp Từ chối rồi Duyệt, cả hai lượt kết thúc, **không có pageerror**. Bắt và sửa lỗi runtime trước đó: `TextModel got disposed before DiffEditorWidget model got reset` — dispose DiffEditor trước hai model.

## Các sửa sau review

- Chặn read fallback tên tệp của pi; write/edit dùng snapshot có đường dẫn canonical, nội dung, trạng thái tồn tại, mtime, EOL/BOM; kiểm lại trước ghi nguyên tử. Chặn symlink bị tráo và bản duyệt đã cũ.
- Huỷ cả lượt agent đang chờ model/root; không gửi prompt trễ sau khi đóng dự án.
- OAuth rollback riêng provider, không phục hồi tài khoản khác đã logout; rời Settings huỷ login/prompt.
- Di trú giữ custom provider; đổi origin không mang key máy chủ cũ sang máy chủ mới; custom ID không đè provider có sẵn.
- Editor giữ baseline đúng khi chọn “Giữ bản của tôi”; cập nhật trạng thái chỉ đọc khi tệp ngoài đổi loại/kích thước.
- Quit rồi chọn “Ở lại” không dừng engine/watcher; regression test đã thấy đỏ rồi xanh.
- Smoke dùng userData riêng; Codex/skill kiểm containment, không ghi đè SKILL.md khác nội dung; block AGENTS nhận CRLF.

## Chưa nghiệm thu

- Windows thật, `bash` trên Windows, bản `.exe`, CI trên GitHub.
- API key/OAuth/custom endpoint của nhà cung cấp thật; dùng SDK pi thật với OAuth provider giả chỉ chứng minh adapter/lifecycle, không chứng minh chính sách bên cung cấp.
- Chạy trọn kịch bản 5 phút **ba lần trên NestJS** và quay video. Đã kiểm các đường lõi trên fixture nhỏ trong bản cài, không đổi tên phép kiểm này thành nghiệm thu demo NestJS.
- Codex binary thật load project MCP/skill, khảo sát và các mục H6 cần người dùng.

Bản cài chưa ký số; Gatekeeper có thể chặn. `bash` không có sandbox. Custom endpoint không key vẫn nhận `Bearer unused` theo giới hạn SDK pi, xem `install-notes.md`.
