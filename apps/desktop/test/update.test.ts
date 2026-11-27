// Cập nhật trong app: chọn bản phát hành (macOS) và luồng hộp thoại cho cả Windows lẫn macOS.
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, dialog: {}, shell: {} }))

import { pickMacUpdate, acceptsPrerelease, type GithubRelease } from '../src/main/app/update/releases'
import { Updater, updatesEnabled, type UpdateEnv } from '../src/main/app/update/updater'

const release = (tag: string, patch: Partial<GithubRelease> = {}): GithubRelease => {
  const version = tag.replace(/^v/, '')
  return {
    tag_name: tag,
    html_url: `https://github.com/twotnguyen/nexgraph/releases/tag/${tag}`,
    draft: false,
    prerelease: version.includes('-'),
    assets: ['arm64', 'x64'].map((arch) => ({
      name: `NexGraph-${version}-macos-${arch}.dmg`,
      browser_download_url: `https://github.com/twotnguyen/nexgraph/releases/download/${tag}/NexGraph-${version}-macos-${arch}.dmg`
    })),
    ...patch
  }
}

describe('pickMacUpdate', () => {
  it('chọn bản mới nhất có DMG đúng kiến trúc', () => {
    const update = pickMacUpdate([release('v0.1.2'), release('v0.2.0'), release('v0.1.9')], '0.1.2', 'arm64')
    expect(update).toEqual({
      version: '0.2.0',
      pageUrl: 'https://github.com/twotnguyen/nexgraph/releases/tag/v0.2.0',
      dmgUrl: 'https://github.com/twotnguyen/nexgraph/releases/download/v0.2.0/NexGraph-0.2.0-macos-arm64.dmg'
    })
  })

  it('không có bản mới hơn thì trả null', () => {
    expect(pickMacUpdate([release('v0.2.0'), release('v0.1.0')], '0.2.0', 'arm64')).toBeNull()
  })

  it('bản thử nhận pre-release mới hơn; bản chính thức bỏ qua pre-release', () => {
    const list = [release('v0.2.0-alpha.2'), release('v0.1.2')]
    expect(pickMacUpdate(list, '0.2.0-alpha.1', 'arm64')?.version).toBe('0.2.0-alpha.2')
    expect(pickMacUpdate(list, '0.1.2', 'arm64')).toBeNull()
    // alpha → bản chính thức cùng số vẫn là bản mới.
    expect(pickMacUpdate([release('v0.2.0')], '0.2.0-alpha.1', 'arm64')?.version).toBe('0.2.0')
  })

  it('bỏ bản nháp, tag không phải semver, thiếu DMG của kiến trúc, và URL không phải github.com', () => {
    const evil = release('v0.3.0', { assets: [{ name: 'NexGraph-0.3.0-macos-arm64.dmg', browser_download_url: 'https://evil.example/x.dmg' }] })
    const list = [release('v0.9.0', { draft: true }), release('nightly'), release('v0.4.0', { assets: [] }), evil, release('v0.2.0')]
    expect(pickMacUpdate(list, '0.1.0', 'arm64')?.version).toBe('0.2.0')
  })

  it('acceptsPrerelease theo phiên bản đang chạy', () => {
    expect(acceptsPrerelease('0.2.0-alpha.1')).toBe(true)
    expect(acceptsPrerelease('0.2.0')).toBe(false)
  })
})

describe('updatesEnabled', () => {
  const base = { platform: 'win32' as NodeJS.Platform, isPackaged: true, env: {} }
  it('chỉ bộ cài thật trên Windows/macOS, không khi smoke/E2E hoặc tắt bằng biến môi trường', () => {
    expect(updatesEnabled(base)).toBe(true)
    expect(updatesEnabled({ ...base, platform: 'darwin' })).toBe(true)
    expect(updatesEnabled({ ...base, platform: 'linux' })).toBe(false)
    expect(updatesEnabled({ ...base, isPackaged: false })).toBe(false)
    expect(updatesEnabled({ ...base, env: { NEXGRAPH_SMOKE: '1' } })).toBe(false)
    expect(updatesEnabled({ ...base, env: { NEXGRAPH_USER_DATA_DIR: '/tmp/x' } })).toBe(false)
    expect(updatesEnabled({ ...base, env: { NEXGRAPH_UPDATE_CHECK: '0' } })).toBe(false)
  })
})

