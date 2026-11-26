# Sửa và kiểm chứng sau review H0–H6

Ngày 2026-11-13, macOS arm64. Không commit/push trong phiên sửa. Dữ liệu app và dự án kiểm thử nằm trong thư mục tạm riêng, không dùng API key cá nhân.

## Bảo vệ key và hook

Đã chạy:

```sh
pnpm --filter @nexgraph/desktop exec vitest run test/ai-settings.test.ts test/git-hook.test.ts src/renderer/src/app/screens/SettingsScreen.test.tsx
```

Kết quả: **3 test files, 23 tests passed**. Kiểm cả thao tác thay key rỗng, đổi origin, lỗi mã hoá không làm mất cấu hình cũ, hook Python/Node không bị thay bytes/mode và hook shell vẫn cài/gỡ được.

## Tài liệu và MCP

Đính chính báo cáo H0: số liệu engine không chứng minh đã bấm thử cửa sổ Electron. Spec, roadmap, bàn giao, glossary, tài liệu giao diện và nhật ký đã đồng bộ phạm vi H0–H6: chỉ adapter API key, giao diện tiếng Việt, chat giữ state khi ẩn nhưng không lưu ra đĩa.

Đã đọc tài liệu chính thức và schema cho bốn client; nguồn và giới hạn nằm trong [install-notes](../install-notes.md#đối-chiếu-nguồn-chính-thức-2026-11-13). OpenCode trên máy là **2.2.7**. Schema hiện vẫn nhận `mcp.<tên>` dạng cũ (deprecated); VS Code `.vscode/mcp.json` là editor-managed, khác schema Copilot native. Không tuyên bố đã kết nối bằng cả bốn client chỉ từ phép đối chiếu này.

## Những điều không được suy ra từ test xanh

- CI mới nhất quan sát được vẫn là run `43363591920`, commit `32f38c6`, kết luận failure. Chưa push bản sửa nên không có CI Windows cho bản sửa này.
- Không có Windows native trong phiên này; chưa chứng minh SmartScreen, NTFS/watcher hoặc bản cài `.exe`.
- Chưa có key/provider thật; kiểm chat dùng máy chủ OpenAI-compatible giả cục bộ, không phải chất lượng mô hình thật.
- Nhãn độ đúng cũ đã bị sửa sau khi thấy kết quả. Giữ nguyên cảnh báo, chưa biến thành nhãn độc lập; chưa khảo sát sinh viên hay chạy thí nghiệm agent tốn token.
- Mục tiêu tầng L là đo và báo cáo, không cam kết đạt. Số cũ: refresh Hermes khoảng 4,7 s, RSS cả cây khoảng 4,8 GB; các bản sửa lỗi không tự chứng minh đạt < 2 s/< 2 GB. Không đổi mục tiêu để gọi là đạt.

## Engine: phạm vi và nội dung đồ thị

Đã chạy `uv run pytest tests/test_indexer.py::test_typescript_typed_receivers_are_scoped_to_their_function tests/test_freshness.py -q`: **11 passed**. Kiểm receiver typed cùng tên ở hai hàm, hoàn nguyên source về HEAD sau index dirty, thay hash nhưng giữ size/mtime, subdir/exclude và tài liệu được index.

Freshness dùng discovery theo tuỳ chọn đã index rồi so hash, không chỉ dùng Git diff. Đo trên CSDL/bản sao Hermes có sẵn `/tmp/eval/hermes-fresh.db` và `/tmp/eval/hermes-copy`: **17.260 tệp, 3,714 s**, `changed_files=0`, `stale=false` (một lần, đang chạy kiểm khác; không phải benchmark cô lập). Đây là chi phí thật của việc phát hiện cả thay đổi giữ nguyên size/mtime; không đưa số này vào thời gian refresh 4,7 s cũ hay gọi là đạt mục tiêu 2 s.

Toàn bộ engine: `uv run pytest tests -q` → **456 passed, 5 warnings**, 29,65 s. Các warning là deprecation TestClient/httpx và đổi cache root của vendor. PyInstaller build thành công; `dist/nexgraph-engine/nexgraph-engine refresh --help` chạy được. Build có cảnh báo hidden import tùy chọn (`aiohttp`, `pycparser`, `scipy.special._cdflib`); chưa xác nhận tính năng Neo4j HTTP từ các cảnh báo này.

Review độc lập phần key/hook: không phát hiện lỗi quan trọng còn lại qua đường preload → IPC → chat/test kết nối và HookCard; đây là review tĩnh, không thay cho kết quả test bên trên.

## Kết quả cuối sau tích hợp

- Engine: `uv run pytest tests -q` → **458 passed**, 5 warning, 30,75 s. Hai regression bổ sung kiểm DI không mất do tham số cùng tên và binding typed không rò sang hàm untyped.
- Desktop: `pnpm --filter @nexgraph/desktop typecheck` → qua cả node/web; `NEXGRAPH_E2E=1 pnpm --filter @nexgraph/desktop test` → **44 tệp, 280 test pass** (4,01 s), gồm engine thật + LLM giả cho opt-in e2e.
- `uv run pyinstaller packaging/nexgraph-engine.spec --noconfirm` và `pnpm --filter @nexgraph/desktop package` → thành công; DMG arm64 tại `apps/desktop/dist/NexGraph-0.1.0-arm64.dmg`. Không ký mã theo cấu hình hiện có.
- `pnpm --filter @nexgraph/desktop smoke:packaged` → **SMOKE OK nodes=2**.

### Quan sát Electron thật

Chạy app dev rồi app đóng gói bằng `file://…/app.asar/out/renderer/index.html`, HOME/userData/engine data riêng trong `/tmp`; chỉ index bản sao dự án có đường dẫn Unicode, không sửa dự án gốc. Bản sao có 272 tệp, 1.207 node, 2.937 cạnh.

- Danh sách Luồng: **50/172 → 100/172** sau bấm Xem thêm; chọn signUp hiển thị 8 bước, bấm Sau chuyển **2/8**, mã nguồn đổi đúng bước.
- Sigma/WebGL chạy trên `file://`, quan sát ảnh canvas thật 272 nút; không chỉ dựa trên jsdom.
- Từ nút `review_flow/test_service.py` trên Bản đồ, mở Kiến trúc: bản đóng gói hiển thị `dir:review_flow`, đủ bốn khối, `test_service.py` được chọn. Kiểm runtime ban đầu phát hiện đích tệp không thể làm parent; đã sửa và thêm regression test trước build cuối.
- Chat: gõ nháp → ẩn → hiện vẫn giữ nháp; lúc ẩn computed style là `display:none`. Provider thử local port 19351, hộp đồng ý thật, vòng tool thật gọi 2 công cụ và hiển thị **3/4 trích dẫn đã xác minh**. Không dùng key hay dịch vụ AI thật. Huỷ khi unmount và giữ lượt đang chạy lúc ẩn được kiểm bằng regression tự động; không giả nhận đã đo mạng huỷ trên provider thật.
- Ảnh quan sát tạm: `/tmp/ng-review-flows.png`, `/tmp/ng-review-map.png`, `/tmp/ng-review-packaged-architecture.png`; không đưa ảnh tạm vào source.

Đây là bằng chứng sửa lỗi, không thay thế nghiệm thu Windows, CI mới, đo hiệu năng cô lập, nhãn chất lượng độc lập hay khảo sát người dùng. Freshness tầng L có chi phí hash 3,714 s đã nêu; chưa đạt mục tiêu 2 s. DMG chưa ký/notarize.

## Rà soát lần hai (cùng ngày, phiên khác)

Chạy lại toàn bộ rồi bấm thử bản build trên cửa sổ Electron thật (điều khiển qua CDP, dữ liệu app riêng, bản sao NestJS 268 tệp có `git init`).

- **`freshness` băm mọi tệp mỗi lần gọi `/stats`** (3,7 s trên 17.260 tệp, mỗi lần mở Tổng quan hoặc gọi `graph_stats`), và nghiêm hơn `refresh_project`: tệp đổi nội dung nhưng giữ size/mtime bị báo "cũ" trong khi refresh bỏ qua, nên cũ mãi. Nay dùng đúng điều kiện bỏ qua của refresh (size + mtime khớp và mtime cách hiện tại ≥ 2 s). Đo lại trên cùng CSDL: **0,72–0,88 s**. Test cũ "băm cả khi stat không đổi" thay bằng test cửa sổ 2 s kèm kiểm refresh xoá được `stale`.
- **Thẻ Luồng tràn khỏi cửa sổ 1280 px:** lưới `320px 1fr 340px` không co được cột giữa, cột "Các bước" và mã bị cắt bên phải. Nay `260px minmax(0, 1fr) 300px`; thanh phát xuống dòng được; chip loại luồng xuống dòng thay vì bị cắt.
- **Sơ đồ luồng bị cắt nút đầu/cuối:** `AutoFit` chỉ vừa một lần và `minZoom` mặc định 0,5 không đủ; nay vừa lại khi khung đổi cỡ, `minZoom` 0,2.
- **Test chập chờn** `CodeViewer … scrolls it into view` (trượt khi máy bận): chờ effect bằng `waitFor`.
- Lần parse TS thứ ba (`_ts_scoped_types`) đo 0,10 s cho 266 tệp: giữ nguyên.

Đã thấy chạy đúng trên cửa sổ thật: mở dự án → lập chỉ mục 268/268 → Tổng quan (268 tệp · 1.190 node · 2.906 cạnh) → Kiến trúc → Bản đồ sigma (268 nút) → Luồng `signIn` 8 bước, bấm Sau → Graph, Cây, Báo cáo → sửa `string-util.service.ts` bằng tay, panel Thay đổi tự hiện vùng ảnh hưởng và 3 test liên quan → Tham quan 10 bước → chat với LLM giả (hộp đồng ý, 2 công cụ, trích dẫn bịa bị gạch). Không có lỗi console ngoài cảnh báo `ResizeObserver loop`.

Kết quả: engine **458 passed**; desktop typecheck sạch, **44 tệp / 280 test** (`NEXGRAPH_E2E=1`). Chưa build lại PyInstaller/DMG sau các sửa này.

### Sửa nốt phần còn tồn

- Thẻ luồng hiện thêm tên tệp của điểm vào, nên hai `uploadProductImage` (`product-images.controller.ts`, `vendor-product-images.controller.ts`) phân biệt được.
- Panel Thay đổi hiện tên đầy đủ cho hàm/phương thức (`AuthService.signIn`, `AuthController.signIn`).
- Màn lập chỉ mục đổi tiêu đề thành "Đã lập chỉ mục" khi xong.
- Cột chat co theo cửa sổ (307 px ở 1280 px thay vì 360 px).
- `compare` nằm ở "Chưa có test" là **đúng**: `string-util.service.spec.ts` chỉ kiểm `toBeDefined`, không gọi `compare`; tệp spec vào "Test liên quan" qua lớp chứa. Không sửa.
- Cập nhật 1 tệp trên bản sao hermes-agent (17.260 tệp): **5,18 s → 4,21 s** nhờ tính cờ từ khoá bảo mật một lần cho mỗi nút khi chấm điểm luồng (2.000 luồng, tổng điểm không đổi: 1347,606). **Vẫn chưa đạt 2 s.** Phần còn lại: dựng luồng 1,5 s, phân giải tham chiếu 1,2 s (nạp cả 215.000 nút mỗi lần), quét đĩa khoảng 0,7 s, chữ ký đồ thị 0,35 s. Muốn dưới 2 s phải dựng lại luồng cục bộ và lập chỉ mục phân giải theo yêu cầu; chưa làm.

Sau các sửa này: engine 458 passed; desktop typecheck sạch, 44 tệp / 280 test.

## Tối ưu refresh cho dự án lớn

Đo trên bản sao hermes-agent (17.260 tệp, 215.000 nút, 684.000 cạnh, 2.000 luồng lưu / 11.140 ứng viên), macOS arm64, một tiến trình, sửa một tệp bằng cách chèn một hàm vào giữa tệp.

| Khâu | Trước | Sau | Cách làm |
|---|---|---|---|
| Quét đĩa | 0,65 s | 0,28 s | Gộp mọi mẫu của mỗi `.gitignore` thành một regex; không khớp regex gộp thì chắc chắn không bị bỏ qua, có khớp mới hỏi `pathspec` (giữ đúng mẫu phủ định). Danh sách tệp trùng khớp 17.260/17.260. |
| Phân giải tham chiếu | 1,18 s | 0,42 s | Dưới 20.000 tham chiếu chờ thì chỉ nạp nút tệp và các nút mang tên xuất hiện trong tham chiếu, kiểu biến, lớp chứa nút nguồn, thay vì cả 215.000 nút. |
| Luồng | 1,5–2,1 s | 0,01–0,19 s | Cập nhật cục bộ (`update_flows`): chỉ dò lại luồng đi qua nút của tệp đổi hoặc nút vừa đổi trạng thái có/không test, và xét lại đích lời gọi của chúng với tư cách điểm vào. Rơi về dựng lại toàn bộ khi tập bị chạm quá 4.000 nút, hoặc khi bảng đầy 2.000 luồng mà luồng xếp cuối mới tệ hơn luồng xếp cuối cũ. |
| **Tổng một lần refresh** | **4,2–5,2 s** | **1,4–1,75 s** | |

Số "Sau" theo từng tệp (sửa / hoàn nguyên / sửa lại, giây): `batch_runner.py` 1,44 / 1,42 / 1,39; `tools/registry.py` 1,62 / 1,49 / 1,53; `tests/agent/test_credential_pool.py` 1,49 / 1,43 / 1,40; `apps/desktop/src/api/client.ts` 1,62 / 1,48 / 1,51; `agent/credential_pool.py` 3,61 / 1,74 / 1,68; `gateway/session_authority.py` 3,70 / 2,21 / 1,75; `cli.py` 3,30 / 1,61 / 1,47. Ba tệp cuối chậm ở lần đầu vì CSDL thử được dựng bằng mã cũ: trích xuất lại bằng mã hiện tại làm đổi số cạnh giữa các tệp nên phải gom cụm lại (1,7 s). Gom cụm lại vẫn xảy ra mỗi khi một lần sửa thật sự thêm/bớt quan hệ giữa hai tệp.

Kiểm đúng:
- Sau mỗi lần refresh ở trên, bảng luồng (điểm vào, điểm, từng bước, dòng gọi) **trùng khớp** với `rebuild_flows` chạy ngay sau đó.
- Bộ phân giải mới so với cách nạp cả đồ thị: ép 402 tệp phân giải lại, hai tiến trình riêng, **683.985 cạnh trùng khớp**.
- Test mới: sáu lần sửa liên tiếp trên `flow_app` với `MAX_FLOWS` 2000 / 2 / 1 so với lập chỉ mục đầy đủ; hai tình huống bảng đầy (luồng đã lưu tụt xuống dưới ứng viên chưa lưu; ứng viên chưa lưu vượt lên qua hàm được gọi vừa đổi). Đã thử phá từng nhánh của mã và test bắt được.

Còn lại trong 1,4 s: phân giải 0,42 s, chữ ký đồ thị 0,35 s, quét đĩa 0,28 s, đồng bộ `TESTED_BY` 0,23 s, trích xuất 0,11 s. Lệnh `refresh` của git hook chạy tiến trình mới nên cộng thêm thời gian khởi động và khoảng 0,25 s tính id tệp (không có bộ nhớ đệm).

Lỗi tìm thấy khi đo:
- **Gốc dự án là symlink** (ví dụ `/tmp/...` trên macOS): lần trích xuất thứ hai của cùng một tệp trong cùng tiến trình lấy kết quả từ cache của bộ trích xuất với id import theo đường dẫn đã resolve, nên mất import nội bộ và các lời gọi tụt từ mức "tệp đã import" xuống "duy nhất trong dự án" hoặc mất. App không dính vì đường dẫn dự án được resolve lúc mở; `extract_generic` nay tự resolve gốc, có test.
- Test `test_demo_data_flow_over_api` trượt ngẫu nhiên khi hai lần lập chỉ mục vắt qua một giây (`indexed_at` tính theo giây): nay so sánh bỏ trường đó.

Sau các sửa này: engine **465 passed**; desktop 44 tệp / 280 test; kịch bản demo trên NestJS qua engine thật cho cùng kết quả (luồng 8 bước, 10 nút ảnh hưởng, 3 test liên quan).
