# Số đo hiện hành cho NFR tầng S/L/XL — 23/11/2026

Tài liệu này chốt **một bộ số** cho các tuyên bố NFR trong repo, thay cho các bảng đo ở những commit khác nhau. Số thô nằm trong [`data/perf-*-2026-11-23.json`](data/) và [`data/accuracy/*-2026-11-23.json`](data/accuracy/); nguồn gốc là đợt A5 (`.bot/lead-run-2026-11-23/reports/A5.md`), đợt PERF-L và re-review #53.

**Máy đo:** Apple M3 Pro, 12 lõi, 18 GB RAM, macOS 15.7.3, Python 3.12.16, Node 26.12.1. **Ngày:** 23/11/2026. **Máy có tải nền** của các đợt khác (load 1 phút 2,6–10,5 khi đo A5); số lập chỉ mục tầng L/XL vì thế kém ổn định hơn các chỉ số truy vấn.

## 1. Bảng NFR theo tầng (SRS §6.1)

| Tầng | Dự án đại diện | Ngưỡng SRS | Số hiện hành | Kết quả |
| --- | --- | --- | --- | --- |
| S (≤ 1.000 tệp) | `ecommerce-backend-nestjs` 280 tệp (commit `d11f4ef`) | index < 60 s, mở lại < 3 s | index **1,34 s**, mở lại **1,0 ms**, refresh 1 tệp 25,7 ms | **Đạt** |
| S | `Bot_Albion_TNC` **125 tệp** (commit `b82be711`) | như trên | index **2,42 s**, mở lại **0,8 ms**, refresh 1 tệp 38,6 ms | **Đạt** |
| S | `tests/fixtures/bookstore_app` 9 tệp | như trên | index **0,01 s**, mở lại **0,7 ms**, refresh 1 tệp 4,8 ms | **Đạt** |
| L (5.000–15.000 tệp) | `repo-reference/open-design` 5.658 tệp (commit `b4ec3109`) | index ≤ 600 s, mở lại < 5 s, refresh 1 tệp < 2 s, RAM cả cây < 2 GB | index **85,2 s** sau #53 (trước #53: 500,5 s), mở lại **40 ms**, refresh 1 tệp **0,50 s**, RAM cả cây **917 MB** | **Đạt 4/4**; mục tiêu nội bộ index ≤ 300 s cũng đạt sau #53 |
| XL (> 15.000 tệp) | `hermes-agent` 17.408 tệp (commit `cc8cc35e60`) | không đặt mục tiêu, chỉ đo | index **146,5 s**, mở lại **148,5 ms**, refresh 1 tệp **1,54 s**, RAM cả cây **1,52 GB** | Đo được; nếu áp ngưỡng L thì đạt cả 4 |

Không có **tầng M**: SRS chỉ định nghĩa S / L / XL. Mọi câu “tầng M đạt” trong tài liệu cũ là sai cách phân tầng, không dùng.

### 1.1 Vì sao index tầng L đổi từ 500,5 s xuống 85,2 s

- Trên `main` `72dc4ec`, watchdog **20 giây cho mỗi lô 16 tệp** (`indexer.py`) bị vượt bởi lô chứa `apps/daemon/src/server.ts` (846 KB, riêng nó ~21 s). Engine **giết cả pool 8 worker** rồi đọc 4.954 tệp còn lại bằng **1 worker** — đó là toàn bộ 500,5 s. Đồ thị ra không khác gì bản chạy song song.
- #53 (`caeb85e`) chỉ đẩy **tệp của lô quá hạn** sang đường từng tệp, hạn chờ theo dung lượng có trần, bỏ bundle `_next/static`/tệp đặc và xếp tệp lớn trước (LPT). Đo lại độc lập ở re-review #53: **85,2 s**, `workers_effective = 8`, `fallback_serial = false`, **5.644 tệp** (bỏ 34 tệp: 20 `.min.js` + 13 `_next/static` + 1 tệp đặc), 45.580 nút / 166.889 cạnh / 408.941 tham chiếu.
- Vì 34 tệp bị bỏ, đồ thị sau #53 **nhỏ hơn** đồ thị `main` (49.790 nút / 203.689 cạnh). Đây là chủ đích (bundle rút gọn tạo node nhiễu), không phải mất dữ liệu dự án. Ghi rõ khi so hai bộ số.
- **500,5 s là số TRƯỚC sửa**; chỉ dùng khi kể lại hồi quy, luôn kèm nhãn “trước #53”.

