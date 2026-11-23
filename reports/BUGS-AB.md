# BUGS-AB — hover/widget tràn của Monaco vẽ ngoài khung nhìn

- PR: https://github.com/twotnguyen/nexgraph/pull/42 · nhánh `bot/desktop/fix-ui-bugs`
- Base: `origin/main` (`7fb413e`), nhánh đã hợp nhất main, không force
- Ảnh + bảng đo: `.bot/lead-run-2026-11-23/ui/BUGS-AB/` (`11`–`26` hậu tố `-v3`, `checks.md`)

## Triệu chứng

- Rê chuột lên một token trong editor: hover có nội dung nhưng vẽ ở `y = −381` (ngoài cửa sổ), chỉ
  lần hover ở dòng sát đáy mới "may mắn" nằm trong khung.
- `Ctrl+Space` ở một số vị trí: dropdown 12 item nhưng `rect.y = 791` trong khi viewport cao 772 →
  không thấy gì.
- Hover **lần đầu** sau khi mở tệp lệch nặng hơn các lần sau khi dùng luật CSS cũ.

## Nguyên nhân gốc

1. **Khung chứa widget tràn rơi xuống đáy editor.** `monaco-editor@0.57.0` đổi `.overflow-guard`
   sang `position: relative` và không kèm CSS định vị `.overflowingContentWidgets`. Khung chứa là
   phần tử tĩnh nằm sau guard ⇒ gốc toạ độ của nó ở `y = editorHeight`. Widget tràn dùng toạ độ
   editor-relative ⇒ mọi widget bị cộng chiều cao editor (hover −381, suggest 791).
2. **Hover đo chiều cao sai ở lần render đầu.** Nội dung hover do LSP trả về bất đồng bộ. Monaco
   phồng khung `.monaco-resizable-hover` lên bằng kích thước editor
   (`ContentHoverWidget._removeConstraintsRenderNormally`) trước khi đo, cache chiều cao đó trong
   `Widget._prepareRenderWidget` và đặt `top = anchor − editorHeight`. Khi nội dung vào, khung co
   lại nhưng `top` không được đặt lại (Monaco chỉ đặt lại khi widget đổi vị trí) ⇒ hover lệch đúng
   một chiều cao editor. Đây là lý do luật CSS "kéo khung về đáy" trông đúng với hover: nó vô tình
   bù đúng sai số đó.

## Sửa

- `apps/desktop/src/renderer/src/components/editor/overflowWidgets.ts`
  - `overflowWidgetsHost()` + `mountOverflowWidgets()`: mỗi editor một khung
    `overflowWidgetsDomNode` 0×0 ở `0,0` container (container `static` → `relative`), class
    `monaco-editor`. Toạ độ editor-relative khớp gốc editor ⇒ suggest/parameter hints/rename đúng,
    không đổi containing block của widget nào.
  - `keepOverflowHoverAnchored()`: giữ bất biến `anchor = top + height` bằng `ResizeObserver` —
    khung đổi chiều cao mà `top` không được Monaco ghi lại thì đặt `top = anchor − height`.
- `monaco.ts`: dùng khung cho editor, mirror, diff; gỡ khung + theo dõi khi dispose.
- Xoá `monaco.css` và test đọc chuỗi CSS cũ; thay bằng test hành vi.

Đã đo `fixedOverflowWidgets: true` trước khi chọn: hover ra `position:fixed, top:181px` cho token ở
y≈400 (bị kẹp `TOP_PADDING = 22` vì chiều cao đo sai) ⇒ không bám token. Vì vậy giữ
`overflowWidgetsDomNode` + bù riêng cho hover.

## Bằng chứng (viewport 1280×772, editor 641×580 tại (274,161))

| Lượt | Nhánh | main `7fb413e` |
|---|---|---|
| hover lần 1 — token dòng 3 | y=151, trong viewport | y=−381, ngoài viewport |
| hover lần 2 | y=151 | y=−381 |
| hover mép dưới — dòng 27 | y=671, lật lên | y=139 (cách token 582 px) |
| hover sau cuộn 300 px | y=301 | — |
| suggest dòng 3 | y=221, 12 item | y=221, 12 item |
| suggest dòng cuối | y=459, 12 item, lật lên | — |
| find `⌘F` | y=165 | y=165 |
| chia đôi phải — hover/suggest khung phải | y=91 / y=221 | — |
| `package:dir` — hover lần 1 / suggest | y=151 / y=161 | — |

## Cổng kỹ thuật

`pnpm typecheck` pass · `env -u PYTHONPATH pnpm test` 1588 passed, 22 skipped · `pnpm lint` pass
(ruff + biome 379 files) · CI PR #42 7/7.

## Chưa kiểm

- Parameter hints: không dựng được widget trong phiên (cả trên main) — suy luận từ mã nguồn (cùng
  khung, cùng cơ chế toạ độ với suggest) và suggest đã đo đúng; không có ảnh riêng.
- Rename: `monaco.ts` không import contrib `rename` (thiếu từ trước, ngoài phạm vi PR).
- Windows packaged: dựa CI; lỗi là DOM/CSS nên nền tảng không đổi.
