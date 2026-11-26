// Điểm khởi động của extension NexGraph: thay apps/desktop/src/main/index.ts (vòng đời engine + cửa sổ).
import * as vscode from 'vscode'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { handlers, host, ipcMain, win } from './electron-host'
import { subscribeEvents } from '../../../apps/desktop/src/main/engine/events'
import type { EngineHandle } from '../../../apps/desktop/src/main/engine/launcher'
import { resolveEngineCommand } from '../../../apps/desktop/src/main/engine/resolve-command'
import { EngineSupervisor } from '../../../apps/desktop/src/main/engine/supervisor'
import { isWithin } from '../../../apps/desktop/src/main/fs/project-fs'
import { closeAllAgents, registerIpc, stopAllMcpHttp, stopAllWatchers } from '../../../apps/desktop/src/main/ipc'
import type { HostCommand } from '../../../apps/desktop/src/shared/api'
import { createHostCommandRelay } from './host-command'

const folder = (): string | null => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null

interface NavItem { id: string; label: string; icon: string; command: string; hint?: string }
/** Điều hướng của NexGraph trên thanh bên của nền. `command` là lệnh gửi vào tab (xem NexGraphApi.host.onCommand). */
const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Khung nhìn', items: [
    { id: 'arch', label: 'Kiến trúc', icon: 'type-hierarchy-sub', command: 'view:arch', hint: 'Khối và quan hệ có bằng chứng' },
    { id: 'map', label: 'Bản đồ', icon: 'globe', command: 'view:map', hint: 'Toàn cảnh tệp và thư mục' },
    { id: 'flows', label: 'Luồng', icon: 'git-compare', command: 'view:flows', hint: 'Đường đi từ điểm vào' },
    { id: 'graph', label: 'Graph', icon: 'graph-scatter', command: 'view:graph', hint: 'Lân cận của một nút' },
    { id: 'tree', label: 'Cây', icon: 'list-tree', command: 'view:tree' },
    { id: 'report', label: 'Báo cáo', icon: 'graph-line', command: 'view:report' }
  ] },
  { group: 'Công cụ', items: [
    { id: 'search', label: 'Tìm trong đồ thị', icon: 'search', command: 'panel:search' },
    { id: 'changes', label: 'Thay đổi và vùng ảnh hưởng', icon: 'diff', command: 'panel:changes' },
    { id: 'tour', label: 'Tham quan dự án', icon: 'compass', command: 'panel:tour' },
    { id: 'agent', label: 'Trợ lý AI', icon: 'comment-discussion', command: 'agent' }
  ] },
  { group: 'Dự án', items: [
    { id: 'overview', label: 'Tổng quan và lập chỉ mục', icon: 'home', command: 'overview' },
    { id: 'export', label: 'Xuất đồ thị', icon: 'export', command: 'export' },
    { id: 'settings', label: 'Cài đặt NexGraph', icon: 'gear', command: 'settings' }
  ] }
]
type Nav = (typeof NAV)[number] | NavItem
const navChanged = new vscode.EventEmitter<void>()
const navTree: vscode.TreeDataProvider<Nav> = {
  onDidChangeTreeData: navChanged.event,
  // Chưa mở thư mục thì để trống cho lời chào "Mở thư mục" hiện ra.
  getChildren: (n) => (!n ? (folder() ? NAV : []) : 'items' in n ? n.items : []),
  getTreeItem(n) {
    if ('items' in n) return new vscode.TreeItem(n.group, vscode.TreeItemCollapsibleState.Expanded)
    const item = new vscode.TreeItem(n.label)
    item.iconPath = new vscode.ThemeIcon(n.icon)
    item.description = n.hint
    item.command = { command: `nexgraph.go.${n.id}`, title: n.label }
    return item
  }
}

let panel: vscode.WebviewPanel | undefined
let postPanelCommand: ((command: HostCommand) => void) | undefined
let supervisor: EngineSupervisor | undefined
let stopEvents: (() => void) | null = null
let retry: NodeJS.Timeout | null = null

const attr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** Gọi một kênh đã đăng ký; kênh lạ bị từ chối. Tách riêng để test được không cần webview. */
export async function dispatch(channel: string, args: unknown[]): Promise<unknown> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`Kênh không được hỗ trợ: ${channel}`)
  return fn(null, ...args)
}