/** electron-updater giả: đủ các hàm Updater dùng. */
class FakeAppUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = false
  allowPrerelease = false
  logger: unknown = console
  next: string | null = null
  downloadFails = false
  checkForUpdates = vi.fn(async () => this.next
    ? { isUpdateAvailable: true, updateInfo: { version: this.next } }
    : { isUpdateAvailable: false, updateInfo: { version: '0.2.0-alpha.1' } })
  downloadUpdate = vi.fn(async () => {
    this.emit('download-progress', { percent: 50 })
    if (this.downloadFails) throw new Error('mất mạng')
    return ['x.exe']
  })
  quitAndInstall = vi.fn()
}

function makeEnv(patch: Partial<UpdateEnv> & { answers?: number[]; releases?: unknown } = {}) {
  const answers = [...(patch.answers ?? [])]
  const boxes: Array<{ message: string; buttons?: string[] }> = []
  const progress: number[] = []
  const fake = new FakeAppUpdater()
  const env: UpdateEnv = {
    platform: 'win32',
    arch: 'arm64',
    isPackaged: true,
    version: '0.2.0-alpha.1',
    env: {},
    getWindow: () => ({ setProgressBar: (value: number) => progress.push(value) }) as never,
    getLocale: () => 'vi',
    showMessageBox: vi.fn(async (_win, options) => {
      boxes.push({ message: options.message, buttons: options.buttons })
      return answers.shift() ?? (options.cancelId ?? 0)
    }),
    openExternal: vi.fn(async () => {}),
    fetchJson: vi.fn(async () => patch.releases ?? []),
    loadWindowsUpdater: vi.fn(async () => fake as never),
    quit: vi.fn(),
    ...patch
  }
  return { env, fake, boxes, progress, updater: new Updater(env) }
}

