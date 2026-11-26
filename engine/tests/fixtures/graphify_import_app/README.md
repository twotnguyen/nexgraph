# Fixture cho bộ nạp `graph.json` (NG-IMP-1 → NG-IMP-4)

Dự án nhỏ có **Python + TypeScript + test** (`app.py`, `test_app.py`, `util.ts`, `main.ts`) để kiểm
bộ nạp `graph.json` của vendor Graphify vào `graph.db`.

`graphify_import_snapshots/` giữ nguyên đầu ra của vendor (không chạy trong CI):

| thư mục | nội dung |
|---|---|
| `base/` | `graph.json`, `manifest.json`, `analysis.json`, `util.ts` của trạng thái gốc |
| `updated/` | cùng bộ sau khi thêm `triple()` vào `util.ts` — dùng cho test nạp tăng dần |

## Dựng lại snapshot (trong `engine/`)

```bash
APP=tests/fixtures/graphify_import_app
OUT=tests/fixtures/graphify_import_snapshots
rm -rf "$APP/.nexgraph"

# 1) trạng thái gốc
env -u PYTHONPATH GRAPHIFY_OUT="$PWD/$APP/.nexgraph" GRAPHIFY_BACKEND=none \
  uv run --locked python -m graphify extract "$APP" --code-only
cp "$APP/.nexgraph/graph.json" "$APP/.nexgraph/manifest.json" "$OUT/base/"
cp "$APP/.nexgraph/.graphify_analysis.json" "$OUT/base/analysis.json"
cp "$APP/util.ts" "$OUT/base/util.ts"

# 2) trạng thái sau khi sửa util.ts (bản trong OUT/updated/util.ts)
cp "$APP/util.ts" /tmp/graphify-import-base-util.ts
cp "$OUT/updated/util.ts" "$APP/util.ts"
rm -rf "$APP/.nexgraph"
env -u PYTHONPATH GRAPHIFY_OUT="$PWD/$APP/.nexgraph" GRAPHIFY_BACKEND=none \
  uv run --locked python -m graphify extract "$APP" --code-only
cp "$APP/.nexgraph/graph.json" "$APP/.nexgraph/manifest.json" "$OUT/updated/"
cp "$APP/.nexgraph/.graphify_analysis.json" "$OUT/updated/analysis.json"
cp /tmp/graphify-import-base-util.ts "$APP/util.ts"
rm -rf "$APP/.nexgraph"
```

`GRAPHIFY_OUT` phải nằm trong gốc dự án (`<fixture>/.nexgraph`) để khoá manifest đúng (spike A1 §3.4).
