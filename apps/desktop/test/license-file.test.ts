import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

  it('bản đóng gói đọc từ Resources với dấu phân cách của nền tảng đích (macOS và Windows)', () => {
    // Mỗi ca chọn `platform` tường minh nên kết quả không phụ thuộc máy chạy test: bản cũ so chuỗi
    // POSIX cứng với `join` của máy, trên Windows trả `\Applications\…` nên đỏ dù mã đúng (QA #74 B3).
    const mac = licensesPath({
      platform: 'darwin',
      isPackaged: true,
      resourcesPath: '/Applications/NexGraph.app/Contents/Resources',
      appPath: '/Applications/NexGraph.app/Contents/Resources/app.asar'
    })
    expect(mac).toBe('/Applications/NexGraph.app/Contents/Resources/THIRD_PARTY_LICENSES.md')
    expect(mac).not.toContain('\\')

    const win = licensesPath({
      platform: 'win32',
      isPackaged: true,
      resourcesPath: 'C:\\Program Files\\NexGraph\\resources',
      appPath: 'C:\\Program Files\\NexGraph\\resources\\app.asar'
    })
    expect(win).toBe('C:\\Program Files\\NexGraph\\resources\\THIRD_PARTY_LICENSES.md')
    expect(win).not.toContain('/')
  })

  it('bản dev đọc từ gốc repo (appPath là apps/desktop), không phụ thuộc cwd, đúng dấu phân cách', () => {
    expect(licensesPath({ platform: 'darwin', isPackaged: false, resourcesPath: '/không/dùng', appPath: '/repo/apps/desktop' }))
      .toBe('/repo/THIRD_PARTY_LICENSES.md')
    const win = licensesPath({ platform: 'win32', isPackaged: false, resourcesPath: 'C:\\không\\dùng', appPath: 'C:\\repo\\apps\\desktop' })
    expect(win).toBe('C:\\repo\\THIRD_PARTY_LICENSES.md')
    expect(win).not.toContain('/')
  })

  it('không truyền platform thì theo nền tảng đang chạy: đường dẫn khớp path của máy', () => {
    expect(LICENSES_FILE).toBe('THIRD_PARTY_LICENSES.md')
    const resources = join(tmpdir(), 'ng-licenses-host', 'Resources')
    expect(licensesPath({ isPackaged: true, resourcesPath: resources, appPath: join(resources, 'app.asar') }))
      .toBe(join(resources, 'THIRD_PARTY_LICENSES.md'))
    const repo = join(tmpdir(), 'ng-licenses-host', 'repo')
    expect(licensesPath({ isPackaged: false, resourcesPath: join(tmpdir(), 'không-dùng'), appPath: join(repo, 'apps', 'desktop') }))
      .toBe(join(repo, 'THIRD_PARTY_LICENSES.md'))
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