describe('Updater — Windows', () => {
  it('cấu hình electron-updater: không tự tải, cài khi thoát, nhận pre-release khi đang chạy alpha', async () => {
    const { fake, updater } = makeEnv()
    await updater.check(false)
    expect(fake.autoDownload).toBe(false)
    expect(fake.autoInstallOnAppQuit).toBe(true)
    expect(fake.allowPrerelease).toBe(true)
    expect(fake.logger).toBeNull()
  })

  it('Cập nhật → tải (có tiến độ trên thanh tác vụ) → Khởi động lại → thoát qua đường thường rồi mới cài', async () => {
    const { env, fake, boxes, progress, updater } = makeEnv({ answers: [0, 0] })
    fake.next = '0.2.0-alpha.2'
    await updater.check(false)
    expect(boxes[0].message).toContain('0.2.0-alpha.2')
    expect(boxes[0].buttons).toEqual(['Cập nhật', 'Xem thay đổi', 'Để sau'])
    expect(fake.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(progress).toEqual([0.5, -1])
    expect(boxes[1].buttons).toEqual(['Khởi động lại', 'Để sau'])
    // Chưa cài ngay: app thoát bình thường (hỏi tệp chưa lưu, dừng engine) rồi before-quit gọi quitOrInstall.
    expect(env.quit).toHaveBeenCalledTimes(1)
    expect(fake.quitAndInstall).not.toHaveBeenCalled()
    updater.quitOrInstall()
    expect(fake.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('Để sau sau khi tải xong: không thoát, quitOrInstall thoát thường (electron-updater cài khi thoát)', async () => {
    const { env, fake, updater } = makeEnv({ answers: [0, 1] })
    fake.next = '0.2.0'
    await updater.check(false)
    expect(env.quit).not.toHaveBeenCalled()
    updater.quitOrInstall()
    expect(fake.quitAndInstall).not.toHaveBeenCalled()
    expect(env.quit).toHaveBeenCalledTimes(1)
  })

  it('Để sau ở hộp thoại đầu: không tải', async () => {
    const { fake, updater } = makeEnv({ answers: [2] })
    fake.next = '0.2.0'
    await updater.check(false)
    expect(fake.downloadUpdate).not.toHaveBeenCalled()
  })

  it('Xem thay đổi mở trang Release của đúng tag', async () => {
    const { env, fake, updater } = makeEnv({ answers: [1] })
    fake.next = '0.2.0'
    await updater.check(false)
    expect(env.openExternal).toHaveBeenCalledWith('https://github.com/twotnguyen/nexgraph/releases/tag/v0.2.0')
    expect(fake.downloadUpdate).not.toHaveBeenCalled()
  })

  it('tải lỗi sau khi đã bấm Cập nhật thì báo lỗi, kể cả lượt kiểm lúc khởi động', async () => {
    const { boxes, fake, progress, updater } = makeEnv({ answers: [0] })
    fake.next = '0.2.0'
    fake.downloadFails = true
    await updater.check(false)
    expect(boxes.at(-1)?.message).toBe('Không kiểm tra được bản cập nhật.')
    expect(progress.at(-1)).toBe(-1)
  })

  it('đã mới nhất: lượt khởi động im lặng, lượt từ menu báo', async () => {
    const silent = makeEnv()
    await silent.updater.check(false)
    expect(silent.boxes).toHaveLength(0)
    const manual = makeEnv()
    await manual.updater.check(true)
    expect(manual.boxes[0].message).toBe('Bạn đang dùng bản mới nhất (0.2.0-alpha.1).')
  })

  it('lỗi mạng: lượt khởi động im lặng, lượt từ menu báo', async () => {
    const silent = makeEnv()
    silent.fake.checkForUpdates.mockRejectedValueOnce(new Error('offline'))
    await silent.updater.check(false)
    expect(silent.boxes).toHaveLength(0)
    const manual = makeEnv()
    manual.fake.checkForUpdates.mockRejectedValueOnce(new Error('offline'))
    await manual.updater.check(true)
    expect(manual.boxes[0].message).toBe('Không kiểm tra được bản cập nhật.')
  })

  it('bản chạy từ mã nguồn: không gọi mạng; chọn menu thì báo không hỗ trợ', async () => {
    const { env, boxes, updater } = makeEnv({ isPackaged: false })
    await updater.check(false)
    expect(boxes).toHaveLength(0)
    await updater.check(true)
    expect(boxes[0].message).toBe('Bản đang chạy không tự cập nhật được.')
    expect(env.loadWindowsUpdater).not.toHaveBeenCalled()
  })
})

describe('Updater — macOS', () => {
  it('có bản mới: Tải bản mới mở liên kết DMG đúng kiến trúc, không dùng electron-updater', async () => {
    const { env, boxes, updater } = makeEnv({ platform: 'darwin', answers: [0], releases: [release('v0.2.0-alpha.2')] })
    await updater.check(false)
    expect(boxes[0].buttons).toEqual(['Tải bản mới', 'Xem thay đổi', 'Để sau'])
    expect(env.openExternal).toHaveBeenCalledWith('https://github.com/twotnguyen/nexgraph/releases/download/v0.2.0-alpha.2/NexGraph-0.2.0-alpha.2-macos-arm64.dmg')
    expect(env.loadWindowsUpdater).not.toHaveBeenCalled()
  })

  it('tiếng Anh theo ngôn ngữ menu', async () => {
    const { boxes, updater } = makeEnv({ platform: 'darwin', getLocale: () => 'en', releases: [release('v0.2.0')] })
    await updater.check(false)
    expect(boxes[0].message).toBe('NexGraph 0.2.0 is available. You are using 0.2.0-alpha.1.')
  })

  it('API trả dữ liệu lạ: lượt từ menu báo lỗi', async () => {
    const { boxes, updater } = makeEnv({ platform: 'darwin', releases: { message: 'rate limited' } })
    await updater.check(true)
    expect(boxes[0].message).toBe('Không kiểm tra được bản cập nhật.')
  })
})
