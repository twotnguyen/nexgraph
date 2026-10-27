# Spike: Tree-sitter Dart với tree-sitter của engine

Ngày: 2026-10-27 · Người làm: P1 (chạy cùng Claude) · Kế hoạch con 1, Task 6 · Mã tái lập: `spikes/dart-treesitter/`

## Quyết định

**Dùng `tree-sitter-dart==0.1.0`** (PyPI, MIT), ghim đúng phiên bản. Giữ nguyên ràng buộc `tree-sitter>=0.25,<0.26` của Graphify, không cần nâng và không cần parse Dart ở tiến trình riêng.

Lý do ngắn gọn: là package duy nhất vừa **có wheel dựng sẵn cho macOS (x86_64 + arm64), Windows (amd64) và Linux**, vừa **0 lỗi cú pháp trên 518 tệp** và **20/20 cú pháp Dart 3** thử nghiệm. Rủi ro lớn nhất của nó là tuổi và người duy trì (xem "Rủi ro" bên dưới).

## Môi trường đo

Apple M3 Pro, 18 GB, macOS (Darwin 24.6), Python 3.12.16, `tree-sitter` 0.25.2 (đúng bản `engine/uv.lock`). Chưa chạy trên Windows. Mỗi ứng viên cài trong một venv riêng ghim `tree-sitter>=0.25,<0.26` để không đổi `engine/pyproject.toml`.

Corpus (`spikes/dart-treesitter/corpus.md`): `flutter/samples` @ `21c71902…` + 1 app cá nhân của nhóm. Sau khi bỏ tệp sinh tự động (`*.g.dart`, `*.freezed.dart`…): **518 tệp, 5,26 MB**, trong đó 80 tệp test.

## Trả lời 5 câu hỏi

### 1. Nạp được grammar Dart với `tree-sitter` 0.25 không?

| Package | Kết quả | ABI | Wheel dựng sẵn | Ghi chú |
|---|---|---|---|---|
| **`tree-sitter-dart` 0.1.0** | **Nạp được** | 15 | macOS x86_64 + arm64, **win_amd64**, Linux; 125–135 KiB | Một bản phát hành duy nhất (2026-06-21), một tác giả (efrenbl) |
| `tree-sitter-language-pack` 0.13.0 | Nạp được | 15 | macOS universal2, win_amd64, Linux; **16–32 MB** | Gói chung nhiều ngôn ngữ, đã bundle sẵn, chạy offline. Cùng dòng với bản mà code-review-graph ghim (`<1`). **Lỗi cú pháp ở câu 2** |
| `tree-sitter-language-pack` 1.22.1 | Nạp được **nhưng tải mạng** | 14 | có | **Bị loại**: lần gọi `get_language("dart")` đầu tiên tải một bundle ~26 MB về `~/Library/Caches/tree-sitter-language-pack/`. App local-first phải chạy offline và không gửi mạng ngầm (spec §6.2) |
| `tree-sitter-dart-orchard` 0.7.0 | Nạp được | 14 | **chỉ có sdist** | Cần trình biên dịch C trên máy build, đặc biệt Windows. AST khác (không có node như `tree-sitter-dart`), nên mã trích xuất không dùng lại được |
| `tree-sitter-languages` 1.10.2 | **Không nạp được** | | | `TypeError` với tree-sitter 0.25 (gói cũ, chỉ cho <0.22) |

Dry-run `uv pip install --dry-run tree-sitter-dart` vào `engine/.venv` giải quyết xong, không xung đột với ràng buộc tree-sitter.

### 2. Tỉ lệ tệp có node `ERROR`

