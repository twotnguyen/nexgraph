// NG-UI-1: nối lớp phục vụ (`pages.ts`) vào Electron — scheme riêng, partition riêng,
// allowlist mạng, chặn điều hướng/popup/quyền của khung nhúng.
import * as electron from 'electron'
import type { WebContents } from 'electron'
import { handlePageRequest, handleWebRequest, isAllowedRequest, type PageServeOptions } from './pages'

export const PAGES_SCHEME = 'nxpage'
/** Partition riêng, không lưu đĩa: trang chỉ đọc thư viện cục bộ nên không cần dữ liệu bền. */
export const PAGES_PARTITION = 'nexgraph-pages'

/** Phần của `Session` mà lớp này dùng; khai báo cấu trúc để test được bằng đối tượng giả. */
export interface SessionLike {
  protocol: { handle(scheme: string, handler: (request: Request) => Promise<Response> | Response): void }
  webRequest: { onBeforeRequest(cb: (details: { url: string }, done: (response: { cancel?: boolean }) => void) => void): void }
  setPermissionRequestHandler(cb: (contents: unknown, permission: string, done: (granted: boolean) => void) => void): void
  setPermissionCheckHandler(cb: (contents: unknown, permission: string) => boolean): void
  on(event: 'will-download', cb: (event: { preventDefault(): void }) => void): void
}

/** Gọi MỘT lần trước app.whenReady(): scheme phải privileged mới chạy được SRI/CORS như https. */
export function registerGraphPageScheme(): void {
  // Namespace + `?.`: test main giả lập 'electron' có thể thiếu `protocol`; tiến trình thật luôn có.
  electron.protocol?.registerSchemesAsPrivileged?.([
    { scheme: PAGES_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
  ])
}

export const pageUrl = (projectId: string, file: string): string => `${PAGES_SCHEME}://${projectId}/${encodeURIComponent(file)}`

/** projectId của trang từ URL do chính khung nhúng tải; null nếu không phải scheme của mình. */
export function projectFromPageUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === `${PAGES_SCHEME}:` && parsed.hostname ? parsed.hostname : null
  } catch {
    return null
  }
}

/**
 * Phục vụ `nxpage://` + chặn toàn bộ https/http của partition. Chỉ gắn lên session của
 * partition (không gắn defaultSession: sẽ chặn nhầm devtools/CSP của chính app — spike A3 §3.1).
 */
export function installGraphPagesProtocol(ses: SessionLike, opts: PageServeOptions): void {
  ses.protocol.handle(PAGES_SCHEME, (request) => handlePageRequest(request.url, opts))
  ses.protocol.handle('https', (request) => handleWebRequest(request.url, opts))
  ses.protocol.handle('http', () => new Response('blocked by NexGraph offline policy', { status: 403 }))
  ses.webRequest.onBeforeRequest((details, done) => done(isAllowedRequest(details.url) ? {} : { cancel: true }))
  ses.setPermissionRequestHandler((_contents, _permission, done) => done(false))
  ses.setPermissionCheckHandler(() => false)
  ses.on('will-download', (event) => event.preventDefault())
}

/** Trang nhúng không được điều hướng đi đâu khác và không mở cửa sổ. */
export function wireGraphPageContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event, url) => {
    if (projectFromPageUrl(url) === null) event.preventDefault()
  })
}

/**
 * `will-attach-webview`: chỉ cho khung nhúng của tính năng này gắn vào cửa sổ app.
 * Mọi `<webview>` khác (partition lạ, src lạ, preload lạ) bị chặn.
 */
export function attachGraphPageWebview(
  event: { preventDefault(): void },
  webPreferences: { preload?: string; nodeIntegration?: boolean; contextIsolation?: boolean; sandbox?: boolean },
  params: { partition?: string; src?: string },
  expected: { preloadUrl: string }
): void {
  if (params.partition !== PAGES_PARTITION || !params.src || projectFromPageUrl(params.src) === null ||
    webPreferences.preload !== expected.preloadUrl) {
    event.preventDefault()
    return
  }
  webPreferences.nodeIntegration = false
  webPreferences.contextIsolation = true
  webPreferences.sandbox = true
}
