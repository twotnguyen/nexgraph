import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** Tệp giấy phép bên thứ ba ở gốc repo; electron-builder chép nguyên vào Resources của bộ cài. */
export const LICENSES_FILE = 'THIRD_PARTY_LICENSES.md'

/**
 * Đường dẫn tệp giấy phép theo cách app đang chạy:
 * - bản đóng gói: `process.resourcesPath` (extraResources trong electron-builder.yml);
 * - bản dev: gốc repo, vì `app.getAppPath()` là `apps/desktop`.
 */
export function licensesPath(opts: { isPackaged: boolean; resourcesPath: string; appPath: string }): string {
  return opts.isPackaged
    ? join(opts.resourcesPath, LICENSES_FILE)
    : resolve(opts.appPath, '..', '..', LICENSES_FILE)
}

/** Đọc nguyên văn tệp giấy phép; tệp rỗng coi như thiếu để màn Giấy phép không hiện trang trắng. */
export async function readLicensesText(file: string): Promise<string> {
  const text = await readFile(file, 'utf8')
  if (!text.trim()) throw new Error('Tệp giấy phép rỗng')
  return text
}
