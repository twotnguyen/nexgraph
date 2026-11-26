import { app } from 'electron'
import { licensesPath, readLicensesText } from './license-file'
import { UserError } from './user-error'

/** Đường dẫn tệp giấy phép của phiên app hiện tại (Resources khi đóng gói, gốc repo khi dev). */
export const currentLicensesPath = (): string =>
  licensesPath({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() })

/** Nội dung `THIRD_PARTY_LICENSES.md` cho màn Giấy phép mã nguồn mở (chỉ đọc). */
export async function readCurrentLicenses(): Promise<{ text: string; path: string }> {
  const path = currentLicensesPath()
  try {
    return { text: await readLicensesText(path), path }
  } catch {
    throw new UserError('licenses_missing', 'Không đọc được tệp giấy phép mã nguồn mở đi kèm ứng dụng.')
  }
}
