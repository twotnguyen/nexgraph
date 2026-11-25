import { readFile } from 'node:fs/promises'
import { posix, win32 } from 'node:path'

/** Tệp giấy phép bên thứ ba ở gốc repo; electron-builder chép nguyên vào Resources của bộ cài. */
export const LICENSES_FILE = 'THIRD_PARTY_LICENSES.md'

/**
 * Đường dẫn tệp giấy phép theo cách app đang chạy:
 * - bản đóng gói: `process.resourcesPath` (extraResources trong electron-builder.yml);
 * - bản dev: gốc repo, vì `app.getAppPath()` là `apps/desktop`.
 *
 * `platform` chọn `path` của nền tảng đích (mặc định nền tảng đang chạy, như `scripts/license-files.mjs`)
 * để test dựng được đường dẫn Windows lẫn macOS trên cùng một máy mà không phụ thuộc `join` của máy đó.
 */
export function licensesPath(opts: { isPackaged: boolean; resourcesPath: string; appPath: string; platform?: NodeJS.Platform }): string {
  const path = (opts.platform ?? process.platform) === 'win32' ? win32 : posix
  return opts.isPackaged
    ? path.join(opts.resourcesPath, LICENSES_FILE)
    : path.resolve(opts.appPath, '..', '..', LICENSES_FILE)
}

/** Đọc nguyên văn tệp giấy phép; tệp rỗng coi như thiếu để màn Giấy phép không hiện trang trắng. */
export async function readLicensesText(file: string): Promise<string> {
  const text = await readFile(file, 'utf8')
  if (!text.trim()) throw new Error('Tệp giấy phép rỗng')
  return text
}