| Grammar | Tệp có ERROR/MISSING | Mẫu gây lỗi |
|---|---|---|
| **`tree-sitter-dart` 0.1.0** | **0/518 (0,00%)** | — |
| `tree-sitter-language-pack` 0.13.0 | 13/518 (2,51%) | 5 mẫu hàng đầu đều là **object pattern có generic của Dart 3** trong `switch`: `case Error<ItineraryConfig>():` (8 lần), `case Ok<ItineraryConfig>():` (6), `case Ok<void>():` (4), `case Error<void>():` (4), `case Ok():` (3). Ví dụ `activities_viewmodel.dart:50`. Thử riêng: cũng không đọc được dot shorthand `Color c = .red;` |
| `tree-sitter-dart-orchard` 0.7.0 | 7/518 (1,35%) | Gọi qua con trỏ trong tệp FFI sinh tự động `pedometer_bindings_generated.dart` (tên `*_generated.dart` chưa nằm trong bộ lọc). Không lỗi ở code viết tay |

Thử riêng 20 cú pháp Dart 3 (`syntax_probe.py`: switch expression, record, destructuring, sealed/base/interface/mixin class, enhanced enum, extension type, if-case, collection if/for/spread, dot shorthand, async*/await for…): `tree-sitter-dart` **20/20**, `dart-orchard` 20/20, `language-pack` 0.13.0 **18/20** (lỗi: object pattern có generic, dot shorthand).

Hệ quả cho language-pack: với 4 lớp bị mất vì lỗi (1098 so với 1102 lớp), trong dự án dùng Result/sealed class (rất phổ biến trong Flutter hiện đại) thì graph sẽ thiếu nút ở đúng những file quan trọng.

### 3. Truy vấn lấy được không? (`tree-sitter-dart`, 518 tệp)

Lấy được, **nhưng bằng duyệt cây, không bằng một truy vấn đơn giản**, vì grammar này **không có node `call_expression`**: lời gọi là chuỗi anh em `identifier` + `selector` + `selector(argument_part)`. Hàm `callee_chain()` trong `spike.py` dựng lại tên người được gọi (`context.go`, `Navigator.push`, `GoRoute`, `Scaffold`).

| Loại | Số lượng | Ví dụ thật (`tệp`, tên, dòng) |
|---|---|---|
| `class_definition` | 1.102 | `app_theme.dart` `AppTheme` 21–108; `main.dart` `MyApp` 39–51 |
| `enum_declaration` | 25 | `collection_item.dart` `CollectionType` 4–8 |
| `extension_declaration` | 5 | `player_utils.dart` `PlayerNavigation` 7–22 |
| `mixin_declaration` | 0 | Cả 18 `mixin` trong corpus nằm ở tệp `*.freezed.dart` (bị lọc). Chứng minh node tồn tại bằng đoạn thử riêng |
| hàm/method (kèm dòng đầu–cuối) | 8.963 | `app_ui_utils.dart` `showSuccess` 9–16 |
| `library_import` / `library_export` / `part_directive` | 2.307 / 25 / 64 | `import 'package:go_router/go_router.dart';` |
| widget tạo trong `build()` (dạng gọi thường) | 3.118 lần, 381 tên | `Text` 358, `Column` 166, `Padding` 158, `Scaffold` 90 |
| `GoRoute(path: …)` | 48 | `router.dart:33` `/login`, `:37` `/register`, `:41` `/forgot-password` |
| `GoRouter(…)` | 7 | `router.dart:28` |
| `context.go` / `context.push` / `context.pushReplacement` | 24 / 23 / 1 | `login_screen.dart:46` `/`; `guest_guard.dart:18` `/login` |
| `Navigator.push` / `Navigator.pop` | 4 / 53 | `lyrics_preview_card.dart:172` |
| `MaterialApp` / `MaterialApp.router` / `CupertinoApp` | 36 / 9 / 3 | `main.dart:44` |
| `MaterialApp(routes: {…})` (named argument) | 4 tệp | `main.dart` |
| `Navigator.pushNamed` | **0** | Corpus không có. Chưa kiểm chứng |

**Chưa đếm:** widget dạng `const Text(...)` là node khác (`const_object_expression`, **2.876 node** trong corpus), nên con số widget ở trên đang **thiếu** chúng. Trích xuất ở kế hoạch con 6 phải xử lý cả hai dạng. Chưa thử `onGenerateRoute` và `routes:` khai báo gián tiếp qua biến.

