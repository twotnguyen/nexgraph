// Thay module `electron` cho mã main cũ (apps/desktop/src/main) khi chạy trong extension host.
// Bundler trỏ `electron` vào file này, nên ipc.ts và các module khác dùng lại nguyên vẹn.
import * as vscode from 'vscode'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

type Handler = (event: unknown, ...args: unknown[]) => unknown

/** Bảng kênh do `ipcMain.handle` đăng ký; webview chỉ gọi được kênh có trong bảng. */
export const handlers = new Map<string, Handler>()

/** Trạng thái extension gán lúc activate. `key` null = không mã hoá được, mã cũ sẽ không lưu bí mật. */
export const host = {
  userData: '',
  key: null as Buffer | null,
  send: (_channel: string, _payload: unknown): void => {}
}

export const ipcMain = { handle: (channel: string, fn: Handler): void => void handlers.set(channel, fn) }

export const app = { getPath: (name: string): string => (name === 'downloads' ? join(homedir(), 'Downloads') : host.userData) }

// Khoá chủ nằm trong SecretStorage (Keychain/DPAPI); AES-256-GCM cho API đồng bộ mà mã cũ cần. Bố cục: iv(12) | tag(16) | bản mã.
export const safeStorage = {
  isEncryptionAvailable: (): boolean => host.key !== null,
  encryptString(text: string): Buffer {
    if (!host.key) throw new Error('Chưa có khoá mã hoá')
    const iv = randomBytes(12)
    const c = createCipheriv('aes-256-gcm', host.key, iv)
    const body = Buffer.concat([c.update(text, 'utf8'), c.final()])
    return Buffer.concat([iv, c.getAuthTag(), body])
  },
  decryptString(data: Buffer): string {
    if (!host.key) throw new Error('Chưa có khoá mã hoá')
    const d = createDecipheriv('aes-256-gcm', host.key, data.subarray(0, 12))
    d.setAuthTag(data.subarray(12, 28))
    return Buffer.concat([d.update(data.subarray(28)), d.final()]).toString('utf8')
  }
}

export const shell = {
  openExternal: async (url: string): Promise<void> => void (await vscode.env.openExternal(vscode.Uri.parse(url))),
  showItemInFolder: (path: string): void => void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(path))
}

interface OpenOpts { properties?: string[]; title?: string; defaultPath?: string }
interface SaveOpts { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }
const uri = (p?: string): vscode.Uri | undefined => (p ? vscode.Uri.file(p) : undefined)

// Electron nhận (cửa sổ, tuỳ chọn) hoặc (tuỳ chọn): tuỳ chọn luôn là đối số cuối.
export const dialog = {
  async showOpenDialog(...a: unknown[]): Promise<{ canceled: boolean; filePaths: string[] }> {
    const o = a[a.length - 1] as OpenOpts
    const dir = o.properties?.includes('openDirectory') ?? false
    const r = await vscode.window.showOpenDialog({ canSelectFolders: dir, canSelectFiles: !dir, canSelectMany: false, title: o.title, defaultUri: uri(o.defaultPath) })
    return { canceled: !r?.length, filePaths: (r ?? []).map((u) => u.fsPath) }
  },
  async showSaveDialog(...a: unknown[]): Promise<{ canceled: boolean; filePath?: string }> {
    const o = a[a.length - 1] as SaveOpts
    const filters = Object.fromEntries((o.filters ?? []).map((f) => [f.name, f.extensions]))
    const r = await vscode.window.showSaveDialog({ title: o.title, defaultUri: uri(o.defaultPath), filters })
    return { canceled: !r, filePath: r?.fsPath }
  }
}

/** Đứng thay BrowserWindow: mã cũ chỉ dùng `webContents.send` và `capturePage`. */
export const win = {
  webContents: {
    send: (channel: string, payload: unknown): void => host.send(channel, payload),
    // shortcut: webview không chụp được vùng màn hình như Electron; xuất PNG cần vẽ lại từ canvas trong webview.
    capturePage: async (): Promise<never> => { throw new Error('Bản này chưa hỗ trợ xuất ảnh PNG') }
  }
}
