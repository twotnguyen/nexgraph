import { spawn, type ChildProcess } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join, relative, sep } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import type { LspCompletionItem, LspLocation } from '../../shared/api'
import { resolveInside } from '../fs/project-fs'
import { LspConnection } from './connection'

type ServerKind = 'ts' | 'py'
const LANGUAGE: Record<string, { id: string; server: ServerKind }> = {
  '.ts': { id: 'typescript', server: 'ts' }, '.mts': { id: 'typescript', server: 'ts' }, '.cts': { id: 'typescript', server: 'ts' },
  '.tsx': { id: 'typescriptreact', server: 'ts' },
  '.js': { id: 'javascript', server: 'ts' }, '.mjs': { id: 'javascript', server: 'ts' }, '.cjs': { id: 'javascript', server: 'ts' },
  '.jsx': { id: 'javascriptreact', server: 'ts' },
  '.py': { id: 'python', server: 'py' }, '.pyi': { id: 'python', server: 'py' }
}
export const lspLanguageOf = (file: string) => LANGUAGE[extname(file).toLowerCase()]

const localRequire = createRequire(__filename)
// Trong bản đóng gói các server nằm ở app.asar.unpacked (electron-builder asarUnpack): tiến trình con không chạy được tệp trong asar.
const unpacked = (path: string) => path.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
const pkgDir = (name: string) => unpacked(dirname(localRequire.resolve(`${name}/package.json`)))

function launch(kind: ServerKind): ChildProcess {
  const script = kind === 'ts'
    ? join(pkgDir('typescript-language-server'), 'lib', 'cli.mjs')
    : join(pkgDir('pyright'), 'langserver.index.js')
  // Chạy bằng chính Node của Electron, không cần Node cài trên máy.
  return spawn(process.execPath, [script, '--stdio'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true
  })
}

type Server = { process: ChildProcess; rpc: LspConnection; ready: Promise<void>; versions: Map<string, { version: number; text: string }> }
type LspRange = { start: { line: number; character: number }; end: { line: number; character: number } }

/** Một phần nội dung hover của LSP (chuỗi, MarkedString hoặc MarkupContent) → Markdown. */
function hoverText(part: unknown): string {
  if (typeof part === 'string') return part
  if (!part || typeof part !== 'object' || !('value' in part) || typeof part.value !== 'string') return ''
  return 'language' in part && typeof part.language === 'string' ? `\`\`\`${part.language}\n${part.value}\n\`\`\`` : part.value
}

/** Một language server cho mỗi (gốc dự án, loại server); khởi động khi mở tệp đầu tiên, tắt khi đóng dự án/thoát app. */
export class LspManager {
  private readonly servers = new Map<string, Server>()