// Chuyển sự kiện SSE của engine lên webview; tự mở lại khi engine khởi động lại hoặc luồng đứt.
function followEvents(handle: EngineHandle | null): void {
  stopEvents?.()
  stopEvents = null
  if (retry) clearTimeout(retry)
  if (!handle) return
  stopEvents = subscribeEvents(handle, (e) => host.send('engine:event', e), () => {
    retry = setTimeout(() => followEvents(supervisor?.getHandle() ?? null), 1000)
  })
}

const views = new Set<vscode.Webview>() // mọi webview đang mở: sự kiện từ host phát tới tất cả

/** Gắn một webview vào lớp nối: nạp bundle, nhận lời gọi kênh, nhận sự kiện từ host. */
function attach(ctx: vscode.ExtensionContext, view: vscode.Webview, mode: 'main' | 'agent', initial?: HostCommand): (command: HostCommand) => void {
  const dist = vscode.Uri.joinPath(ctx.extensionUri, 'dist', 'webview')
  view.options = { enableScripts: true, localResourceRoots: [dist] }
  const src = view.cspSource
  const res = (name: string): vscode.Uri => view.asWebviewUri(vscode.Uri.joinPath(dist, name))
  const view0 = initial?.name.startsWith('view:') ? initial.name.slice(5) : ''
  const startup = initial ? attr(JSON.stringify(initial)) : ''
  const commands = createHostCommandRelay((command) => void view.postMessage({ event: 'host:command', payload: command }))
  view.html = `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${src}; style-src ${src} 'unsafe-inline'; font-src ${src} data:; img-src ${src} data: blob:; connect-src ${src}; worker-src ${src} blob:;">
<link rel="stylesheet" href="${res('index.css')}"><style>body{padding:0}</style></head>
<body><div id="root" data-mode="${mode}" data-folder="${attr(folder() ?? '')}" data-view="${attr(view0)}" data-command="${startup}"></div><script type="module" src="${res('index.js')}"></script></body></html>`
  views.add(view)
  view.onDidReceiveMessage(async (m: { id: number; channel: string; args: unknown[] }) => {
    try {
      if (mode === 'main' && m.channel === 'host:ready') {
        commands.ready()
        await view.postMessage({ id: m.id, ok: true, value: null })
        return
      }
      await view.postMessage({ id: m.id, ok: true, value: await dispatch(m.channel, m.args ?? []) })
    } catch (e) {
      await view.postMessage({ id: m.id, ok: false, message: e instanceof Error ? e.message : String(e) })
    }
  })
  return commands.post
}

