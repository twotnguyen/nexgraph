# Corpus của spike Dart

Thư mục `corpus/` bị `.gitignore` bỏ qua. Dựng lại bằng:

```bash
cd spikes/dart-treesitter
mkdir -p corpus && cd corpus
git clone --depth 1 https://github.com/flutter/samples.git flutter-samples
git -C flutter-samples fetch --depth 1 origin 21c71902bb2c7da3cce328ba5946cba2f35a660a   # nếu HEAD đã đổi
git -C flutter-samples checkout 21c71902bb2c7da3cce328ba5946cba2f35a660a
```

| Thư mục | Nguồn | Commit | Ghi chú |
|---|---|---|---|
| `flutter-samples/` | https://github.com/flutter/samples | `21c71902bb2c7da3cce328ba5946cba2f35a660a` (2026-10-20) | 484 tệp `.dart` (50 MB), có 103 tệp trong `test/`; nhiều app mẫu (compass_app dùng Dart 3 pattern, GoRouter, freezed) |
| `flutter-music-app/` | project cá nhân của nhóm (`~/Documents/CODE/FLUTTER_VSCODE/FLUTTER_MUSIC_APP/flutter_music_app`) | không có Git trong bản chép | 98 tệp `.dart`, dùng GoRouter + Riverpod; đã bỏ `build/`, `.dart_tool/`, thư mục nền tảng |

Bộ lọc giống engine: bỏ `*.g.dart`, `*.freezed.dart`, `*.gr.dart`, `*.config.dart`, `*.mocks.dart` (64 tệp) và thư mục `build/`, `.dart_tool/`, `ephemeral/`. Còn **518 tệp**, 5,26 MB.

Chưa có project môn mobile của lớp (nhóm đang xin). Khi có, chạy lại `spike.py` trên đó và bổ sung dòng ở bảng trên.
