import { spawn, type ChildProcess } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { LspCallHierarchyCall, LspCallHierarchyItem, LspCodeAction, LspCompletionItem, LspDiagnostic, LspDocumentSymbol, LspLocation, LspRange, LspSignatureHelp, LspTextEdit, LspWorkspaceEdit, LspWorkspaceSymbol } from '../../shared/api'
import { FsError, resolveInside } from '../fs/project-fs'
import { safeProcessEnv } from '../process-env'
import { LspConnection } from './connection'
import { isLspRange, normalizeDiagnostics, normalizeSignatureHelp, normalizeWorkspaceEdit, projectFile } from './protocol'

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

/** Language server là tiến trình tin cậy nhưng không cần credential của app. */
export const lspEnv = (source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv =>
  safeProcessEnv(source, { ELECTRON_RUN_AS_NODE: '1' })

function launch(kind: ServerKind): ChildProcess {
  const script = kind === 'ts'
    ? join(pkgDir('typescript-language-server'), 'lib', 'cli.mjs')
    : join(pkgDir('pyright'), 'langserver.index.js')
  // Chạy bằng chính Node của Electron, không cần Node cài trên máy.
  return spawn(process.execPath, [script, '--stdio'], {
    env: lspEnv(),
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true
  })
}

type Server = {
  process: ChildProcess
  rpc: LspConnection
  ready: Promise<void>
  versions: Map<string, { version: number; text: string }>
  diagnostics: Map<string, LspDiagnostic[]>
  resolveCodeActions: boolean
  callHierarchy: boolean
}

/** Một phần nội dung hover của LSP (chuỗi, MarkedString hoặc MarkupContent) → Markdown. */
function hoverText(part: unknown): string {
  if (typeof part === 'string') return part
  if (!part || typeof part !== 'object' || !('value' in part) || typeof part.value !== 'string') return ''
  return 'language' in part && typeof part.language === 'string' ? `\`\`\`${part.language}\n${part.value}\n\`\`\`` : part.value
}
/** Đổi item call hierarchy của server sang đường dẫn dự án, giữ `data` để gửi lại server. */
function callHierarchyItem(root: string, value: unknown): LspCallHierarchyItem | null {
  if (!value || typeof value !== 'object') return null
  const item = value as { uri?: unknown; name?: unknown; kind?: unknown; range?: unknown; selectionRange?: unknown; detail?: unknown; data?: unknown }
  const file = projectFile(root, item.uri)
  if (!file || typeof item.name !== 'string' || typeof item.kind !== 'number' || !isLspRange(item.range) || !isLspRange(item.selectionRange)) return null
  return { name: item.name, kind: item.kind, file, range: item.range, selectionRange: item.selectionRange,
    ...(typeof item.detail === 'string' ? { detail: item.detail } : {}), ...('data' in item ? { data: item.data } : {}) }
}

function callHierarchyCalls(root: string, raw: unknown, key: 'from' | 'to'): LspCallHierarchyCall[] {
  if (!Array.isArray(raw)) return []
  const out: LspCallHierarchyCall[] = []
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue
    const call = value as { from?: unknown; to?: unknown; fromRanges?: unknown }
    const from = callHierarchyItem(root, call[key])
    if (!from || !Array.isArray(call.fromRanges)) continue
    out.push({ from, fromRanges: call.fromRanges.filter(isLspRange) })
  }
  return out
}

/** Một language server cho mỗi (gốc dự án, loại server); khởi động khi mở tệp đầu tiên, tắt khi đóng dự án/thoát app. */
export class LspManager {
  private readonly servers = new Map<string, Server>()
  private readonly epochs = new Map<string, number>()
  private readonly versions = new Map<string, number>()
  private readonly closed = new Set<string>()
  onDiagnostics: (root: string, file: string, diagnostics: LspDiagnostic[]) => void = () => {}