/** Mở tab với lệnh khởi động hoặc gửi lệnh đến tab đang có. */
function openPanel(ctx: vscode.ExtensionContext, command?: string, arg?: unknown): void {
  const action = command ? { name: command, arg } : undefined
  if (panel) {
    panel.reveal()
    if (action) postPanelCommand?.(action)
    return
  }
  panel = vscode.window.createWebviewPanel('nexgraph', 'NexGraph', vscode.ViewColumn.One, { retainContextWhenHidden: true })
  panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'mark.svg')
  const view = panel.webview
  postPanelCommand = attach(ctx, view, 'main', action)
  panel.onDidDispose(() => {
    panel = undefined
    postPanelCommand = undefined
    views.delete(view)
    stopAllWatchers()
  })
}

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  host.userData = ctx.globalStorageUri.fsPath
  mkdirSync(host.userData, { recursive: true })
  try {
    let key = await ctx.secrets.get('masterKey')
    if (!key) {
      key = randomBytes(32).toString('base64')
      await ctx.secrets.store('masterKey', key)
    }
    host.key = Buffer.from(key, 'base64')
  } catch {
    host.key = null // không có kho bí mật hệ điều hành: không lưu key AI/MCP, giống safeStorage không khả dụng
  }
  host.send = (channel, payload) => views.forEach((v) => void v.postMessage({ event: channel, payload }))

  const dataDir = process.env.NEXGRAPH_DATA_DIR ?? join(host.userData, 'engine-data')
  // Bản đóng gói có engine PyInstaller trong thư mục extension; lúc dev chạy engine từ repo bằng uv.
  const packaged = existsSync(join(ctx.extensionPath, 'engine'))
  const command = () => resolveEngineCommand({ isPackaged: packaged, resourcesPath: ctx.extensionPath, repoRoot: process.env.NEXGRAPH_REPO_ROOT ?? '' })

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left)
  status.command = 'nexgraph.open'
  status.show()
  const sup = (supervisor = new EngineSupervisor(command, dataDir, (s) => {
    status.text = s.state === 'ready' ? '$(type-hierarchy) NexGraph' : s.state === 'error' ? '$(error) NexGraph' : '$(sync~spin) NexGraph'
    status.tooltip = s.state === 'error' ? s.message : undefined
    host.send('engine:status-changed', s)
    followEvents(s.state === 'ready' ? sup.getHandle() : null)
  }))

  registerIpc(() => sup.getHandle(), () => win as never, command, dataDir)
  ipcMain.handle('engine:status', () => sup.getStatus())
  ipcMain.handle('engine:restart', () => sup.restart())
  // Mở tệp trong editor của nền. Chỉ nhận đường dẫn nằm trong thư mục dự án đang mở.
  ipcMain.handle('host:open-file', async (_e, file, line, lineEnd) => {
    const root = folder()
    if (!root || typeof file !== 'string' || !isWithin(root, file)) throw new Error('Tệp nằm ngoài thư mục dự án')
    const from = Math.max(0, Number(line ?? 1) - 1)
    const to = Math.max(from, Number(lineEnd ?? line ?? 1) - 1)
    await vscode.window.showTextDocument(vscode.Uri.file(join(root, file)), { viewColumn: vscode.ViewColumn.Beside, selection: new vscode.Range(from, 0, to, 0) })
  })

  // View Trợ lý AI gửi lệnh (tô đồ thị, mở Cài đặt) sang tab chính.
  ipcMain.handle('host:emit', (_e, name, arg) => openPanel(ctx, String(name), arg))

  ctx.subscriptions.push(
    status,
    // Trợ lý AI ở thanh bên phụ của nền, giữ phiên khi bị ẩn.
    vscode.window.registerWebviewViewProvider('nexgraph.agent', {
      resolveWebviewView(v) {
        attach(ctx, v.webview, 'agent')
        const visibility = v.onDidChangeVisibility(() => {
          void v.webview.postMessage({ event: 'host:command', payload: { name: 'agent:visibility', arg: v.visible } })
        })
        v.onDidDispose(() => {
          visibility.dispose()
          views.delete(v.webview)
        })
      }
    }, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('nexgraph.open', () => openPanel(ctx)),
    // Mỗi lệnh `nexgraph.go.<x>` mở tab rồi chuyển tới đúng thẻ/bảng; cây điều hướng và thanh công cụ của tab đều gọi chúng.
    ...NAV.flatMap((g) => g.items).map((i) => vscode.commands.registerCommand(`nexgraph.go.${i.id}`, () =>
      i.id === 'agent' ? vscode.commands.executeCommand('nexgraph.agent.focus') : openPanel(ctx, i.command))),
    vscode.window.registerTreeDataProvider('nexgraph.home', navTree),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      navChanged.fire()
      host.send('host:command', { name: 'agent:folder', arg: folder() })
    })
  )
  void sup.startEngine()
  // Thanh bên phụ của nền chỉ chứa khung Chat đã tắt; đóng một lần ở lần chạy đầu, sau đó tôn trọng lựa chọn của người dùng.
  if (!ctx.globalState.get('layoutApplied')) {
    void vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar')
    void ctx.globalState.update('layoutApplied', true)
  }
  // Khởi động vào không gian NexGraph: tab đồ thị và điều hướng ở thanh bên. Nền không tự khôi phục view của extension
  // sau khi mở lại app (về Explorer), nên chủ động mở; ai muốn vào thẳng Explorer thì tắt `nexgraph.openOnStartup`.
  if (folder() && vscode.workspace.getConfiguration('nexgraph').get('openOnStartup')) {
    openPanel(ctx)
    void vscode.commands.executeCommand('workbench.view.extension.nexgraph')
  }
}

// Đợi engine và MCP HTTP dừng hẳn để không để lại tiến trình mồ côi.
export async function deactivate(): Promise<void> {
  followEvents(null)
  stopAllWatchers()
  closeAllAgents()
  await Promise.all([supervisor?.stop(), stopAllMcpHttp()])
}
