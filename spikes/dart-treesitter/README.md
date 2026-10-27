# Spike: Tree-sitter Dart

Kết luận nằm ở `docs/spikes/2026-10-dart-treesitter.md`. Thư mục này chứa mã tái lập.

Mỗi package ứng viên chạy trong một venv riêng ghim `tree-sitter>=0.25,<0.26` (đúng ràng buộc của engine, lock hiện là 0.25.2), để không đổi `engine/pyproject.toml`:

```bash
cd spikes/dart-treesitter
uv venv --python 3.12 .venv-dart && uv pip install --python .venv-dart/bin/python "tree-sitter>=0.25,<0.26" tree-sitter-dart==0.1.0
.venv-dart/bin/python spike.py --grammar dart corpus           # 5 câu hỏi trên corpus (xem corpus.md)
.venv-dart/bin/python syntax_probe.py dart                      # 20 cú pháp Dart 3
```

Ứng viên khác: `--grammar language_pack` (`tree-sitter-language-pack==0.13.0`) và `--grammar dart_orchard` (`tree-sitter-dart-orchard==0.7.0`, cần trình biên dịch C vì chỉ có sdist). Kết quả đã chạy lưu ở `results/`.

Windows: dùng `.venv-dart\Scripts\python.exe` thay cho `.venv-dart/bin/python`.