  private server(root: string, kind: ServerKind): Server {
    const key = `${root}\0${kind}`
    const existing = this.servers.get(key)
    if (existing && existing.process.exitCode === null) return existing
    const child = launch(kind)
    const rpc = new LspConnection(child.stdout!, child.stdin!)
    child.stdin!.on('error', () => {})
    rpc.onRequest = (method, params) => {
      if (method !== 'workspace/configuration') return null
      const items = params && typeof params === 'object' && 'items' in params && Array.isArray(params.items) ? params.items : []
      return items.map(() => null)
    }
    const server: Server = { process: child, rpc, versions: new Map(), ready: Promise.resolve() }
    child.once('exit', () => { rpc.close('Language server đã dừng'); if (this.servers.get(key) === server) this.servers.delete(key) })
    // Cùng dạng đường dẫn thật với uri tài liệu (resolveInside realpath hoá), nếu không tsserver coi tệp nằm ngoài dự án.
    const rootUri = pathToFileURL(realpathSync.native(root)).href
    server.ready = rpc.request('initialize', {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: root.split(sep).pop() }],
      capabilities: {
        textDocument: {
          synchronization: { didSave: false, dynamicRegistration: false },
          completion: { completionItem: { snippetSupport: false, documentationFormat: ['markdown', 'plaintext'] } },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          definition: { linkSupport: false }
        },
        workspace: { workspaceFolders: true }
      },
      initializationOptions: kind === 'ts' ? { tsserver: { path: join(pkgDir('typescript'), 'lib', 'tsserver.js') } } : {}
    }, 60_000).then(() => rpc.notify('initialized', {}))
    this.servers.set(key, server)
    return server
  }

  private async withDoc(root: string, file: string, text: string): Promise<{ server: Server; uri: string } | null> {
    const lang = lspLanguageOf(file)
    if (!lang) return null
    const uri = pathToFileURL(resolveInside(root, file)).href
    const server = this.server(root, lang.server)
    await server.ready
    const known = server.versions.get(uri)
    if (!known) {
      server.versions.set(uri, { version: 1, text })
      server.rpc.notify('textDocument/didOpen', { textDocument: { uri, languageId: lang.id, version: 1, text } })
    } else if (known.text !== text) {
      // Gửi lại khi nội dung đổi: mỗi lần đổi buộc server kiểm lại dự án.
      const next = { version: known.version + 1, text }
      server.versions.set(uri, next)
      server.rpc.notify('textDocument/didChange', { textDocument: { uri, version: next.version }, contentChanges: [{ text }] })
    }
    return { server, uri }
  }

  /** Vị trí 0-based theo LSP; trả về đường dẫn tương đối, bỏ đích ngoài dự án (thư viện chuẩn, node_modules ngoài gốc). */
  async definition(root: string, file: string, text: string, line: number, character: number): Promise<LspLocation[]> {
    const doc = await this.withDoc(root, file, text)
    if (!doc) return []
    const raw = await doc.server.rpc.request<unknown>('textDocument/definition', { textDocument: { uri: doc.uri }, position: { line, character } })
    const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as ({ uri?: string; range?: LspRange; targetUri?: string; targetSelectionRange?: LspRange })[]
    const out: LspLocation[] = []
    for (const item of list) {
      const uri = item.uri ?? item.targetUri
      const range = item.range ?? item.targetSelectionRange
      if (!uri?.startsWith('file:') || !range) continue
      // Server có thể trả đường dẫn thật (macOS: /var → /private/var): so với cả gốc lẫn gốc đã realpath.
      const target = fileURLToPath(uri)
      const rel = [root, realpathSync.native(root)].map((base) => relative(base, target)).find((r) => !r.startsWith('..') && !r.includes(`${sep}..`))
      if (rel === undefined) continue
      out.push({ file: rel.split(sep).join('/'), line: range.start.line + 1, column: range.start.character + 1 })
    }
    return out
  }

  async completion(root: string, file: string, text: string, line: number, character: number): Promise<LspCompletionItem[]> {
    const doc = await this.withDoc(root, file, text)
    if (!doc) return []
    const raw = await doc.server.rpc.request<unknown>('textDocument/completion', { textDocument: { uri: doc.uri }, position: { line, character } })
    const items = (Array.isArray(raw) ? raw : (raw as { items?: unknown[] } | null)?.items ?? []) as {
      label: string; kind?: number; detail?: string; insertText?: string; sortText?: string; filterText?: string; textEdit?: { newText: string }
    }[]
    return items.slice(0, 500).map((item) => ({
      label: item.label, kind: item.kind ?? 1, detail: item.detail, sortText: item.sortText, filterText: item.filterText,
      insertText: item.textEdit?.newText ?? item.insertText ?? item.label
    }))
  }

  async hover(root: string, file: string, text: string, line: number, character: number): Promise<string | null> {
    const doc = await this.withDoc(root, file, text)
    if (!doc) return null
    const raw = await doc.server.rpc.request<{ contents?: unknown } | null>('textDocument/hover', { textDocument: { uri: doc.uri }, position: { line, character } })
    const parts: unknown[] = Array.isArray(raw?.contents) ? raw.contents : raw?.contents ? [raw.contents] : []
    return parts.map(hoverText).filter(Boolean).join('\n\n') || null
  }

  /** Mở tài liệu ngay khi editor nạp tệp để server kịp dựng dự án trước lần F12/gợi ý đầu tiên (như Wu mở buffer). */
  async open(root: string, file: string, text: string): Promise<void> {
    await this.withDoc(root, file, text)
  }

  close(root: string, file: string): void {
    const lang = lspLanguageOf(file)
    if (!lang) return
    const server = this.servers.get(`${root}\0${lang.server}`)
    const uri = pathToFileURL(resolveInside(root, file)).href
    if (!server?.versions.delete(uri)) return
    server.rpc.notify('textDocument/didClose', { textDocument: { uri } })
  }

  stopAll(): void {
    for (const server of this.servers.values()) server.process.kill()
    this.servers.clear()
  }
}
