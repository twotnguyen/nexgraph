import { createRequire } from 'node:module'
import { app, dialog, shell, type BrowserWindow, type MessageBoxOptions } from 'electron'
import type { AppUpdater, ProgressInfo } from 'electron-updater'
import type { MenuLocale } from '../app-menu-labels'
import { updateLabels } from './labels'
import { acceptsPrerelease, pickMacUpdate, type GithubRelease } from './releases'

/**
 * Kiểm tra và cài bản mới từ GitHub Releases.
 *
 * - Windows (bộ cài NSIS): `electron-updater` đọc `latest.yml` của Release, tải bộ cài
 *   trong nền rồi cài đè và mở lại app. Không cần ký số vì cấu hình không khai `publisherName`.
 * - macOS: tự cài đè cần chữ ký Apple Developer, bản cài hiện chỉ ký ad-hoc. Vì vậy chỉ báo có bản
 *   mới và mở liên kết tải DMG; người dùng kéo app vào Applications để thay bản cũ.
 *
 * Hộp thoại là hộp thoại hệ thống của main nên hiện được ở mọi màn hình, không cần renderer.
 */
const REPO = 'twotnguyen/nexgraph'
const STARTUP_DELAY_MS = 10_000
const FETCH_TIMEOUT_MS = 15_000


export interface UpdateEnv {
  platform: NodeJS.Platform
  arch: string
  isPackaged: boolean
  version: string
  env: NodeJS.ProcessEnv
  getWindow: () => BrowserWindow | null
  getLocale: () => MenuLocale
  showMessageBox: (win: BrowserWindow | null, options: MessageBoxOptions) => Promise<number>
  openExternal: (url: string) => Promise<void>
  fetchJson: (url: string) => Promise<unknown>
  loadWindowsUpdater: () => Promise<AppUpdater>
  quit: () => void
}

/** Môi trường thật: Electron, `fetch` của Node, `electron-updater` nạp trễ (chỉ Windows dùng). */
export function electronUpdateEnv(getWindow: () => BrowserWindow | null, getLocale: () => MenuLocale): UpdateEnv {
  // Getter: chỉ đọc `app` khi kiểm cập nhật, không lúc nạp module (test của index.ts mock `app` tối giản).
  return {
    platform: process.platform,
    arch: process.arch,
    get isPackaged() { return app.isPackaged },
    get version() { return app.getVersion() },
    env: process.env,
    getWindow,
    getLocale,
    showMessageBox: async (win, options) => (win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)).response,
    openExternal: (url) => shell.openExternal(url),
    fetchJson: async (url) => {
      const response = await fetch(url, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'NexGraph-updater' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      })
      if (!response.ok) throw new Error(`GitHub API ${response.status}`)
      return response.json()
    },
    loadWindowsUpdater: async () => loadElectronUpdater().autoUpdater,
    quit: () => app.quit()
  }
}

/**
 * Nạp `electron-updater` bằng `require`, không bằng `import()`: gói xuất `autoUpdater` qua getter của
 * CommonJS nên namespace ESM không có tên này (`(await import(...)).autoUpdater` là `undefined`).
 * Nạp trễ để macOS, test và lúc khởi động không tải gói. Main được build thành CJS nên có `__filename`.
 */
export function loadElectronUpdater(): typeof import('electron-updater') {
  return createRequire(__filename)('electron-updater') as typeof import('electron-updater')
}

/**
 * Chỉ bộ cài thật trên Windows/macOS mới kiểm tra. Bỏ qua khi chạy từ mã nguồn, khi smoke/E2E
 * (hai đường này đặt `NEXGRAPH_SMOKE` hoặc `NEXGRAPH_USER_DATA_DIR`) và khi `NEXGRAPH_UPDATE_CHECK=0`,
 * để hộp thoại không chặn kịch bản tự động.
 */
export function updatesEnabled(env: Pick<UpdateEnv, 'platform' | 'isPackaged' | 'env'>): boolean {
  return env.isPackaged
    && (env.platform === 'win32' || env.platform === 'darwin')
    && env.env.NEXGRAPH_UPDATE_CHECK !== '0'
    && !env.env.NEXGRAPH_SMOKE
    && !env.env.NEXGRAPH_USER_DATA_DIR
}

export class Updater {
  private checking = false
  private installOnQuit = false
  private windowsUpdater: AppUpdater | null = null

  constructor(private readonly env: UpdateEnv) {}

  /** Kiểm một lần sau khi mở app; lỗi (mất mạng…) thì im lặng. */
  scheduleStartupCheck(delayMs = STARTUP_DELAY_MS): void {
    if (!updatesEnabled(this.env)) return
    setTimeout(() => { void this.check(false) }, delayMs).unref?.()
  }

