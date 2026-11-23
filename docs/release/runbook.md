# Runbook phát hành NexGraph

Một trang cho người phát hành (hiện là Tình). Quy trình đầy đủ ở `AGENTS.md` của workspace và thiết kế đội bot (cùng workspace, ngoài repo); tệp này chỉ gom các bước không được quên.

## 0. Điều kiện vào

Không tạo tag khi còn bất kỳ điều kiện nào dưới đây chưa đạt:

- **#60 (X1)** đã merge: workflow trên `main` có job `version-check` và job `release` tạo Release với `--prerelease` ngay khi tag có dấu `-`.
- **#61 (V1)** đã merge: version `0.2.0-alpha.1` (`0.2.0a1` phía engine) ở bốn tệp cộng `uv.lock`, cùng tài liệu phát hành.
- Các PR sửa finding nghiệm thu **RC2** (`main` `8118db0`, app 0.1.2) đã merge — tối thiểu các finding Important: HTML luồng gọi mất tên dự án/commit, hộp thoại Xuất thiếu phạm vi "Cộng đồng", ảnh trong dự án không index được trên bản đóng gói, bundle thiếu `THIRD_PARTY_LICENSES.md`.
- CI của **commit merge cuối trên `main`** xanh đủ 7 check: `lint`, `engine (macos-latest)`, `engine (windows-latest)`, `desktop (macos-latest)`, `desktop (windows-latest)`, `package (macos-latest)`, `package (windows-latest)`. Job `release` chỉ chạy khi có tag và sau `version-check` (X1).
- Bản dựng từ `main` cuối đã được nghiệm thu: cài đúng bộ cài, làm checklist trên máy macOS (và Windows nếu có máy), QA duyệt, biên bản trong [acceptance/](acceptance/) ghi Đạt các mục chặn. Biên bản RC1 (`72dc4ec`) và nghiệm thu RC2 (`8118db0`) là bằng chứng của bản ứng viên, **không thay** cho lượt nghiệm thu bộ cài dựng từ tag.
- Ruleset `main-guard` xanh.

## 1. Tăng version ở bốn tệp (cộng `uv.lock`)

Phải khớp nhau; sau #60, job `version-check` (và `package`) gọi `scripts/ci/check-version.mjs` để so tag với **cả bốn nguồn version**; trên workflow cũ chỉ `package` so `tag == version` của `apps/desktop/package.json`:

| Tệp | Trường | Ghi chú |
|---|---|---|
| `package.json` (gốc) | `"version"` | Từ đợt V1 (24/11/2026) đã về cùng số với app; trước đó lệch (0.1.0 so với 0.1.2) |
| `apps/desktop/package.json` | `"version"` | Nguồn cho tên tệp bộ cài và bước kiểm tag; viết theo semver (`0.2.0-alpha.1`) |
| `engine/pyproject.toml` | `version` | `nexgraph-engine`; viết theo PEP 440 (`0.2.0a1`) |
| `engine/src/nexgraph_engine/__init__.py` | `__version__` | Giá trị engine trả ở `/v1/health` và hiện trên thanh trạng thái app; cùng dạng PEP 440 |
| `engine/uv.lock` | `[[package]] name = "nexgraph-engine"` → `version` | Cập nhật bằng `cd engine && uv lock` sau khi sửa pyproject; chỉ đổi dòng version của gói, không nâng phụ thuộc |

Bản alpha dùng semver ở hai `package.json` và PEP 440 ở phía Python: `0.2.0-alpha.1` ↔ `0.2.0a1`. `engine/tests/test_version_consistency.py` so bốn tệp (và `uv.lock`) khớp nhau, nên bump sót sẽ đỏ ngay ở `pytest`.

Kiểm nhanh trước khi commit:

