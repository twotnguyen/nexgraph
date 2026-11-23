# Runbook phát hành NexGraph

Một trang cho người phát hành (hiện là Tình). Quy trình đầy đủ ở `AGENTS.md` của workspace và thiết kế đội bot (cùng workspace, ngoài repo); tệp này chỉ gom các bước không được quên.

## 0. Điều kiện vào

- PR phát hành đã merge vào `main`, ruleset `main-guard` xanh.
- CI của **commit merge** xanh đủ 7 check: `lint`, `engine (macos-latest)`, `engine (windows-latest)`, `desktop (macos-latest)`, `desktop (windows-latest)`, `package (macos-latest)`, `package (windows-latest)`. Job `release` chỉ chạy khi có tag.
- QA đã duyệt và biên bản nghiệm thu của bản ứng viên đã có trong [acceptance/](acceptance/).

## 1. Tăng version ở bốn tệp

Phải khớp nhau; `package` kiểm `tag == version` của `apps/desktop/package.json` (`.github/workflows/ci.yml:104-106`):

| Tệp | Trường | Ghi chú |
|---|---|---|
| `package.json` (gốc) | `"version"` | Hiện đang lệch (0.1.0 so với 0.1.2); lần phát hành tới đưa về cùng số |
| `apps/desktop/package.json` | `"version"` | Nguồn cho tên tệp bộ cài và bước kiểm tag |
| `engine/pyproject.toml` | `version` | `nexgraph-engine` |
| `engine/uv.lock` | `[[package]] name = "nexgraph-engine"` → `version` | Cập nhật bằng `cd engine && uv lock` sau khi sửa pyproject |

Kiểm nhanh trước khi commit:

```sh
grep -n '"version"' package.json apps/desktop/package.json
grep -n '^version' engine/pyproject.toml
grep -A1 'name = "nexgraph-engine"' engine/uv.lock | grep version
```

Commit dạng `chore: phát hành <version>`, mở PR, chờ 7 check, merge.

## 2. Tải artifact và đối chiếu

1. Mở lượt Actions của **commit merge** trên `main`; chỉ dùng lượt 7/7 xanh.
2. Tải hai gói `NexGraph-<version>-macos-arm64` và `NexGraph-<version>-windows-x64`.
3. Mỗi gói có bộ cài và tệp `.build.json`. Đối chiếu `version`, `platform`, `arch`, `filename`, `bytes`, `sha256`, `commit`, `run`.
4. Tính hash tệp thực tế: `shasum -a 256 <tệp>` (macOS) hoặc `Get-FileHash -Algorithm SHA256 -LiteralPath '<tệp>'` (PowerShell). So không phân biệt hoa/thường.
5. Ghi tên tệp, byte, SHA-256, commit, run id vào biên bản.

## 3. Tạo tag (Tình duyệt trước)

```sh
git switch main && git pull --ff-only
git tag v<version>
git push origin v<version>
```

Không tạo tag từ nhánh PR hay commit chưa merge. Không sửa tag sau khi push; nếu sai, xoá tag trên GitHub rồi làm lại từ commit đúng (không force-push `main`).

## 4. Kiểm Release

CI tạo Release từ tag (`release` job, `needs: [engine, desktop, package]`). CI dùng `gh release create … --generate-notes` (`.github/workflows/ci.yml:162`), nên body ban đầu là body tự sinh; sau khi job `release` xanh, thay bằng ghi chú đã duyệt:

```sh
gh release edit v<version> --notes-file docs/release/notes-<version>.md
```

Ví dụ 0.2.0 dùng `docs/release/notes-0.2.0.md`. Tệp nháp còn khối "Trạng thái" ở đầu: bỏ khối đó (hoặc dùng bản đã duyệt không có khối) trước khi chạy, rồi kiểm lại body.

Kiểm:

```sh
gh release view v<version> --json tagName,assets \
  --jq '.tagName, (.assets[] | .name + " " + (.size|tostring))'
```

- Đúng **4 asset**: `NexGraph-<version>-macos-arm64.dmg`, `NexGraph-<version>-macos-arm64.build.json`, `NexGraph-<version>-windows-x64.exe`, `NexGraph-<version>-windows-x64.build.json` (v0.1.2 có đúng 4).
- Body là [ghi chú phát hành](notes-0.2.0.md) đã duyệt, không phải body tự sinh.
- Gắn run id CI của commit merge vào body hoặc phần thảo luận.
- Nếu job `release` chạy lại, nó chỉ upload đè tệp (`--clobber`), không tạo Release trùng.

## 5. Thông báo

- Nói rõ bộ cài **chưa ký số**: macOS Gatekeeper (Open Anyway, hoặc `xattr -dr com.apple.quarantine`), Windows SmartScreen, và máy bật Application Control/Code Integrity có thể chặn trước khi cài. Dẫn [README](README.md#mở-bộ-cài-chưa-ký-số).
- Nói rõ **chỉ có macOS Apple silicon (arm64) và Windows x64**; không có bản Intel hay Windows ARM (R2).
- Dẫn [ghi chú phát hành](notes-0.2.0.md) và [kế hoạch kiểm thử](test-plan.md) để người dùng biết giới hạn đã biết.

## 6. Sau phát hành

- Cập nhật `docs/project/tong-quan.md` (số bản, kích thước, liên kết Release) — lead giữ.
- Ghi run id CI của commit merge và tag vào `progress.md` của đợt.
- Nếu phát hiện lỗi chặn sau khi phát hành: mở issue, không xoá Release; sửa ở bản vá kế tiếp.
