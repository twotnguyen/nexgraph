# Ghi chú phát hành NexGraph 0.2.0 (bản nháp)

> **Trạng thái:** nháp, chưa phát hành. Bản đang phát hành là **0.1.2**. Tệp này là nội dung dự kiến cho GitHub Release `v0.2.0`; chỉ dùng sau khi RC được nghiệm thu và Tình tạo tag. **Cập nhật 23/11/2026:** các PR đã merge của đợt (#32–#48, #50–#54) đã vào `main` (`caeb85e`); danh sách dưới chỉ gồm PR đã merge, không còn mục “chờ merge”.

## Tóm tắt

0.2.0 gộp bộ công cụ phát triển kiểu Wu (F16, ADR 0020) vào bản Electron + Monaco: LSP, terminal, Git, gỡ lỗi DAP, cộng tác LAN và extension khai báo. Giao diện làm lại theo 5 vùng, có bảng lệnh, thanh trạng thái và chế độ tiếng Anh. Các luồng F1–F15 giữ nguyên hành vi. Bản RC dựng từ `main` (chuỗi phiên bản vẫn là 0.1.2) đã qua nghiệm thu demo trên macOS ([biên bản 23/11](acceptance/2026-11-23-macos.md)); các lỗi nghiệm thu được sửa trong cùng đợt (#50, #51, #52, #54) và sẽ đóng khi chạy lại bản cài.

## Tính năng mới

- **Editor và LSP (F16).** Gợi ý mã, hover, định nghĩa, tham chiếu, thứ bậc lời gọi, rename và code action cho TypeScript/JavaScript và Python; chẩn đoán hiện trong editor và panel Problems.
- **Terminal tích hợp (F16).** Nhiều phiên theo dự án, shell mặc định của máy (PowerShell/cmd trên Windows, `$SHELL` trên macOS), tác vụ nền có picker.
- **Git (F16).** Panel nhánh, thay đổi, lịch sử, diff theo hunk, stage/unstage, stash, worktree, xung đột theo khối, permalink tới dòng.
- **Gỡ lỗi DAP (F16).** Cấu hình chạy cho Node (js-debug) và Python (debugpy), breakpoint, stack, biến, bước tiếp, dừng; adapter tải về lần đầu.
- **Cộng tác LAN (F16).** Máy chia sẻ mở WebSocket trong mạng cục bộ và hiện địa chỉ `IP:cổng` cùng **mã mời 22 ký tự** (base64url); máy khác dán địa chỉ và mã mời để tham gia, tối đa 8 máy tham gia (không kể máy chia sẻ), không qua máy chủ ngoài.
- **Extension khai báo (F16).** Extension JSON khai báo theme và lệnh (theme đổi ngay; lệnh chèn văn bản hoặc chạy lệnh có sẵn của app); không nạp mã Node tuỳ ý, không có marketplace.
- **Giao diện.** Shell 5 vùng có pane kéo/thu gọn, thanh trạng thái 11 mục, bảng lệnh kiểu Wu, thông báo và dock, breadcrumb theo ký hiệu, multibuffer, bookmark.
- **Tiếng Anh.** Chuyển ngôn ngữ Việt/Anh trong Cài đặt, áp dụng ngay không cần khởi động lại; toàn bộ chuỗi giao diện có bản dịch (kiểm tự động).
- **Trợ lý AI.** Khung trợ lý mặc định bên phải và mở sẵn lần đầu vào workspace (giữ lựa chọn đã lưu); sửa lỗi xuất PNG dùng đúng thư mục xuất đã nhớ của dự án.
- **Nhà cung cấp OpenCode Go (#37).** Thêm trong Cài đặt tài khoản AI; danh sách model tự cập nhật, thông báo khi khôi phục key lỗi, token usage đường A.
- **Nhà cung cấp tuỳ chỉnh dùng được với provider thật (#46).** Tự nhận context window (có ô chỉnh), sàn `max_tokens`, báo đúng lỗi 4xx; **Tô luồng trên graph** tô cả nút được trích dẫn.

## Sửa lỗi nghiệm thu RC (macOS, 23/11)

- **#50** — engine bị kill **tự khởi động lại** (backoff, tối đa 5 lần/10 phút rồi hiện nút khởi động lại); **Tìm symbol** mở đúng `tệp:dòng` trong editor; **Vùng ảnh hưởng** hiện node và test khi mở từ menu node; bỏ tên thương hiệu “Pi” khỏi panel trợ lý; **Index lại** nhớ tuỳ chọn index.
- **#54** — chip trích dẫn đặt con trỏ và tô khoảng dòng; đổi model trong Cài đặt cập nhật panel chat đang mở; bubble lỗi AI gọn một câu, không còn 3 nút đánh giá; không còn engine mồ côi và thanh trạng thái nêu lý do engine chết; tuỳ chọn index lọc theo từng trường; bỏ dòng thừa “0 node, 0 cạnh liên quan”.
- **#43** — chip trích dẫn không còn rác, split từ thẻ xem trước, nút gốc “Dự án” ở breadcrumb Kiến trúc, test Git Windows ổn định, picker rỗng.
- **#42** — hover Monaco hiện đúng (luật transition toàn cục khi macOS bật Giảm chuyển động làm Monaco đo sai khung hover).
- **#39** — chip trích dẫn trong gạch đầu dòng, inline code và code fence; dedup; thông báo thử lại rõ ràng; danh sách ứng viên.
- **#35** — Đi đến khai báo/định nghĩa kiểu, chân picker, script lint.
- **#33** — trợ lý AI: trích dẫn `[[path:start–end]]`, stream không đứt, chế độ Kế hoạch, dedup khi AI tắt.

## Giao diện và i18n

- **#51** — nhãn và thông báo dịch lúc hiển thị (đổi VI↔EN có hiệu lực ngay, kể cả lỗi); số ít/số nhiều tiếng Anh; `html lang` theo ngôn ngữ; khung widget riêng cho từng bên diff; dấu “Đã cắt bớt” kèm `tệp:dòng`; test kiểm mọi khoá VI có bản EN.
- **#48** — engine trả mã lỗi ổn định (`graph_readonly`, `schema_outdated`…) thay lỗi 500 chung; báo cáo và HTML callflow theo ngôn ngữ UI.
- **#47** — tour/báo cáo theo ngôn ngữ; lỗi trợ lý qua i18n; báo rõ khi model có context nhỏ; thông báo khi refresh nền lỗi và gỡ khi khôi phục; thẻ xem trước thành tab thường khi split; biến `${file}` trong task chèn nguyên văn như VS Code.
- **#45** — đổi ngôn ngữ áp dụng ngay, chuỗi English sót, tràn chữ ở 1024/1280, hiện attribution React Flow.
- **#44** — ngôn ngữ văn bản sinh (tour/báo cáo), MCP bỏ qua probe `server/discover`, câu hỏi tiếng Việt khớp theo ranh giới từ.

## Bảo mật

- **#52** — che secret trong tài liệu trên **mọi** đường tới AI (context/`read_code`/section), giữ backtick và số dòng khi che; tài liệu có tên nhạy cảm (`secret`, `kubeconfig`, `service-account`, `gcp-*.json`) bị từ chối thay vì gửi đi; báo thư mục không đọc được khi lập chỉ mục; mã lỗi riêng cho chặn URL nội bộ.
- **#38** — lọc secret khỏi env tiến trình con; engine bỏ `PYTHONPATH`; task chỉ chạy khi main ký theo `tasks.json` của đúng dự án; agent sửa `.vscode/tasks.json`, `.husky/**`, `.github/workflows/**`, `package.json` **phải được duyệt tay**, kể cả khi chọn tự động trong phiên; chặn `core.fsmonitor`; Electron fuses và từ chối quyền không dùng.
- **#36** — chặn URL nội bộ cho nhà cung cấp AI, lọc nguồn AI ở mọi route, che secret trước khi gửi model, `get_impact(node_id)`, không ghi đè tệp khi xuất lần hai (kể cả ổ FAT), bỏ `dist/vendor/.venv` khi index.
- **#25** — siết xác thực cộng tác LAN.

## Hiệu năng và độ ổn định

- **#53** — index tầng L: lô quá hạn hoặc worker chết chỉ đẩy **tệp của lô đó** sang đường từng tệp (không hạ cả dự án xuống 1 worker), hạn chờ theo dung lượng có trần, bỏ bundle rút gọn (`_next/static`, tệp byte/dòng lớn), xếp tệp lớn trước. `open-design` 5.658 tệp: **500,5 s → 85,2 s** (8 worker); đồ thị bỏ 34 tệp rút gọn có chủ đích. Số chi tiết ở [số đo 23/11](../benchmarks/2026-11-23-nfr-va-do-lai.md).
- **#41** — index/refresh nguyên tử trong một giao dịch SQLite (kill -9 giữ đồ thị cũ); dọn job theo TTL; cờ `truncated`; báo CSDL hỏng.
- **#34** — logging tập trung, lỗi tới người dùng, resolver `self.x.method()`/`TESTED_BY` mô-đun/`#include` C (index chậm +3,5 %, 0 cạnh mất).
- **#27** — timeout job semantic đường A và fallback tuần tự của indexer.

## Kiểm thử và tài liệu

- **#40** — E2E chạy lặp an toàn, lint e2e, guard test.
- **#31** — hạ tầng E2E Electron (Playwright) và fixture checklist (đã merge trước đợt RC, vẫn là nền của bộ test hiện tại).
- **#30** — sửa gốc 2 test desktop chập chờn trên CI macOS.
- **#32** — đồng bộ tài liệu repo (SRS, ADR, hướng dẫn) và bản nháp release notes 0.2.0; bản hoàn chỉnh là tệp này.

## Giới hạn đã biết

- **Chưa ký số.** Bộ cài không có chứng chỉ nhà phát triển. macOS có thể báo "không xác minh được nhà phát triển" hoặc "bị hỏng"; Windows có SmartScreen, và máy bật Application Control/Code Integrity có thể chặn trình cài trước khi SmartScreen hiện ra. Cách mở ghi ở [README](README.md#mở-bộ-cài-chưa-ký-số).
- **Chỉ Apple silicon.** Không phát hành bản macOS Intel (x64) theo quyết định R2; Mac Intel ngoài phạm vi. Windows chỉ có x64, không có bản ARM.
- **LSP chỉ TS/JS và Python.** Ngôn ngữ khác có tô màu cú pháp nhưng không có gợi ý mã hay điều hướng ngữ nghĩa.
- **Terminal không phải sandbox.** Lệnh chạy với quyền tài khoản người dùng trong thư mục dự án.
- **Cộng tác LAN không có xác thực người dùng** ngoài mã mời 22 ký tự; chỉ dùng trong mạng tin cậy.
- **Extension chỉ khai báo** theme và lệnh, không có API mở rộng hay marketplace.
- **Codex TOML.** Khi `.codex/config.toml` đã có nội dung, phần cài đặt trả `invalid_config` thay vì merge (SPEC-09, chưa sửa trong 0.2.0).
- **Index bỏ thư mục ẩn theo mặc định.** `.storybook`, `.vitepress`, `.agents`, `.claude`… không được lập chỉ mục trừ khi chọn rõ trong **Tuỳ chọn index**; tab **Cây** vẫn hiện các thư mục này vì đọc đĩa (MIN-36-4).
- **MCP `get_section` từ chối tài liệu có tên nhạy cảm** (`secret`, `kubeconfig`, `service-account`, `gcp-*.json`) thay vì trả bản che — đúng thiết kế bảo mật (#52); UI **Đọc mục** vẫn hiện bản che.
- **Thư mục không đọc được:** engine trả `unreadable_paths`/`unreadable_count` khi lập chỉ mục (#52), nhưng giao diện chưa hiển thị cảnh báo.
- **Nhóm test opt-in không chạy ở CI:** 15 test gỡ lỗi DAP cần `NEXGRAPH_DEBUG_IT=1` và mạng để tải adapter; một test Antigravity cần Windows + `NEXGRAPH_ANTIGRAVITY_TEST_BINARY`. Xem [kế hoạch kiểm thử](test-plan.md).
- **Máy Windows của nhóm bị Code Integrity chặn bộ cài** (biên bản 18/11); luồng người dùng trên Windows được kiểm bằng bản build từ mã nguồn cho tới khi máy đó mở được bộ cài.

## Yêu cầu hệ thống

| Hạng mục | Yêu cầu |
|---|---|
| macOS | Apple silicon (arm64). Không hỗ trợ Mac Intel. |
| Windows | x64. Máy thử nghiệm: Windows 11 Home 25H2 (build 26200). |
| Ổ đĩa | Khoảng 650 MB sau khi cài (số của 0.1.0). DMG macOS 0.1.2: 257,7 MB. |
| Mạng | Chỉ cần khi dùng AI qua nhà cung cấp, clone repo, tải adapter gỡ lỗi hoặc cài Antigravity CLI. Các tính năng đọc đồ thị chạy offline. |

## Cài đặt

Theo [README](README.md): tải đúng tệp trong artifact của lượt CI xanh, đối chiếu `.build.json` (byte, SHA-256, commit), rồi mở theo hướng dẫn cho bộ cài chưa ký. Lần đầu mở bản macOS ad-hoc có thể hỏi Keychain — bấm **Always Allow** trước buổi demo ([kịch bản demo](../demo-script.md)).

## Ghi chú cho người bảo trì

- Body này thay cho body tự sinh của `gh release create … --generate-notes` (`.github/workflows/ci.yml:162`); khi tạo Release thật, dán nguyên văn (bỏ phần "Trạng thái" ở đầu) và gắn run id CI của commit merge.
- Không thêm PR chưa merge vào tệp này. Nhãn còn thiếu so với 0.1.2 chỉ được thêm khi có bằng chứng nghiệm thu trong [biên bản](acceptance/).