```sh
grep -n '"version"' package.json apps/desktop/package.json
grep -n '^version = ' engine/pyproject.toml
grep -n '__version__' engine/src/nexgraph_engine/__init__.py
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

Chỉ tạo tag khi **mục 0** đã đạt hết. Tag tạo từ `main` đã merge, không bao giờ từ nhánh PR hay commit chưa merge:

```sh
git switch main && git pull --ff-only
git tag v<version>
git push origin v<version>
```

Bản alpha dùng tag đúng chuỗi `v0.2.0-alpha.1` (CI so **tuyệt đối** với `version` trong `apps/desktop/package.json`). Với workflow của #60 (X1, nhánh `ci/release-hardening`):

- Job `version-check` chạy trước và chặn `release` nếu tag không khớp version ở cả bốn nguồn.
- Tag có dấu `-` (`0.2.0-alpha.1`, `-beta.N`, `-rc.N`) thì job `release` gọi `gh release create … --prerelease` **ngay khi tạo Release** — không có khoảng thời gian bản alpha bị xếp là bản thường.
- `gh release edit v<version> --prerelease` chỉ dùng để **khôi phục** khi phát hiện Release bị sai nhãn (ví dụ chạy lại trên workflow cũ), không phải bước thường quy và không thay cho việc kiểm ở mục 4.

Không sửa tag sau khi push; nếu sai, xoá tag trên GitHub rồi làm lại từ commit đúng (không force-push `main`).

## 4. Kiểm Release

CI tạo Release từ tag (`release` job, `needs: [version-check, engine, desktop, package]` sau #60). Job dùng `gh release create … --generate-notes`, kèm `--prerelease` khi tag có dấu `-`, nên body ban đầu là body tự sinh; sau khi job `release` xanh, thay bằng ghi chú đã duyệt:

```sh
gh release edit v<version> --notes-file docs/release/notes-<version>.md
```

Ví dụ `0.2.0-alpha.1` (và bản `0.2.0` cuối) dùng `docs/release/notes-0.2.0.md`. Tệp nháp còn khối "Trạng thái" ở đầu: bỏ khối đó (hoặc dùng bản đã duyệt không có khối) trước khi chạy, rồi kiểm lại body.

Kiểm:

```sh
gh release view v<version> --json tagName,assets \
  --jq '.tagName, (.assets[] | .name + " " + (.size|tostring))'
```

- Đúng **4 asset**: `NexGraph-<version>-macos-arm64.dmg`, `NexGraph-<version>-macos-arm64.build.json`, `NexGraph-<version>-windows-x64.exe`, `NexGraph-<version>-windows-x64.build.json` (v0.1.2 có đúng 4).
- **Bản alpha:** `gh release view v<version> --json isPrerelease` trả `true`. Nếu `false`, dừng phát hành và kiểm lại tag/workflow; `gh release edit … --prerelease` chỉ là khôi phục.
- Body là [ghi chú phát hành](notes-0.2.0.md) đã duyệt, không phải body tự sinh.
- Gắn run id CI của commit merge vào body hoặc phần thảo luận.
- Nếu job `release` chạy lại, nó chỉ upload đè tệp (`--clobber`) và giữ nhãn prerelease, không tạo Release trùng.

## 5. Thông báo

- Nói rõ bộ cài **chưa ký số**: macOS Gatekeeper (Open Anyway, hoặc `xattr -dr com.apple.quarantine`), Windows SmartScreen, và máy bật Application Control/Code Integrity có thể chặn trước khi cài. Dẫn [README](README.md#mở-bộ-cài-chưa-ký-số).
- Nói rõ **chỉ có macOS Apple silicon (arm64) và Windows x64**; không có bản Intel hay Windows ARM (R2).
- Dẫn [ghi chú phát hành](notes-0.2.0.md) và [kế hoạch kiểm thử](test-plan.md) để người dùng biết giới hạn đã biết.

## 6. Sau phát hành

- Cập nhật `docs/project/tong-quan.md` (số bản, kích thước, liên kết Release) — lead giữ.
- Ghi run id CI của commit merge và tag vào `progress.md` của đợt.
- Nếu phát hiện lỗi chặn sau khi phát hành: mở issue, không xoá Release; sửa ở bản vá kế tiếp.
