import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LICENSES_FILE, licensesPath, readLicensesText } from '../src/main/license-file'

/**
 * LIC-2: tệp `THIRD_PARTY_LICENSES.md` được electron-builder chép vào Resources
 * (`electron-builder.yml` → `extraResources`). Khi đóng gói phải đọc ở
 * `process.resourcesPath`; khi chạy dev phải đọc ở gốc repo (app path là `apps/desktop`).
 */
describe('đường dẫn và nội dung THIRD_PARTY_LICENSES.md', () => {
  let root = ''
  afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }) })

  it('bản đóng gói đọc từ Resources; bản dev đọc từ gốc repo (không phụ thuộc cwd)', () => {
    expect(LICENSES_FILE).toBe('THIRD_PARTY_LICENSES.md')
    expect(licensesPath({
      isPackaged: true,
      resourcesPath: '/Applications/NexGraph.app/Contents/Resources',
      appPath: '/Applications/NexGraph.app/Contents/Resources/app.asar'
    })).toBe('/Applications/NexGraph.app/Contents/Resources/THIRD_PARTY_LICENSES.md')
    const devAppPath = resolve('/repo/apps/desktop')
    expect(licensesPath({ isPackaged: false, resourcesPath: '/không/dùng', appPath: devAppPath }))
      .toBe(resolve('/repo/THIRD_PARTY_LICENSES.md'))
  })

  it('đọc nguyên văn tệp UTF-8', async () => {
    root = mkdtempSync(join(tmpdir(), 'ng-license-read-'))
    const file = join(root, LICENSES_FILE)
    writeFileSync(file, '# Phần mềm bên thứ ba\n\n## OpenCode\n\nMIT\n', 'utf8')
    await expect(readLicensesText(file)).resolves.toBe('# Phần mềm bên thứ ba\n\n## OpenCode\n\nMIT\n')
  })

  it('tệp thiếu hoặc rỗng là lỗi để màn Giấy phép báo rõ, không hiện trang trắng', async () => {
    root = mkdtempSync(join(tmpdir(), 'ng-license-read-'))
    const empty = join(root, LICENSES_FILE)
    writeFileSync(empty, '   \n', 'utf8')
    await expect(readLicensesText(empty)).rejects.toThrow(/rỗng|empty/i)
    await expect(readLicensesText(join(root, 'khong-co.md'))).rejects.toThrow()
  })
})