Kết quả đầy đủ (10 ví dụ mỗi loại): `spikes/dart-treesitter/results/`.

### 4. Tốc độ parse

Mỗi grammar chỉ khác nhau không đáng kể: **~910 tệp/giây, ~9,3 MB/giây** trên một tiến trình (518 tệp / 5,26 MB trong 0,57 s, chỉ tính parse, không tính duyệt cây). Với tầng S (≤1.000 tệp) parse mất khoảng 1 giây, thừa so với mục tiêu index <60 s. Chưa đo duyệt cây + ghi SQLite; chưa đo trên project tầng L.

### 5. Nhận diện tệp test

Có. Theo đường dẫn (`test/`, `integration_test/`, hậu tố `_test.dart`): **80 tệp**. Theo nội dung, tìm được **185 lời gọi** `test(...)` (71) và `testWidgets(...)` (114), cùng 54 `group(...)`, 502 `expect(...)`. Đủ để sinh `is_test` và `TESTED_BY` mức tệp. Liên kết test với đúng hàm được kiểm thử (qua import và lời gọi trong thân test) chưa thử.

## Khuyến nghị cho kế hoạch con 2 và 6

1. Thêm vào `engine/pyproject.toml`: `"tree-sitter-dart==0.1.0"`. Giữ `tree-sitter>=0.25,<0.26`.
2. Đóng gói PyInstaller: `collect_all("tree_sitter_dart")` cùng các `tree_sitter*` khác (kế hoạch con 1 Task 4). Cần thử trên Windows thật.
3. Đưa `syntax_probe.py` vào test của engine (20 cú pháp) để phát hiện hồi quy khi đổi phiên bản grammar.
4. Bộ lọc tệp sinh tự động bổ sung `*_generated.dart` (và có thể `*.pb.dart`, `*.gen.dart`).
5. API router hỗ trợ ở kế hoạch con 6: `GoRouter(routes: [...])`, `GoRoute(path:)`, `MaterialApp(routes: {...})`, `MaterialApp.router`, `context.go/push/pushReplacement`, `Navigator.push/pop`. Thêm `Navigator.pushNamed` và `onGenerateRoute` khi bộ project test của nhóm có dùng (corpus này không có).
6. Trích xuất widget phải duyệt cả `const_object_expression` và dạng gọi thường.

## Cú pháp không hỗ trợ

Với `tree-sitter-dart` 0.1.0: **không phát hiện cú pháp nào** trong 20 mẫu và 518 tệp. Với language-pack 0.13.0 (không chọn): object pattern có generic và dot shorthand.

## Rủi ro và giới hạn của spike

- **`tree-sitter-dart` còn non**: chỉ có một bản phát hành duy nhất (2026-06-21) từ một tác giả cá nhân. Giảm thiểu: ghim `==0.1.0`, ghi lại SHA256 của wheel trong lock file (`uv.lock`), và giữ phương án dự phòng là `tree-sitter-language-pack==0.13.0` (đã nạp được, chịu lỗi 2,5%) hoặc dựng grammar từ sdist. Quyết định lại nếu package ngừng cập nhật trước khi alpha (tuần 7).
- **Số liệu độ chính xác chưa có nhãn tay**: spike chỉ chứng minh grammar *đọc được* và trích xuất *chạy được*, chưa chứng minh trích xuất *đúng*. Precision/recall so với nhãn tay là việc của chương đánh giá (spec §7).
- **Corpus hẹp**: flutter/samples + 1 app cá nhân. Chưa có project môn mobile của lớp. Cần chạy lại khi có.
- **Chưa chạy trên Windows** (wheel `win_amd64` tồn tại trên PyPI nhưng chưa cài thử).
- Phần trích xuất trong `spike.py` chỉ phục vụ đếm, không phải thiết kế của extractor ở kế hoạch con 2.
- Lần thử `tree-sitter-language-pack` 1.22.1 đã tạo thư mục cache `~/Library/Caches/tree-sitter-language-pack/` (26 MB); đã xoá sau khi thử.
