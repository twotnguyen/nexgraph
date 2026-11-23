// Kiểm tệp giấy phép trong bản đóng gói (P3-8.2). electron-builder chép `extraResources` vào
// Contents/Resources (macOS) hoặc resources/ (Windows, Linux), không vào app.asar.
import { statSync } from 'node:fs'
import { join } from 'node:path'

/** Ba tệp bắt buộc phải có trong bản cài: giấy phép dự án, NOTICE và danh sách phần mềm bên thứ ba. */
export const REQUIRED_LICENSE_FILES = ['THIRD_PARTY_LICENSES.md', 'NOTICE', 'LICENSE']

/** Thư mục tài nguyên của bản đã đóng gói, đúng như electron-builder xếp `extraResources`. */
export function resourcesDir(appDir, platform = process.platform) {
  return platform === 'darwin' ? join(appDir, 'Contents', 'Resources') : join(appDir, 'resources')
}

/** Tên các tệp còn thiếu (hoặc rỗng 0 byte) trong thư mục tài nguyên của bản đóng gói. */
export function missingLicenseFiles(appDir, platform = process.platform) {
  const dir = resourcesDir(appDir, platform)
  return REQUIRED_LICENSE_FILES.filter((name) => {
    try {
      return statSync(join(dir, name)).size === 0
    } catch {
      return true
    }
  })
}

/** Ném lỗi liệt kê đủ tệp thiếu để CI `package` đỏ ngay, thay vì phát hành bản thiếu giấy phép. */
export function assertLicenseFiles(appDir, platform = process.platform) {
  const missing = missingLicenseFiles(appDir, platform)
  if (missing.length > 0) {
    throw new Error(`Bản đóng gói thiếu tệp giấy phép trong ${resourcesDir(appDir, platform)}: ${missing.join(', ')}`)
  }
}