### 1.2 Albion: 125 tệp, không so với 258

`discover()` từ #36 bỏ thư mục ẩn trừ khi người dùng chọn rõ. Albion mất `.agents`/`.claude` (140 tệp Python + 2 JS) → **125 tệp** thay vì 258. Mọi chỉ số Albion trong bảng cũ (258 tệp) **không cùng phạm vi**; không ghép số mới vào nhãn “258 tệp”. Nếu báo cáo cần 258 tệp thì phải đo lại với `.agents`/`.claude` được chọn rõ.

Hạn chế này cũng là lý do nên ghi trong tài liệu người dùng: index bỏ thư mục ẩn (`.storybook`, `.vitepress`, `.agents`, `.claude`…) theo mặc định — xem [install-notes](../install-notes.md#giới-hạn-đã-biết).

## 2. Độ đúng (DOC-10)

| Loại | NestJS cũ | NestJS 23/11 | Albion cũ | Albion 23/11 |
| --- | --- | --- | --- | --- |
| symbol | 80/0/0 → 1,000 ; 1,000 | y hệt | 117/0/0 → 1,000 ; 1,000 | y hệt |
| call | 44/0/1 → 1,000 ; 0,978 | y hệt | 102/0/11 → 1,000 ; 0,903 | **105/0/8 → 1,000 ; 0,929** |
| import | 69/0/0 → 1,000 ; 1,000 | y hệt | 18/0/2 → 1,000 ; 0,900 | y hệt |
| test (symbol → tệp test) | 4/2/11 → 0,667 ; 0,267 | y hệt | 0/0/10 → n/a ; 0,000 | **3/0/7 → 1,000 ; 0,300** |
| test (tệp nguồn → tệp test) | 4/2/0 → 0,667 ; 1,000 | y hệt | 0/0/3 → n/a ; 0,000 | **3/0/0 → 1,000 ; 1,000** |

Khớp theo cặp (`--ignore-line`): Albion call **104/0/2 → R 0,981**, `test_file` **3/0/0 → R 1,000**; NestJS giữ nguyên. Nguyên nhân cải thiện: resolver `self.x`/`module.Class` và `TESTED_BY` (#34), không phải nới nhãn. Giới hạn giữ nguyên: 12 tệp mẫu/dự án, nhãn một agent, đã sửa sau khi xem kết quả; không kiểm định thống kê.

Số thô: `data/accuracy/score-*-2026-11-23.json`, `score-*-pair-2026-11-23.json`, `details-*-2026-11-23.json`.

## 3. Sáu mâu thuẫn NFR đã chốt

| # | Mâu thuẫn cũ | Cách chốt |
| --- | --- | --- |
| 1 | refresh `hermes-agent` 4.729,3 ms “KHÔNG ĐẠT” vs 1,4–1,75 s “đạt” | Số hiện hành **1,54 s** (tầng XL). 4.729 ms là của commit `5237841`, **trước** tối ưu `353c083`; chỉ nhắc kèm nhãn đó |
| 2 | “Muốn dưới 2 s … **chưa làm**” | Đã làm ở `353c083` (luồng cục bộ); đo 23/11: L **0,50 s**, XL **1,54 s** |
| 3 | `hermes-agent` là tầng L hay XL | Luôn là **XL** (17.408 tệp > 15.000). Không chấm bằng ngưỡng L để kết luận “không đạt”; chỉ ghi “nếu áp ngưỡng L thì đạt” |
| 4 | RAM cả cây `hermes-agent` 4,8 GB vs 1,2 GB | Số hiện hành **1,52 GB** (1.516 MB, đo 23/11). 4,8 GB là trước sửa cache 20/11; 1,2 GB là một lần đo khác — ghi “1,2–1,5 GB tuỳ lần đo”, không trích 1,2 GB như số cố định |
| 5 | “Tầng S/M đạt” | Bỏ chữ **tầng M**. Chỉ tuyên bố S / L / XL |
| 6 | Bảng C giữ 4.729 ms “không đạt” kèm ghi chú “không phải số hiện hành” | Xoá dòng 4.729 ms khỏi bảng chính; nếu cần giữ lịch sử thì để ở mục “trước tối ưu, commit `5237841`” |

Các tệp đã sửa theo cách chốt này: [`2026-12-danh-gia.md`](2026-12-danh-gia.md) (§4.2–§4.4), [`2026-11-tier-l-hermes.md`](2026-11-tier-l-hermes.md) (ghi chú H1), `docs/release/test-plan.md` (bỏ “tầng M”).

## 4. Bảng số chi tiết (trung vị 3 lần; index L/XL 1 lần)

| Chỉ số | NestJS 280 | Albion 125* | bookstore 9 | open-design 5.658 | hermes 17.408 |
| --- | --- | --- | --- | --- | --- |
| Lập chỉ mục lần đầu | 1,34 s | 2,42 s | 0,01 s | 500,5 s → **85,2 s** sau #53 | 146,5 s |
| Mở lại | 1,0 ms | 0,8 ms | 0,7 ms | 40,0 ms | 148,5 ms |
| Cập nhật sau khi sửa 1 tệp | 25,7 ms | 38,6 ms | 4,8 ms | 499 ms | 1.537 ms |
| Dựng luồng | 8,5 ms | 8,1 ms | 0,3 ms | 421 ms | 1.582 ms |
| Bản đồ, detail 400 | 4,3 ms | 1,2 ms | 0,1 ms | 134 ms | 424 ms |
| RAM đỉnh cả cây khi index | — | — | — | 917 MB | 1.516 MB |
| Kích thước `graph.db` | 1,6 MB | 1,3 MB | 0,2 MB | 96,0 MB | 308 MB |
| Tệp / nút / cạnh | 280 / 1.253 / 2.986 | 125 / 925 / 1.737 | 9 / 35 / 53 | 5.658 / 49.790 / 203.689 (sau #53: 5.644 / 45.580 / 166.889) | 17.408 / 216.370 / 706.092 |

\* Albion 125 tệp là phạm vi mới (bỏ thư mục ẩn) — xem §1.2.

## 5. Cách đo và tái lập

```bash
# bản sao tại commit ghim (không có .git)
git -C <repo dự án> archive <sha> | tar -x -C <thư mục>

# hiệu năng (cùng script đã sinh data/perf-*.json)
cd engine
env -u PYTHONPATH uv run --locked python scripts/bench_all.py <bản sao> \
    --repeat 3 --index-repeat 3 --out <out>.json      # S
... --repeat 3 --index-repeat 1 ...                    # L / XL

# độ đúng
env -u PYTHONPATH uv run --locked python scripts/eval_score.py <db> \
    docs/benchmarks/data/labels-<dự án>.csv --details <details>.json

# RAM cả cây (mẫu ps 0,5 s)
env -u PYTHONPATH uv run --locked python <workspace>/scripts/engine/ram_index.py <bản sao> <db>
```

Đo lại open-design sau #53 bằng harness của re-review #53 (`measure.py` + `ProcessPoolExecutor` thật), không phải `bench_all.py`; vì thế số 85,2 s ghi kèm `workers_effective`/`fallback_serial` thay vì `index_repeat`. Muốn có số `bench_all` thuần cho tầng L sau #53 thì chạy lại lệnh trên ở `caeb85e` khi máy rảnh.

## 6. Chưa kiểm / giới hạn

- Index L/XL đo dưới tải nền; cần một lần đo trên máy rảnh để chốt.
- Chưa đo lại **refresh** open-design sau #53 (số 0,50 s là trước #53, cùng máy, cùng 5.658 tệp; #53 không đổi đường refresh).
- Cột “công cụ trích xuất gốc” (graphify 0.9.92) không tái lập được với bản vendor 0.9.112 hiện tại.
- Không đo end-to-end trên app Electron; số TTFT/mở tab của bản RC nằm trong [biên bản 2026-11-23](../release/acceptance/2026-11-23-macos.md).
- 15/15 test DAP thật xanh trên `main` (js-debug 1.140.1, debugpy 1.8.22, 36 test/16,5 s); CI không chạy nhóm này vì không đặt `NEXGRAPH_DEBUG_IT`.