  /** `manual`: người dùng chọn mục menu, nên luôn báo kết quả (đã mới nhất, lỗi, không hỗ trợ). */
  async check(manual: boolean): Promise<void> {
    const t = updateLabels[this.env.getLocale()]
    if (!updatesEnabled(this.env)) {
      if (manual) await this.info(t.unsupported, t.unsupportedDetail)
      return
    }
    if (this.checking) return
    this.checking = true
    try {
      if (this.env.platform === 'darwin') await this.checkMac(manual)
      else await this.checkWindows(manual)
    } catch {
      if (manual) await this.info(t.failed, t.failedDetail, 'warning')
    } finally {
      this.checking = false
    }
  }

  /**
   * Gọi ở bước cuối của `before-quit`, sau khi engine, agent và tiến trình con đã dừng: bộ cài mới
   * chỉ chạy khi không còn tiến trình nào giữ tệp trong thư mục cài (Windows khoá tệp đang mở).
   */
  quitOrInstall(): void {
    if (this.installOnQuit && this.windowsUpdater) {
      this.windowsUpdater.quitAndInstall(true, true)
      return
    }
    this.env.quit()
  }

  private async checkWindows(manual: boolean): Promise<void> {
    const t = updateLabels[this.env.getLocale()]
    const updater = await this.loadWindowsUpdater()
    const result = await updater.checkForUpdates()
    if (!result?.isUpdateAvailable) {
      if (manual) await this.info(t.upToDate(this.env.version))
      return
    }
    const next = result.updateInfo.version
    const choice = await this.ask(t.available(next, this.env.version), t.winDetail, [t.update, t.notes, t.later])
    if (choice === 1) return void (await this.env.openExternal(releasePage(next)))
    if (choice !== 0) return

    const win = this.env.getWindow()
    const progress = (info: ProgressInfo) => win?.setProgressBar(Math.max(0, Math.min(1, info.percent / 100)))
    updater.on('download-progress', progress)
    try {
      await updater.downloadUpdate()
    } catch {
      // Người dùng đã bấm Cập nhật nên phải báo lỗi, kể cả khi lượt kiểm do khởi động gây ra.
      await this.info(t.failed, t.failedDetail, 'warning')
      return
    } finally {
      updater.removeListener('download-progress', progress)
      win?.setProgressBar(-1)
    }
    const restart = await this.ask(t.downloaded(next), t.downloadedDetail, [t.restart, t.later])
    if (restart !== 0) return
    this.installOnQuit = true
    // Đi qua đường thoát thường: hỏi tệp chưa lưu, dừng engine, rồi `quitOrInstall` mới chạy bộ cài.
    this.env.quit()
  }

  private async checkMac(manual: boolean): Promise<void> {
    const t = updateLabels[this.env.getLocale()]
    const releases = await this.env.fetchJson(`https://api.github.com/repos/${REPO}/releases?per_page=20`)
    if (!Array.isArray(releases)) throw new Error('GitHub API trả dữ liệu không phải danh sách')
    const update = pickMacUpdate(releases as GithubRelease[], this.env.version, this.env.arch)
    if (!update) {
      if (manual) await this.info(t.upToDate(this.env.version))
      return
    }
    const choice = await this.ask(t.available(update.version, this.env.version), t.macDetail, [t.download, t.notes, t.later])
    if (choice === 0) await this.env.openExternal(update.dmgUrl)
    else if (choice === 1) await this.env.openExternal(update.pageUrl)
  }

  private async loadWindowsUpdater(): Promise<AppUpdater> {
    if (this.windowsUpdater) return this.windowsUpdater
    const updater = await this.env.loadWindowsUpdater()
    updater.autoDownload = false
    // Chọn "Để sau" sau khi tải xong: cài lặng khi người dùng thoát app.
    updater.autoInstallOnAppQuit = true
    updater.allowPrerelease = acceptsPrerelease(this.env.version)
    updater.logger = null
    this.windowsUpdater = updater
    return updater
  }

  private async ask(message: string, detail: string, buttons: string[]): Promise<number> {
    const t = updateLabels[this.env.getLocale()]
    return this.env.showMessageBox(this.env.getWindow(), {
      type: 'info', title: t.title, message, detail, buttons, defaultId: 0, cancelId: buttons.length - 1, noLink: true
    })
  }

  private async info(message: string, detail?: string, type: 'info' | 'warning' = 'info'): Promise<void> {
    const t = updateLabels[this.env.getLocale()]
    await this.env.showMessageBox(this.env.getWindow(), { type, title: t.title, message, detail, buttons: [t.ok], noLink: true })
  }
}

const releasePage = (version: string): string => `https://github.com/${REPO}/releases/tag/v${version}`