  private server(root: string, kind: ServerKind): Server {
    const key = `${root}\0${kind}`
    const existing = this.servers.get(key)
    if (existing && existing.process.exitCode === null) return existing
    const child = launch(kind)
    const rpc = new LspConnection(child.stdout!, child.stdin!)
    child.stdin!.on('error', () => {})
    rpc.onRequest = (method, params) => {
      if (method === 'workspace/applyEdit') return { applied: false, failureReason: 'Thay đổi phải được áp dụng từ editor' }
      if (method !== 'workspace/configuration') return null
      const items = params && typeof params === 'object' && 'items' in params && Array.isArray(params.items) ? params.items : []
      return items.map(() => null)
    }
    const server: Server = { process: child, rpc, versions: new Map(), diagnostics: new Map(), resolveCodeActions: false, callHierarchy: false, ready: Promise.resolve() }
    rpc.onNotification = (method, params) => {
      if (method !== 'textDocument/publishDiagnostics' || this.servers.get(key) !== server) return
      const event = normalizeDiagnostics(root, params)
      if (!event) return
      const uri = pathToFileURL(resolveInside(root, event.file)).href
      const known = server.versions.get(uri)
      if (this.closed.has(`${root}\0${uri}`) || (event.version !== undefined && known && event.version !== known.version)) return
      if (event.diagnostics.length) server.diagnostics.set(event.file, event.diagnostics)
      else server.diagnostics.delete(event.file)
      this.onDiagnostics(root, event.file, event.diagnostics)
    }
    child.once('exit', () => {
      rpc.close('Language server đã dừng')
      if (this.servers.get(key) !== server) return
      this.servers.delete(key)
      for (const file of server.diagnostics.keys()) this.onDiagnostics(root, file, [])
      server.diagnostics.clear()
    })
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
          definition: { linkSupport: false },
          declaration: { linkSupport: false },
          typeDefinition: { linkSupport: false },
          implementation: { linkSupport: false },
          callHierarchy: {},
          rename: { prepareSupport: false },
          formatting: {},
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          signatureHelp: { signatureInformation: { documentationFormat: ['markdown', 'plaintext'], parameterInformation: { labelOffsetSupport: true }, activeParameterSupport: true } },
          codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ['', 'quickfix', 'refactor', 'source'] } }, resolveSupport: { properties: ['edit'] } },
          publishDiagnostics: { versionSupport: true, tagSupport: { valueSet: [1, 2] } }
        },
        workspace: { workspaceFolders: true, workspaceEdit: { documentChanges: true }, symbol: {} }
      },
      initializationOptions: kind === 'ts' ? { tsserver: { path: join(pkgDir('typescript'), 'lib', 'tsserver.js') } } : {}
    }, 60_000).then((result) => {
      const caps = (result as { capabilities?: { codeActionProvider?: { resolveProvider?: boolean } | boolean; callHierarchyProvider?: unknown } } | null)?.capabilities
      const provider = caps?.codeActionProvider
      server.resolveCodeActions = typeof provider === 'object' && provider !== null && provider.resolveProvider === true
      rpc.notify('initialized', {})
      server.callHierarchy = !!caps?.callHierarchyProvider
    })
    this.servers.set(key, server)
    return server
  }

  private async withDoc(root: string, file: string, text: string): Promise<{ server: Server; uri: string } | null> {
    if (typeof file !== 'string') throw new FsError('bad_param', 'Đường dẫn language server không hợp lệ')
    const uri = pathToFileURL(resolveInside(root, file)).href
    const lang = lspLanguageOf(file)
    if (!lang) return null
    const key = `${root}\0${uri}`
    const epoch = this.epochs.get(key) ?? 0
    const server = this.server(root, lang.server)
    await server.ready
    if ((this.epochs.get(key) ?? 0) !== epoch) return null
    this.closed.delete(key)
    const known = server.versions.get(uri)
    if (!known) {
      const version = (this.versions.get(key) ?? 0) + 1
      this.versions.set(key, version)
      server.versions.set(uri, { version, text })
      server.rpc.notify('textDocument/didOpen', { textDocument: { uri, languageId: lang.id, version, text } })
    } else if (known.text !== text) {
      const next = { version: known.version + 1, text }
      this.versions.set(key, next.version)
      server.versions.set(uri, next)
      server.rpc.notify('textDocument/didChange', { textDocument: { uri, version: next.version }, contentChanges: [{ text }] })
    }
    return { server, uri }
  }

  /** Vị trí 0-based theo LSP; trả về đường dẫn tương đối, bỏ đích ngoài dự án (thư viện chuẩn, node_modules ngoài gốc). */
  private async locations(method: string, root: string, file: string, text: string, line: number, character: number): Promise<LspLocation[]> {
    const doc = await this.withDoc(root, file, text)
    if (!doc) return []
    const raw = await doc.server.rpc.request<unknown>(method, {
      textDocument: { uri: doc.uri }, position: { line, character },
      ...(method === 'textDocument/references' ? { context: { includeDeclaration: true } } : {})
    })
    const list: unknown[] = Array.isArray(raw) ? raw : raw ? [raw] : []
    const out: LspLocation[] = []
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const location = item as { uri?: unknown; range?: unknown; targetUri?: unknown; targetSelectionRange?: unknown }
      const path = projectFile(root, location.uri ?? location.targetUri)
      const range = location.range ?? location.targetSelectionRange
      if (!path || !isLspRange(range)) continue
      out.push({ file: path, line: range.start.line + 1, column: range.start.character + 1 })
    }
    return out
  }

  async definition(root: string, file: string, text: string, line: number, character: number): Promise<LspLocation[]> {
    return this.locations('textDocument/definition', root, file, text, line, character)
  }

  async declaration(root: string, file: string, text: string, line: number, character: number): Promise<LspLocation[]> {
    return this.locations('textDocument/declaration', root, file, text, line, character)
  }

  async typeDefinition(root: string, file: string, text: string, line: number, character: number): Promise<LspLocation[]> {
    return this.locations('textDocument/typeDefinition', root, file, text, line, character)
  }

  async references(root: string, file: string, text: string, line: number, character: number): Promise<LspLocation[]> {
    return this.locations('textDocument/references', root, file, text, line, character)
  }

  async implementation(root: string, file: string, text: string, line: number, character: number): Promise<LspLocation[]> {
    return this.locations('textDocument/implementation', root, file, text, line, character)
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

  async rename(root: string, file: string, text: string, line: number, character: number, newName: string): Promise<LspWorkspaceEdit> {
    const doc = await this.withDoc(root, file, text)
    if (!doc) return {}
    const raw = await doc.server.rpc.request<unknown>('textDocument/rename', { textDocument: { uri: doc.uri }, position: { line, character }, newName })
    if (raw === null) return {}
    return normalizeWorkspaceEdit(root, raw, (uri) => {
      const target = projectFile(root, uri)
      return target ? doc.server.versions.get(pathToFileURL(resolveInside(root, target)).href)?.version : undefined
    })
  }

  async format(root: string, file: string, text: string, options: { tabSize: number; insertSpaces: boolean }): Promise<LspTextEdit[]> {
    const doc = await this.withDoc(root, file, text)
    if (!doc) return []
    const raw = await doc.server.rpc.request<unknown>('textDocument/formatting', { textDocument: { uri: doc.uri }, options })
    if (raw === null) return []
    const normalized = normalizeWorkspaceEdit(root, { changes: { [doc.uri]: raw } })
    return normalized[projectFile(root, doc.uri)!] ?? []
  }

  async signatureHelp(root: string, file: string, text: string, line: number, character: number): Promise<LspSignatureHelp | null> {
    const doc = await this.withDoc(root, file, text)
    if (!doc) return null
    const raw = await doc.server.rpc.request<unknown>('textDocument/signatureHelp', { textDocument: { uri: doc.uri }, position: { line, character } })
    return normalizeSignatureHelp(raw)
  }

  async documentSymbols(root: string, file: string, text: string): Promise<LspDocumentSymbol[]> {
    const doc = await this.withDoc(root, file, text)
    if (!doc) return []
    const raw = await doc.server.rpc.request<unknown>('textDocument/documentSymbol', { textDocument: { uri: doc.uri } })
    if (!Array.isArray(raw)) return []
    const convert = (value: unknown): LspDocumentSymbol | null => {
      if (!value || typeof value !== 'object') return null
      const item = value as { name?: unknown; kind?: unknown; range?: unknown; selectionRange?: unknown; children?: unknown; location?: { uri?: unknown; range?: unknown } }
      const range = item.range ?? item.location?.range
      const selectionRange = item.selectionRange ?? range
      if (typeof item.name !== 'string' || typeof item.kind !== 'number' || !isLspRange(range) || !isLspRange(selectionRange) ||
        (item.location && projectFile(root, item.location.uri) !== projectFile(root, doc.uri))) return null
      const children = Array.isArray(item.children) ? item.children.map(convert).filter((child): child is LspDocumentSymbol => child !== null) : undefined
      return { name: item.name, kind: item.kind, range, selectionRange, ...(children ? { children } : {}) }
    }
    return raw.map(convert).filter((item): item is LspDocumentSymbol => item !== null)
  }

  /** Item do client gửi lại: dựng URI từ đường dẫn dự án nhưng giữ nguyên `data` của server. */
  private callHierarchyParam(root: string, item: LspCallHierarchyItem): { item: Record<string, unknown> } | null {
    if (!item || typeof item !== 'object' || typeof item.file !== 'string' || !isLspRange(item.range) || !isLspRange(item.selectionRange)) return null
    try {
      const { file, ...rest } = item
      return { item: { ...rest, uri: pathToFileURL(resolveInside(root, file)).href } }
    } catch {
      return null
    }
  }

  async callHierarchyPrepare(root: string, file: string, text: string, line: number, character: number): Promise<LspCallHierarchyItem[] | null> {
    if (!Number.isInteger(line) || line < 0 || !Number.isInteger(character) || character < 0) return []
    const doc = await this.withDoc(root, file, text)
    if (!doc || !doc.server.callHierarchy) return []
    const raw = await doc.server.rpc.request<unknown>('textDocument/prepareCallHierarchy', { textDocument: { uri: doc.uri }, position: { line, character } })
    if (raw === null) return null
    if (!Array.isArray(raw)) return []
    return raw.map((value) => callHierarchyItem(root, value)).filter((item): item is LspCallHierarchyItem => item !== null)
  }

  async callHierarchyIncoming(root: string, file: string, text: string, line: number, character: number, item: LspCallHierarchyItem): Promise<LspCallHierarchyCall[]> {
    if (!Number.isInteger(line) || line < 0 || !Number.isInteger(character) || character < 0) return []
    const doc = await this.withDoc(root, file, text)
    if (!doc || !doc.server.callHierarchy) return []
    const param = this.callHierarchyParam(root, item)
    if (!param) return []
    const raw = await doc.server.rpc.request<unknown>('callHierarchy/incomingCalls', param)
    return callHierarchyCalls(root, raw, 'from')
  }

  async callHierarchyOutgoing(root: string, file: string, text: string, line: number, character: number, item: LspCallHierarchyItem): Promise<LspCallHierarchyCall[]> {
    if (!Number.isInteger(line) || line < 0 || !Number.isInteger(character) || character < 0) return []
    const doc = await this.withDoc(root, file, text)
    if (!doc || !doc.server.callHierarchy) return []
    const param = this.callHierarchyParam(root, item)
    if (!param) return []
    const raw = await doc.server.rpc.request<unknown>('callHierarchy/outgoingCalls', param)
    return callHierarchyCalls(root, raw, 'to')
  }

  async workspaceSymbols(root: string, query: string): Promise<LspWorkspaceSymbol[]> {
    const servers = [...this.servers.entries()].filter(([key, server]) => key.startsWith(`${root}\0`) && server.process.exitCode === null)
    const replies = await Promise.allSettled(servers.map(([, server]) =>
      server.ready.then(() => server.rpc.request<unknown>('workspace/symbol', { query }))))
    const result: LspWorkspaceSymbol[] = []
    for (const reply of replies) {
      if (reply.status !== 'fulfilled' || !Array.isArray(reply.value)) continue
      for (const value of reply.value as unknown[]) {
        if (!value || typeof value !== 'object') continue
        const item = value as { name?: unknown; kind?: unknown; location?: { uri?: unknown; range?: unknown }; containerName?: unknown }
        const file = projectFile(root, item.location?.uri)
        if (!file || !isLspRange(item.location?.range) || typeof item.name !== 'string' || typeof item.kind !== 'number') continue
        result.push({ name: item.name, kind: item.kind, file, range: item.location.range,
          ...(typeof item.containerName === 'string' ? { containerName: item.containerName } : {}) })
        if (result.length === 100) return result
      }
    }
    return result
  }

  async codeActions(root: string, file: string, text: string, range: LspRange): Promise<LspCodeAction[]> {
    const doc = await this.withDoc(root, file, text)
    if (!doc) return []
    const safeFile = projectFile(root, doc.uri)!
    const raw = await doc.server.rpc.request<unknown>('textDocument/codeAction', {
      textDocument: { uri: doc.uri }, range, context: { diagnostics: doc.server.diagnostics.get(safeFile) ?? [] }
    })
    if (!Array.isArray(raw)) return []
    const result: LspCodeAction[] = []
    for (const value of raw as unknown[]) {
      if (!value || typeof value !== 'object') continue
      let action = value as { title?: unknown; kind?: unknown; edit?: unknown; command?: unknown; disabled?: unknown; data?: unknown }
      if (typeof action.title !== 'string' || action.disabled || action.command) continue
      if (action.edit === undefined && action.data !== undefined && doc.server.resolveCodeActions) {
        const resolved = await doc.server.rpc.request<unknown>('codeAction/resolve', action)
        if (!resolved || typeof resolved !== 'object') continue
        action = resolved as typeof action
      }
      if (typeof action.title !== 'string' || action.disabled || action.command || action.edit === undefined) continue
      const edit = normalizeWorkspaceEdit(root, action.edit, (uri) => {
        const target = projectFile(root, uri)
        return target ? doc.server.versions.get(pathToFileURL(resolveInside(root, target)).href)?.version : undefined
      })
      if (!Object.values(edit).some((edits) => edits.length)) continue
      result.push({ title: action.title, ...(typeof action.kind === 'string' ? { kind: action.kind } : {}), edit })
    }
    return result
  }

  /** Mở tài liệu ngay khi editor nạp tệp để server kịp dựng dự án trước lần F12/gợi ý đầu tiên (như Wu mở buffer). */
  async open(root: string, file: string, text: string): Promise<void> {
    await this.withDoc(root, file, text)
  }

  close(root: string, file: string): void {
    if (typeof file !== 'string') throw new FsError('bad_param', 'Đường dẫn language server không hợp lệ')
    const uri = pathToFileURL(resolveInside(root, file)).href
    const lang = lspLanguageOf(file)
    if (!lang) return
    const key = `${root}\0${uri}`
    this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1)
    this.closed.add(key)
    const server = this.servers.get(`${root}\0${lang.server}`)
    if (!server?.versions.delete(uri)) return
    const safeFile = projectFile(root, uri)
    if (safeFile) {
      server.diagnostics.delete(safeFile)
      this.onDiagnostics(root, safeFile, [])
    }
    server.rpc.notify('textDocument/didClose', { textDocument: { uri } })
  }

  stop(root: string): void {
    for (const [key, server] of this.servers) {
      if (!key.startsWith(`${root}\0`)) continue
      this.servers.delete(key)
      server.rpc.close('Language server đã dừng')
      for (const file of server.diagnostics.keys()) this.onDiagnostics(root, file, [])
      server.diagnostics.clear()
      server.process.kill()
    }
    for (const key of this.epochs.keys()) if (key.startsWith(`${root}\0`)) this.epochs.delete(key)
    for (const key of this.versions.keys()) if (key.startsWith(`${root}\0`)) this.versions.delete(key)
    for (const key of this.closed) if (key.startsWith(`${root}\0`)) this.closed.delete(key)
  }

  stopAll(): void {
    const roots = new Set([...this.servers.keys()].map((key) => key.slice(0, key.indexOf('\0'))))
    for (const root of roots) this.stop(root)
  }
}
