// NG-UI-1: nối lớp phục vụ (`pages.ts`) vào Electron — scheme riêng, partition riêng,
// allowlist mạng, chặn điều hướng/popup/quyền của khung nhúng.
import * as electron from 'electron'
import type { WebContents } from 'electron'
import { fileURLToPath } from 'node:url'
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

/** Trang nhúng chỉ được điều hướng trong `nxpage://` của CHÍNH dự án đã gắn lúc attach. */
export function navigationAllowed(url: string, binding: GuestBinding): boolean {
  return projectFromPageUrl(url) === binding.projectId
}

export interface GuestBinding {
  guestId: number
  ownerId: number
  projectId: string
  root: string
}

interface PendingAttach { projectId: string; root: string }
/** Hàng đợi attach theo cửa sổ chủ; web-contents-created lấy ra để gắn cho guest. */
const pendingByOwner = new Map<number, PendingAttach[]>()
const guestBindings = new Map<number, GuestBinding>()

/** Binding của một guest đã gắn (dùng cho cả điều hướng lẫn IPC cầu nối). */
export function guestBinding(guestId: number): GuestBinding | null {
  return guestBindings.get(guestId) ?? null
}

export function forgetGraphPageGuest(guestId: number): void {
  guestBindings.delete(guestId)
}

/**
 * Gắn binding (owner + gốc dự án) cho guest vừa được tạo. Chỉ guest có pending attach
 * (đã qua will-attach-webview) mới có binding; URL đầu tiên phải đúng dự án đã duyệt.
 */
export function bindGraphPageGuest(contents: {
  id: number
  getType(): string
  getURL?(): string
  hostWebContents?: { id: number } | null
}): GuestBinding | null {
  if (contents.getType() !== 'webview') return null
  const owner = contents.hostWebContents
  if (!owner) return null
  const queue = pendingByOwner.get(owner.id)
  if (!queue?.length) return null
  const url = contents.getURL?.() ?? ''
  const index = url ? queue.findIndex((pending) => pending.projectId === projectFromPageUrl(url)) : 0
  if (index < 0) return null
  const [pending] = queue.splice(index, 1)
  if (!queue.length) pendingByOwner.delete(owner.id)
  const binding: GuestBinding = { guestId: contents.id, ownerId: owner.id, ...pending }
  guestBindings.set(contents.id, binding)
  return binding
}

/** Trang nhúng không được điều hướng sang dự án khác/ra ngoài và không mở cửa sổ. */
export function wireGraphPageContents(contents: WebContents, binding: GuestBinding): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event, url) => {
    if (!navigationAllowed(url, binding)) event.preventDefault()
  })
  contents.on('destroyed', () => forgetGraphPageGuest(binding.guestId))
}

/**
 * `will-attach-webview`: chỉ cho khung nhúng của tính năng này gắn vào cửa sổ app.
 * Mọi `<webview>` khác (partition lạ, src lạ, preload lạ, dự án chưa mở) bị chặn; dự án
 * và gốc dự án được ghi vào binding cho guest (owner = cửa sổ gọi).
 */
export function attachGraphPageWebview(
  event: { preventDefault(): void },
  webPreferences: { preload?: string; nodeIntegration?: boolean; contextIsolation?: boolean; sandbox?: boolean },
  params: { partition?: string; src?: string },
  expected: { preloadUrl: string; roots: Map<string, string> },
  owner: { id: number }
): boolean {
  // Electron đưa preload vào webPreferences dạng đường dẫn tuyệt đối (không phải file:// URL).
  const preload = webPreferences.preload
  const preloadOk = preload === expected.preloadUrl || (() => {
    try {
      return preload === fileURLToPath(expected.preloadUrl)
    } catch {
      return false
    }
  })()
  const projectId = params.src ? projectFromPageUrl(params.src) : null
  const root = projectId ? expected.roots.get(projectId) : undefined
  if (params.partition !== PAGES_PARTITION || !projectId || !root || !preloadOk) {
    event.preventDefault()
    return false
  }
  webPreferences.nodeIntegration = false
  webPreferences.contextIsolation = true
  webPreferences.sandbox = true
  const queue = pendingByOwner.get(owner.id) ?? []
  queue.push({ projectId, root })
  pendingByOwner.set(owner.id, queue)
  return true
}
