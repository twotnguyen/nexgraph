// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode, type ReactNode } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GraphNode, Neighborhood } from '@shared/graph-types'
import { emptyChanges, installNexgraph, project } from '../test-utils'
import { buildExcerpts, consumePendingMultiBuffer, requestMultiBuffer } from '../state/multiBuffer'
import { toggleBookmark } from '../state/bookmarks'
import { recordNavigation } from '../state/navigationHistory'
import { NotificationCenter, clearNotifications, notify } from '../components/common/NotificationCenter'
import { WORKBENCH_PANELS, getWorkbenchPanel } from '../state/workbenchPanels'
import { setChatDock } from '../state/layoutPrefs'

vi.mock('../services/elkLayoutService', async () => ({
  layoutDiagram: async (nodes: { id: string }[]) => ({ pos: Object.fromEntries(nodes.map((n, i) => [n.id, { x: i * 220, y: 0 }])), routes: {} })
}))

vi.mock('../components/map/MapView', () => ({
  MapView: ({ onOpenArch }: { onOpenArch?: (blockId: string) => void }) => (
    <button type="button" onClick={() => onOpenArch?.('dir:src')}>Mở kiến trúc từ bản đồ</button>
  )
}))

// jsdom không chạy Monaco: thay bằng <textarea> có giao diện EditorHandle.
const revealLines = vi.hoisted(() => vi.fn())
vi.mock('../components/editor/monaco', () => ({
  languageFor: () => 'dart',
  // Khung chia đôi dùng view thứ hai trên cùng model; jsdom chỉ cần handle đủ hàm.
  createMirror: () => ({ setVim: () => {}, setReadOnly: () => {}, onDisposeModel: () => {}, dispose: () => {} }),
  createEditor: (el: HTMLElement, opts: { value: string }) => {
    const ta = document.createElement('textarea')
    ta.value = opts.value
    ta.setAttribute('aria-label', 'editor')
    el.appendChild(ta)
    return {
      getValue: () => ta.value, setValue: (v: string) => { ta.value = v },
      onChange: (cb: () => void) => ta.addEventListener('input', cb), revealLines, dispose: () => ta.remove(),
      setReadOnly: (value: boolean) => { ta.readOnly = value },
    }
  }
}))

import { WorkspaceScreen } from './WorkspaceScreen'
import { installKeymap, runCommand } from '../state/commands'
import { setLocale, useLocale } from '../state/locale'

/** App thật đăng ký useLocale rồi dựng lại các màn trong render của nó; test màn lẻ dùng render-prop để giống. */
function LocaleHost({ render }: { render: () => ReactNode }) {
  useLocale()
  return <>{render()}</>
}

beforeAll(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  vi.stubGlobal('ResizeObserver', RO)
  vi.stubGlobal('DOMMatrixReadOnly', class { m22 = 1; constructor() {} })
})
// Các test cũ mô tả kiểu 2 (khung chat bên phải, mở sẵn); test kiểu Wu tự xoá khoá này.
beforeEach(() => localStorage.setItem('nexgraph.chat.dock', 'right'))
// App cài bộ phân phối phím; ở đây màn được render riêng nên tự cài.
beforeAll(() => installKeymap())
afterEach(() => { consumePendingMultiBuffer(); setLocale('vi') })

const gnode = (id: string, label = id): GraphNode => ({
  id, kind: 'method', label, qualified_name: id, language: 'dart', file: 'lib/a.dart', line_start: 3, line_end: 9,
  is_test: false, origin: 'ast', signature: null, community: null
})
const flowEl = () => waitFor(() => {
  const el = document.querySelector('.react-flow')
  expect(el).not.toBeNull()
  return el as HTMLElement
})
const hood = (center: string): Neighborhood => ({ nodes: [gnode(center, 'login')], edges: [], truncated: false })

function setup() {
  const neighbors = vi.fn(async (_p: string, q: { node: string }) => hood(q.node))
  const search = vi.fn(async () => [{ node: gnode('lib/a.dart::AuthService.login#method', 'login'), score: 2 }])
  installNexgraph({ graph: { neighbors, search, report: vi.fn(async () => ({
    god_nodes: [], communities: [], surprising: [], questions: [], cycles: { cycles: [], total: 0 }, freshness: { indexed_at: null, index_commit: null, head_commit: null, changed_files: 0, stale: false }, gaps: { isolated: { total: 0, nodes: [] }, ambiguous_edges: { total: 0, edges: [] } }, benchmark: null, truncated: false
  })) } })
  render(<div style={{ width: 1000, height: 700 }}><WorkspaceScreen project={project()} /></div>)
  return { neighbors, search }
}

const activeViewers = () => Array.from(document.querySelectorAll<HTMLElement>('.code-viewer'))
  .filter((el) => el.style.display !== 'none')

describe('WorkspaceScreen', () => {
  it('Ctrl+L ẩn panel trợ lý nhưng giữ bản nháp và lượt đang chạy', async () => {
    installNexgraph({ ai: {
      getSettings: vi.fn(async () => ({ provider: 'example', baseUrl: 'https://api.example.com/v1', model: 'm1', hasKey: true })),
      hasConsent: vi.fn(async () => true)
    }, agent: { prompt: vi.fn(() => new Promise<void>(() => {})) } })
    const view = render(<div style={{ width: 1000, height: 700 }}><WorkspaceScreen project={project()} /></div>)
    const toggle = screen.getByRole('button', { name: 'Ẩn/hiện trợ lý AI' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    const box = await screen.findByPlaceholderText(/Hỏi về dự án/)
    await userEvent.type(box, 'bản nháp')
    await userEvent.keyboard('{Control>}l{/Control}')
    expect(box.closest('aside')).not.toBeVisible()
    await userEvent.click(toggle)
    expect(await screen.findByPlaceholderText(/Hỏi về dự án/)).toHaveValue('bản nháp')

    await userEvent.type(box, '{Enter}')
    expect(await screen.findByRole('button', { name: 'Dừng' })).toBeInTheDocument()
    await userEvent.click(toggle)
    await userEvent.click(toggle)
    expect(await screen.findByRole('button', { name: 'Dừng' })).toBeInTheDocument()
    view.unmount()
  })

  it('mở kiến trúc từ bản đồ giữ block đang chọn', async () => {
    const architecture = vi.fn(async () => ({ parent: null, blocks: [], links: [] }))
    installNexgraph({ graph: { architecture } })
    render(<div style={{ width: 1000, height: 700 }}><WorkspaceScreen project={project()} /></div>)
    await userEvent.click(screen.getByRole('tab', { name: 'Bản đồ' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mở kiến trúc từ bản đồ' }))
    await waitFor(() => expect(architecture).toHaveBeenCalledWith('p1', 'dir:src'))
  })

  it('mục Tham quan của thanh hoạt động mở panel và nạp chuyến tham quan', async () => {
    const tour = vi.fn(async () => ({ steps: [] }))
    installNexgraph({ graph: { tour } })
    render(<div style={{ width: 1000, height: 700 }}><WorkspaceScreen project={project()} /></div>)
    await userEvent.click(screen.getByRole('button', { name: 'Tham quan' }))
    expect(tour).toHaveBeenCalledWith('p1')
    expect(await screen.findByText(/Chưa đủ dữ liệu/)).toBeInTheDocument()
  })

  it('tab Pull request chỉ hiện khi gh dùng được', async () => {
    const status = vi.fn(async () => ({ available: true, reason: null, repo: 'acme/demo', default_branch: 'main' }))
    const list = vi.fn(async () => ({ repo: 'acme/demo', default_branch: 'main', base: 'main', prs: [], conflicts: [], conflicts_truncated: false, truncated: false }))
    installNexgraph({ prs: { status, list } })
    render(<WorkspaceScreen project={project()} />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Pull request' }))
    expect(await screen.findByText('Không có pull request nào đang mở.')).toBeInTheDocument()
    expect(status).toHaveBeenCalledWith('p1')
  })

  it('ẩn tab Pull request khi thiếu gh', async () => {
    const { api } = installNexgraph()
    render(<WorkspaceScreen project={project()} />)
    await waitFor(() => expect(api.prs.status).toHaveBeenCalled())
    expect(screen.queryByRole('tab', { name: 'Pull request' })).not.toBeInTheDocument()
  })

  it('mở Kiến trúc ở giữa, cây tệp bên trái; trợ lý kiểu Wu thay chỗ cây tệp và chuyển được sang phải', async () => {
    // Đã lưu 'left' thì tôn trọng kiểu Wu: khung chat đóng sẵn, nhường chỗ cây tệp.
    localStorage.setItem('nexgraph.chat.dock', 'left')
    setup()
    expect(document.querySelector<HTMLElement>('.workspace-shell')!.dataset.chatDock).toBe('left')
    expect(localStorage.getItem('nexgraph.chat.dock')).toBe('left')
    expect(screen.getByRole('tab', { name: 'Kiến trúc', selected: true })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Graph', selected: false })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Duyệt tệp' })).toBeVisible()
    expect(screen.queryByRole('complementary', { name: 'Trợ lý AI' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Trợ lý AI', pressed: false }))
    expect(screen.getByRole('complementary', { name: 'Trợ lý AI' })).toBeVisible()
    expect(screen.queryByRole('complementary', { name: 'Duyệt tệp' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Thêm thao tác' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Chuyển khung chat sang phải' }))
    expect(screen.getByRole('complementary', { name: 'Duyệt tệp' })).toBeVisible()
    expect(screen.getByRole('complementary', { name: 'Trợ lý AI' })).toBeVisible()
    expect(localStorage.getItem('nexgraph.chat.dock')).toBe('right')
    localStorage.removeItem('nexgraph.chat.dock')
  })

  it('lần đầu vào workspace chưa có tuỳ chọn: trợ lý AI mở sẵn bên phải và không ghi vào localStorage', () => {
    localStorage.removeItem('nexgraph.chat.dock')
    setup()
    expect(document.querySelector<HTMLElement>('.workspace-shell')!.dataset.chatDock).toBe('right')
    expect(screen.getByRole('complementary', { name: 'Trợ lý AI' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Ẩn/hiện trợ lý AI' })).toHaveAttribute('aria-pressed', 'true')
    expect(localStorage.getItem('nexgraph.chat.dock')).toBeNull()
  })

  it('mở cấu hình MCP của OpenCode từ panel trợ lý', async () => {
    const plan = vi.fn(async () => [{ agent: 'opencode' as const, part: 'mcp' as const, path: 'opencode.json', exists: false,
      status: 'new' as const, after: '{}', snippet: '{}' }])
    installNexgraph({ mcp: { plan } })
    render(<WorkspaceScreen project={project()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Thêm thao tác' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Kết nối OpenCode' }))
    expect(plan).toHaveBeenCalledWith('opencode', 'p1', undefined)
    expect(within(screen.getByRole('dialog')).getByRole('combobox', { name: 'Trợ lý' })).toHaveValue('opencode')
  })

  it('dùng phím mũi tên, Home và End để chuyển và đưa focus vào thẻ tương ứng', async () => {
    setup()
    const tab = screen.getByRole('tab', { name: 'Kiến trúc' })
    tab.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Bản đồ', selected: true })).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Báo cáo', selected: true })).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(tab).toHaveFocus()
    expect(screen.getByRole('tabpanel', { name: 'Kiến trúc' })).toBeInTheDocument()
    screen.getByRole('tab', { name: 'Graph' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Cây', selected: true })).toHaveFocus()
    expect(within(screen.getByRole('complementary', { name: 'Duyệt tệp' })).getByRole('tree')).toBeVisible()
  })

  it('mở tệp từ thanh Duyệt tệp bằng bàn phím, không buộc qua thẻ Graph', async () => {
    const file = { ...gnode('lib/a.dart#file', 'a.dart'), kind: 'file' as const, line_start: 1 }
    const child = { id: 1, source: '.#repository', target: file.id, type: 'CONTAINS' as const, evidence: null,
      subtype: null, confidence: 'EXTRACTED' as const, confidence_score: 1, origin: 'ast' as const }
    const neighbors = vi.fn(async () => ({ nodes: [file], edges: [child], truncated: false }))
    installNexgraph({ graph: { neighbors } })
    render(<WorkspaceScreen project={project()} />)
    const item = await screen.findByRole('treeitem', { name: 'a.dart' })
    item.focus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('tab', { name: 'a.dart', selected: true })).toBeInTheDocument()
    expect(await screen.findByLabelText('editor')).toBeInTheDocument()
  })

  it('Cây mở cột duyệt tệp và giữ editor đã mở cùng bản nháp', async () => {
    const folder = { ...gnode('lib#directory', 'lib'), file: 'lib', kind: 'directory' as const }
    const file = { ...gnode('lib/a.dart#file', 'a.dart'), kind: 'file' as const, line_start: 1 }
    const child = (source: string, target: string) => ({ id: 1, source, target, type: 'CONTAINS' as const, evidence: null,
      subtype: null, confidence: 'EXTRACTED' as const, confidence_score: 1, origin: 'ast' as const })
    const neighbors = vi.fn(async (_pid: string, query: { node: string }) => query.node === '.#repository'
      ? { nodes: [folder], edges: [child('.#repository', folder.id)], truncated: false }
      : { nodes: [file], edges: [child(folder.id, file.id)], truncated: false })
    installNexgraph({ graph: { neighbors } })
    render(<WorkspaceScreen project={project()} initialTab="tree" />)
    const sidebar = screen.getByRole('complementary', { name: 'Duyệt tệp' })
    const pane = screen.getByRole('tabpanel', { name: 'Cây' })
    expect(within(pane).getByText('Chưa mở tệp')).toBeInTheDocument()
    expect(within(pane).queryByRole('tree')).not.toBeInTheDocument()
    await userEvent.click(await within(sidebar).findByText('lib'))
    await userEvent.click(await within(sidebar).findByText('a.dart'))
    const editor = await within(screen.getByRole('tabpanel', { name: 'Xem trước a.dart' })).findByLabelText('editor')
    expect(within(sidebar).getByRole('treeitem', { name: 'a.dart', selected: true })).toBeVisible()
    await userEvent.type(editor, 'nháp')
    await userEvent.click(screen.getByRole('tab', { name: 'Cây' }))
    expect(editor).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Xem trước a.dart', selected: true })).toBeInTheDocument()
    expect(within(sidebar).getByRole('treeitem', { name: 'lib', expanded: true })).toBeVisible()
    expect(editor).toHaveValue('nháp')

    await userEvent.click(screen.getByRole('button', { name: 'Đóng xem trước a.dart' }))
    expect(screen.getByRole('tab', { name: 'a.dart', selected: true })).toBeInTheDocument()
    expect(screen.getByRole('tabpanel', { name: 'a.dart' })).toContainHTML('textarea')
    expect(screen.getByRole('complementary', { name: 'Duyệt tệp' })).toBeVisible()
  })

  it('xem trước markdown chỉ active một code-viewer', async () => {
    const entries = [{ path: 'README.md', name: 'README.md', kind: 'file' as const }]
    installNexgraph({ fs: { list: vi.fn(async () => ({ entries, truncated: false })) } })
    render(<WorkspaceScreen project={project()} />)
    await userEvent.click(await screen.findByRole('treeitem', { name: 'README.md' }))
    expect(await screen.findByRole('tab', { name: 'Xem trước README.md', selected: true })).toBeInTheDocument()
    expect(activeViewers()).toHaveLength(1)
    expect(activeViewers()[0]).toHaveClass('markdown-preview')
  })

  it('xem trước tệp mã vẫn chỉ active một code-viewer', async () => {
    const entries = [{ path: 'a.dart', name: 'a.dart', kind: 'file' as const }]
    installNexgraph({ fs: { list: vi.fn(async () => ({ entries, truncated: false })) } })
    render(<WorkspaceScreen project={project()} />)
    await userEvent.click(await screen.findByRole('treeitem', { name: 'a.dart' }))
    expect(await screen.findByRole('tab', { name: 'Xem trước a.dart', selected: true })).toBeInTheDocument()
    const viewers = activeViewers()
    expect(viewers).toHaveLength(1)
    expect(viewers[0]).not.toHaveClass('markdown-preview')
    expect(within(viewers[0]).getByLabelText('editor')).toBeInTheDocument()
  })

  it('double-click file trong cây bỏ thẻ xem trước zombie', async () => {
    const entries = [{ path: 'a.dart', name: 'a.dart', kind: 'file' as const }]
    installNexgraph({ fs: { list: vi.fn(async () => ({ entries, truncated: false })) } })
    render(<WorkspaceScreen project={project()} />)
    await userEvent.dblClick(await screen.findByRole('treeitem', { name: 'a.dart' }))
    expect(await screen.findByRole('tab', { name: 'a.dart', selected: true })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Xem trước a.dart' })).not.toBeInTheDocument()
  })

  it('lệnh view:tree của Code-OSS mở cây bên trái và giao việc mở tệp cho editor của nền', async () => {
    const file = { ...gnode('lib/a.dart#file', 'a.dart'), kind: 'file' as const, line_start: 1 }
    const child = { id: 1, source: '.#repository', target: file.id, type: 'CONTAINS' as const, evidence: null,
      subtype: null, confidence: 'EXTRACTED' as const, confidence_score: 1, origin: 'ast' as const }
    const { api } = installNexgraph({ graph: { neighbors: vi.fn(async () => ({ nodes: [file], edges: [child], truncated: false })) } })
    let handle!: (name: string, arg?: unknown) => void
    const openFile = vi.fn(async () => {})
    window.nexgraph.host = { folder: '/demo', openFile, onCommand: (callback) => { handle = callback; return () => {} }, emit: vi.fn(async () => {}) }
    render(<WorkspaceScreen project={project()} initialCommand={{ name: 'view:tree' }} />)
    const sidebar = await screen.findByRole('complementary', { name: 'Duyệt tệp' })
    act(() => handle('view:tree'))
    expect(screen.getByRole('tabpanel', { name: 'Cây' })).toHaveTextContent('trình soạn thảo của nền')
    await userEvent.click(await within(sidebar).findByRole('treeitem', { name: 'a.dart' }))
    expect(openFile).toHaveBeenCalledWith('lib/a.dart', 1, undefined)
    expect(api.fs.read).not.toHaveBeenCalled()
    expect(sidebar).toBeVisible()
  })

  it('nạp lại sơ đồ đang mở từ công bố đồ thị của đúng dự án', async () => {
    const block = (label: string) => ({ id: 'dir:src', label, kind: 'directory' as const, size: 1, symbols: 1, drillable: true })
    const architecture = vi.fn()
      .mockResolvedValueOnce({ parent: null, links: [], blocks: [block('Trước cập nhật')] })
      .mockResolvedValueOnce({ parent: null, links: [], blocks: [block('Sau cập nhật')] })
    const { emit } = installNexgraph({ graph: { architecture } })
    render(<WorkspaceScreen project={project()} />)
    expect(await screen.findByText('Trước cập nhật')).toBeInTheDocument()
    act(() => emit({ type: 'graph_updated', project_id: 'p2' }))
    expect(architecture).toHaveBeenCalledTimes(1)
    act(() => emit({ type: 'graph_updated', project_id: 'p1' }))
    expect(await screen.findByText('Sau cập nhật')).toBeInTheDocument()
    expect(screen.queryByText('Trước cập nhật')).not.toBeInTheDocument()
  })

  it('mở yêu cầu panel từ Code-OSS một lần và giữ thanh hoạt động ở nền', async () => {
    installNexgraph()
    window.nexgraph.host = { folder: '/demo', openFile: vi.fn(async () => {}), onCommand: vi.fn(() => () => {}), emit: vi.fn(async () => {}) }
    render(<StrictMode><WorkspaceScreen project={project()} initialCommand={{ name: 'panel:search' }} /></StrictMode>)
    expect(await screen.findByLabelText('Tìm trong đồ thị', { selector: 'input' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Thanh hoạt động' })).not.toBeInTheDocument()
  })

  it('toggles the search panel from the activity bar', async () => {
    setup()
    const btn = screen.getByRole('button', { name: 'Tìm trong đồ thị' })
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(btn)
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(btn)
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByLabelText('Tìm trong đồ thị', { selector: 'input' })).not.toBeInTheDocument()
    await userEvent.click(btn)
    expect(screen.getByLabelText('Tìm trong đồ thị', { selector: 'input' })).toBeInTheDocument()
  })

  it('opening a search result switches to the Graph tab centred on that node', async () => {
    const { neighbors } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Tìm trong đồ thị' }))
    await userEvent.type(screen.getByLabelText('Tìm trong đồ thị', { selector: 'input' }), 'login')
    const result = await screen.findByRole('button', { name: /lib\/a\.dart:3/ }, { timeout: 2000 })
    fireEvent.click(result)
    expect(screen.getByRole('tab', { name: 'Graph', selected: true })).toBeInTheDocument()
    await waitFor(() => expect(neighbors).toHaveBeenCalledWith('p1', expect.objectContaining({ node: 'lib/a.dart::AuthService.login#method' })))
    expect(await screen.findByText('lib/a.dart:3–9')).toBeInTheDocument() // NodeInspector của nút đã chọn
  })
})

describe('WorkspaceScreen: changes', () => {
  const changes = emptyChanges({
    changed_files: [{ path: 'lib/a.dart', status: 'M', old_path: null }],
    changed_nodes: [gnode('lib/a.dart::AuthService.login#method', 'login')],
    impacted: [{ node: gnode('lib/b.dart::build#method', 'build'), score: 1, hops: 1 }]
  })

  it('watches the project folder while mounted and stops on unmount', async () => {
    const { api } = installNexgraph()
    const { unmount } = render(<div style={{ width: 1000, height: 700 }}><WorkspaceScreen project={project()} /></div>)
    await waitFor(() => expect(api.watch.start).toHaveBeenCalledTimes(1))
    expect(api.watch.start).toHaveBeenCalledWith('p1')
    unmount()
    expect(api.watch.stop).toHaveBeenCalledWith('p1')
  })

  it('opens the Vùng ảnh hưởng panel and jumps to the Graph tab with the node highlighted', async () => {
    const neighbors = vi.fn(async (_p: string, q: { node: string }) => ({ nodes: [gnode(q.node, 'build')], edges: [], truncated: false }))
    const { api } = installNexgraph({ graph: { changes: vi.fn(async () => changes), neighbors } })
    render(<div style={{ width: 1000, height: 700 }}><WorkspaceScreen project={project()} /></div>)
    await userEvent.click(screen.getByRole('button', { name: 'Vùng ảnh hưởng' }))
    const impacted = await screen.findByRole('region', { name: 'Vùng ảnh hưởng' })
    expect(api.graph.changes).toHaveBeenCalled()
    await userEvent.click(within(impacted).getByRole('button', { name: /build/ }))
    expect(screen.getByRole('tab', { name: 'Graph', selected: true })).toBeInTheDocument()
    await waitFor(() => expect(neighbors).toHaveBeenCalledWith('p1', expect.objectContaining({ node: 'lib/b.dart::build#method' })))
    expect(await screen.findByText('ảnh hưởng')).toBeInTheDocument()
  })
})

describe('WorkspaceScreen: editor tabs', () => {
  const read = () => vi.fn(async () => ({ text: 'one\ntwo\nthree', eol: '\n' as const, bom: false, mtimeMs: 1, version: 'initial', readOnly: false }))

  async function openFromSearch(over: Parameters<typeof installNexgraph>[0] = {}) {
    const code = read()
    const neighbors = vi.fn(async (_p: string, q: { node: string }) => hood(q.node))
    const search = vi.fn(async () => [{ node: gnode('lib/a.dart::AuthService.login#method', 'login'), score: 2 }])
    const { api } = installNexgraph({ ...over, fs: { read: code }, graph: { neighbors, search } })
    render(<div style={{ width: 1000, height: 700 }}><WorkspaceScreen project={project()} /></div>)
    await userEvent.click(screen.getByRole('button', { name: 'Tìm trong đồ thị' }))
    await userEvent.type(screen.getByLabelText('Tìm trong đồ thị', { selector: 'input' }), 'login')
    await userEvent.click(await screen.findByText('login'))
    await userEvent.click(await screen.findByRole('button', { name: 'Mở mã' }))
    return { api, code }
  }

  it('lệnh quay lại/đi tới mở lại đúng tệp và dòng đã điều hướng', async () => {
    recordNavigation('p1', { file: 'a.ts', line: 2, column: 1 })
    recordNavigation('p1', { file: 'b.ts', line: 7, column: 4 })
    installNexgraph({ fs: { list: vi.fn(async () => ({ entries: [], truncated: false })), read: read() } })
    render(<WorkspaceScreen project={project()} />)
    act(() => { runCommand('navigation.back') })
    expect(await screen.findByRole('tab', { name: 'a.ts', selected: true })).toBeTruthy()
    await waitFor(() => expect(revealLines).toHaveBeenCalledWith(2, undefined))

    revealLines.mockClear()
    act(() => { runCommand('navigation.forward') })
    expect(await screen.findByRole('tab', { name: 'b.ts', selected: true })).toBeTruthy()
    await waitFor(() => expect(revealLines).toHaveBeenCalledWith(7, undefined))
  })

  it('chuyển thẻ theo lần dùng gần nhất, ghim và mở lại thẻ đã đóng', async () => {
    localStorage.removeItem('nexgraph.recentFiles:p1')
    const entries = ['a.ts', 'b.ts', 'c.ts'].map((name) => ({ path: name, name, kind: 'file' as const }))
    installNexgraph({ fs: { list: vi.fn(async () => ({ entries, truncated: false })) } })
    render(<WorkspaceScreen project={project()} />)
    for (const name of ['a.ts', 'b.ts', 'c.ts']) await userEvent.click(await screen.findByRole('treeitem', { name }))
    fireEvent.keyDown(document, { key: 'Tab', ctrlKey: true })
    expect(screen.getByRole('tab', { name: 'b.ts', selected: true })).toBeInTheDocument()
    fireEvent.keyUp(window, { key: 'Control' })
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'b.ts' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ghim thẻ' }))
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'c.ts' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Đóng thẻ khác' }))
    expect(screen.getByRole('tab', { name: 'b.ts' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'a.ts' })).toBeNull()
    fireEvent.keyDown(document, { key: 'T', code: 'KeyT', ctrlKey: true, shiftKey: true })
    expect(screen.getByRole('tab', { name: 'a.ts', selected: true })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('nexgraph.recentFiles:p1') ?? '[]')[0]).toBe('a.ts')
  })
  it('Ctrl+1 và Ctrl+0 chọn thẻ đầu và thẻ cuối', async () => {
    const entries = ['a.ts', 'b.ts', 'c.ts'].map((name) => ({ path: name, name, kind: 'file' as const }))
    installNexgraph({ fs: { list: vi.fn(async () => ({ entries, truncated: false })) } })
    render(<WorkspaceScreen project={project()} />)
    for (const name of ['a.ts', 'b.ts', 'c.ts']) await userEvent.click(await screen.findByRole('treeitem', { name }))
    fireEvent.keyDown(document, { key: '1', code: 'Digit1', ctrlKey: true })
    expect(screen.getByRole('tab', { name: 'a.ts', selected: true })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: '0', code: 'Digit0', ctrlKey: true })
    expect(screen.getByRole('tab', { name: 'c.ts', selected: true })).toBeInTheDocument()
  })
  it('kéo thả thay đổi thứ tự các thẻ tệp', async () => {
    const entries = ['a.ts', 'b.ts', 'c.ts'].map((name) => ({ path: name, name, kind: 'file' as const }))
    installNexgraph({ fs: { list: vi.fn(async () => ({ entries, truncated: false })) } })
    render(<WorkspaceScreen project={project()} />)
    for (const name of ['a.ts', 'b.ts', 'c.ts']) await userEvent.click(await screen.findByRole('treeitem', { name }))
    const tabNames = () => Array.from(document.querySelectorAll<HTMLElement>('.ws-tabs .file-tab .tab-name')).map((node) => node.textContent?.trim() ?? '').filter((name) => !name.startsWith('Xem trước'))
    expect(tabNames()).toEqual(['a.ts', 'b.ts', 'c.ts'])
    const data: Record<string, string> = {}
    const dataTransfer = {
      setData: (type: string, value: string) => { data[type] = value },
      getData: (type: string) => data[type] ?? '', effectAllowed: '', dropEffect: ''
    }
    fireEvent.dragStart(screen.getByRole('tab', { name: 'a.ts' }).closest('.file-tab') as HTMLElement, { dataTransfer })
    fireEvent.dragOver(screen.getByRole('tab', { name: 'c.ts' }).closest('.file-tab') as HTMLElement, { dataTransfer })
    fireEvent.drop(screen.getByRole('tab', { name: 'c.ts' }).closest('.file-tab') as HTMLElement, { dataTransfer })
    expect(tabNames()).toEqual(['b.ts', 'c.ts', 'a.ts'])
  })
  it('click giữa đóng đúng thẻ tệp', async () => {
    const entries = ['a.ts', 'b.ts', 'c.ts'].map((name) => ({ path: name, name, kind: 'file' as const }))
    installNexgraph({ fs: { list: vi.fn(async () => ({ entries, truncated: false })) } })
    render(<WorkspaceScreen project={project()} />)
    for (const name of ['a.ts', 'b.ts', 'c.ts']) await userEvent.click(await screen.findByRole('treeitem', { name }))
    fireEvent(screen.getByRole('tab', { name: 'b.ts' }), new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(screen.queryByRole('tab', { name: 'b.ts' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'a.ts' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'c.ts' })).toBeInTheDocument()
  })
  it('nút khoá và lệnh editor.toggle_read_only bật/tắt chế độ chỉ đọc thật', async () => {
    const entries = [{ path: 'a.ts', name: 'a.ts', kind: 'file' as const }]
    installNexgraph({ fs: { list: vi.fn(async () => ({ entries, truncated: false })), read: read() } })
    render(<WorkspaceScreen project={project()} />)
    await userEvent.dblClick(await screen.findByRole('treeitem', { name: 'a.ts' }))
    const editor = await within(screen.getByRole('tabpanel', { name: 'a.ts' })).findByLabelText('editor')
    expect((editor as HTMLTextAreaElement).readOnly).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Khóa chỉ đọc a.ts' }))
    expect((editor as HTMLTextAreaElement).readOnly).toBe(true)
    expect(screen.getByRole('button', { name: 'Bỏ khóa chỉ đọc a.ts' })).toHaveAttribute('aria-pressed', 'true')
    act(() => { runCommand('editor.toggle_read_only') })
    expect((editor as HTMLTextAreaElement).readOnly).toBe(false)
  })
  it('readOnly từ đĩa không bật nút khoá và không ghi đè khoá của người dùng', async () => {
    let disk = { text: 'one\ntwo\nthree', eol: '\n' as const, bom: false, mtimeMs: 1, version: 'ro-1', readOnly: true }
    const code = vi.fn(async () => disk)
    const entries = [{ path: 'a.ts', name: 'a.ts', kind: 'file' as const }]
    const { emit } = installNexgraph({ fs: { list: vi.fn(async () => ({ entries, truncated: false })), read: code } })
    render(<WorkspaceScreen project={project()} />)
    await userEvent.dblClick(await screen.findByRole('treeitem', { name: 'a.ts' }))
    const editor = await within(screen.getByRole('tabpanel', { name: 'a.ts' })).findByLabelText('editor')
    expect((editor as HTMLTextAreaElement).readOnly).toBe(true)
    expect(screen.getByRole('button', { name: 'Khóa chỉ đọc a.ts' })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'Khóa chỉ đọc a.ts' }))
    expect(screen.getByRole('button', { name: 'Bỏ khóa chỉ đọc a.ts' })).toHaveAttribute('aria-pressed', 'true')
    disk = { ...disk, version: 'ro-2', readOnly: false }
    await act(async () => { emit({ type: 'changes_updated', project_id: 'p1' }) })
    await waitFor(() => expect(code.mock.calls.length).toBeGreaterThan(1))
    expect(screen.getByRole('button', { name: 'Bỏ khóa chỉ đọc a.ts' })).toHaveAttribute('aria-pressed', 'true')
    expect((editor as HTMLTextAreaElement).readOnly).toBe(true)
  })
  it('đổi tên tệp đang khoá thì khoá theo path mới', async () => {
    let entries = [{ path: 'old.ts', name: 'old.ts', kind: 'file' as const }]
    const list = vi.fn(async () => ({ entries, truncated: false }))
    const rename = vi.fn(async (_pid: string, _from: string, to: string) => { entries = [{ path: to, name: to, kind: 'file' }] })
    installNexgraph({ fs: { list, rename, trash: vi.fn(async () => {}), createFile: vi.fn(async () => {}) } })
    render(<WorkspaceScreen project={project()} />)
    await userEvent.click(await screen.findByRole('treeitem', { name: 'old.ts' }))
    await userEvent.click(screen.getByRole('button', { name: 'Khóa chỉ đọc old.ts' }))
    expect(screen.getByRole('button', { name: 'Bỏ khóa chỉ đọc old.ts' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'old.ts' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Đổi tên' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Đổi tên' }), { target: { value: 'new.ts' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Đổi tên' }), { key: 'Enter' })
    expect(await screen.findByRole('button', { name: 'Bỏ khóa chỉ đọc new.ts' })).toHaveAttribute('aria-pressed', 'true')
  })
  it('đóng rồi mở lại cùng path thì khoá được xoá', async () => {
    const entries = [{ path: 'a.ts', name: 'a.ts', kind: 'file' as const }]
    installNexgraph({ fs: { list: vi.fn(async () => ({ entries, truncated: false })), read: read() } })
    render(<WorkspaceScreen project={project()} />)
    await userEvent.click(await screen.findByRole('treeitem', { name: 'a.ts' }))
    await userEvent.click(screen.getByRole('button', { name: 'Khóa chỉ đọc a.ts' }))
    expect(screen.getByRole('button', { name: 'Bỏ khóa chỉ đọc a.ts' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Đóng a.ts' }))
    expect(screen.queryByRole('button', { name: 'Bỏ khóa chỉ đọc a.ts' })).toBeNull()
    await userEvent.click(screen.getByRole('treeitem', { name: 'a.ts' }))
    expect(screen.getByRole('button', { name: 'Khóa chỉ đọc a.ts' })).toHaveAttribute('aria-pressed', 'false')
  })
  it('cây đổi tên và xoá cập nhật thẻ đang mở', async () => {
    let entries = [{ path: 'old.ts', name: 'old.ts', kind: 'file' as const }]
    const list = vi.fn(async () => ({ entries, truncated: false }))
    const rename = vi.fn(async (_pid: string, _from: string, to: string) => { entries = [{ path: to, name: to, kind: 'file' }] })
    const trash = vi.fn(async () => { entries = [] })
    installNexgraph({ fs: { list, createFile: vi.fn(), rename, trash } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<WorkspaceScreen project={project()} />)
    await userEvent.click(await screen.findByRole('treeitem', { name: 'old.ts' }))
    const row = screen.getByRole('treeitem', { name: 'old.ts' })
    fireEvent.contextMenu(row)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Đổi tên' }))
    const input = screen.getByRole('textbox', { name: 'Đổi tên' })
    fireEvent.change(input, { target: { value: 'new.ts' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByRole('tab', { name: 'Xem trước new.ts', selected: true })).toBeInTheDocument()
    const renamed = await screen.findByRole('treeitem', { name: 'new.ts' })
    renamed.focus()
    fireEvent.keyDown(renamed, { key: 'Delete' })
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Xem trước new.ts' })).toBeNull())
    confirm.mockRestore()
  })


  it('Ctrl+B và Ctrl+J ẩn hiện panel trái và terminal', () => {
    installNexgraph()
    render(<WorkspaceScreen project={project()} />)
    expect(screen.getByRole('complementary', { name: 'Duyệt tệp' })).toBeVisible()
    fireEvent.keyDown(document, { key: 'b', code: 'KeyB', ctrlKey: true })
    expect(screen.queryByRole('complementary', { name: 'Duyệt tệp' })).toBeNull()
    fireEvent.keyDown(document, { key: 'b', code: 'KeyB', ctrlKey: true })
    expect(screen.getByRole('complementary', { name: 'Duyệt tệp' })).toBeVisible()
    fireEvent.keyDown(document, { key: 'j', code: 'KeyJ', ctrlKey: true })
    expect(screen.getByRole('region', { name: 'Terminal' })).toBeVisible()
    fireEvent.keyDown(document, { key: 'j', code: 'KeyJ', ctrlKey: true })
    expect(screen.queryByRole('region', { name: 'Terminal' })).toBeNull()
  })

  it('sends the pinned unsaved editor snapshot and flushes dirty metadata before AI inference', async () => {
    const target = { provider: 'openai', baseUrl: 'https://api.openai.com/v1', accountId: 'account-a' }
    const prompt = vi.fn(async () => {})
    const { api } = await openFromSearch({ ai: {
      getSettings: vi.fn(async () => ({ ...target, model: 'test-model', hasKey: false })), hasConsent: vi.fn(async () => true)
    }, agent: { prompt } })
    const editor = await screen.findByLabelText('editor')
    fireEvent.input(editor, { target: { value: 'draft\nselected source' } })
    const attach = screen.getByRole('button', { name: 'Thêm tệp đang mở' })
    await waitFor(() => expect(attach).toBeEnabled())
    await userEvent.click(attach)
    fireEvent.input(editor, { target: { value: 'later unsent changes' } })
    await userEvent.type(screen.getByPlaceholderText(/Hỏi về dự án/), 'Explain this draft{Enter}')
    await waitFor(() => expect(prompt).toHaveBeenCalledWith('p1', 'Explain this draft', target, { context: [{
      kind: 'file', file: 'lib/a.dart', start: 1, end: 2, text: 'draft\nselected source', version: 'initial', dirty: true
    }] }))
    expect(api.agent.editorState).toHaveBeenLastCalledWith('p1', [{ file: 'lib/a.dart', version: 'initial', dirty: true }])
    expect(vi.mocked(api.agent.editorState).mock.invocationCallOrder.at(-1)).toBeLessThan(prompt.mock.invocationCallOrder[0])
    expect(editor).toHaveValue('later unsent changes')
  })

  it('resizes the AI pane with the keyboard and keeps the width when reopening chat', async () => {
    await openFromSearch()
    const handle = screen.getByRole('separator', { name: 'Độ rộng trợ lý AI' })
    const before = Number(handle.getAttribute('aria-valuenow'))
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(handle).toHaveAttribute('aria-valuenow', String(Math.min(640, before + 20)))
    fireEvent.keyDown(document, { key: 'l', ctrlKey: true })
    expect(screen.queryByRole('separator', { name: 'Độ rộng trợ lý AI' })).toBeNull()
    fireEvent.keyDown(document, { key: 'l', ctrlKey: true })
    expect(screen.getByRole('separator', { name: 'Độ rộng trợ lý AI' })).toHaveAttribute('aria-valuenow', String(Math.min(640, before + 20)))
  })

  it('opens a file tab from the inspector, once per file, and closes back to the previous tab', async () => {
    const { code } = await openFromSearch()
    expect(await screen.findByRole('tab', { name: 'a.dart', selected: true })).toBeInTheDocument()
    expect(code).toHaveBeenCalledWith('p1', 'lib/a.dart')
    expect(await screen.findByLabelText('editor')).toHaveValue('one\ntwo\nthree')
    await userEvent.click(screen.getByRole('tab', { name: 'Graph' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Mở mã' }))
    expect(screen.getAllByRole('tab', { name: 'a.dart' })).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Đóng a.dart' }))
    expect(screen.queryByRole('tab', { name: 'a.dart' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Graph', selected: true })).toBeInTheDocument()
  })

  it('opens code at the evidence line from the architecture arrow list', async () => {
    const evidence = [{ file: 'lib/a.dart', line: 2, edge: { id: 1, source: 'lib/a.dart::A.run#method', target: 'lib/b.dart::B.go#method', type: 'CALLS',
      subtype: null, confidence: 'INFERRED' as const, confidence_score: 0.9, origin: 'resolver', evidence: { file: 'lib/a.dart', line: 2, col: 0 } } }]
    installNexgraph({ fs: { read: read() }, graph: {
      architecture: vi.fn(async () => ({ parent: null, links: [{ from: 'dir:lib', to: 'dir:test', count: 1, types: { CALLS: 1 } }],
        blocks: [{ id: 'dir:lib', label: 'lib', kind: 'directory' as const, size: 1, symbols: 1, drillable: true },
                 { id: 'dir:test', label: 'test', kind: 'directory' as const, size: 1, symbols: 1, drillable: true }] })),
      archEvidence: vi.fn(async () => evidence)
    } })
    render(<div style={{ width: 1000, height: 700 }}><WorkspaceScreen project={project()} /></div>)
    await userEvent.click(await screen.findByRole('button', { name: /lib → test/ }))
    await userEvent.click(await screen.findByRole('button', { name: /lib\/a\.dart:2/ }))
    expect(await screen.findByRole('tab', { name: 'a.dart', selected: true })).toBeInTheDocument()
    await waitFor(() => expect(revealLines).toHaveBeenCalledWith(2, undefined))
  })

  it('đóng thẻ chưa lưu thì hỏi xác nhận; huỷ thì giữ thẻ, đồng ý thì đóng', async () => {
    await openFromSearch()
    await userEvent.type(await screen.findByLabelText('editor'), 'x')
    expect(document.querySelector('.dirty-dot')).not.toBeNull()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    await userEvent.click(screen.getByRole('button', { name: 'Đóng a.dart' }))
    expect(confirm).toHaveBeenCalledWith('a.dart có thay đổi chưa lưu. Đóng và bỏ các thay đổi này?')
    expect(screen.getByRole('tab', { name: 'a.dart' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Đóng a.dart' }))
    expect(screen.queryByRole('tab', { name: 'a.dart' })).not.toBeInTheDocument()
    confirm.mockRestore()
  })

  it('còn tệp chưa lưu thì chặn beforeunload; lưu/không sửa thì không chặn', async () => {
    const unload = () => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented }
    await openFromSearch()
    expect(unload()).toBe(false)
    await userEvent.type(await screen.findByLabelText('editor'), 'x')
    expect(unload()).toBe(true)
  })

  it('rời workspace thì đóng phiên agent của dự án', () => {
    const { api } = installNexgraph()
    const view = render(<div style={{ width: 1000, height: 700 }}><WorkspaceScreen project={project()} /></div>)
    expect(api.agent.close).not.toHaveBeenCalled()
    view.unmount()
    expect(api.agent.close).toHaveBeenCalledWith('p1')
  })

  it('đổi sang thẻ khác rồi quay lại vẫn giữ nội dung đang sửa và dấu ●', async () => {
    await openFromSearch()
    const ta = await screen.findByLabelText('editor')
    await userEvent.type(ta, 'x')
    await userEvent.click(screen.getByRole('tab', { name: 'Graph' }))
    expect(ta).not.toBeVisible()
    expect(document.querySelector('.dirty-dot')).not.toBeNull()
    await userEvent.click(screen.getByRole('tab', { name: 'a.dart' }))
    expect(screen.getByLabelText('editor')).toBe(ta)
    expect(ta).toBeVisible()
    expect(ta).toHaveValue('one\ntwo\nthreex')
  })

  it('rời dự án khi còn tệp chưa lưu thì hỏi; huỷ thì ở lại', async () => {
    const neighbors = vi.fn(async (_p: string, q: { node: string }) => hood(q.node))
    const search = vi.fn(async () => [{ node: gnode('lib/a.dart::AuthService.login#method', 'login'), score: 2 }])
    installNexgraph({ fs: { read: read() }, graph: { neighbors, search } })
    const onBack = vi.fn()
    render(<div style={{ width: 1000, height: 700 }}><WorkspaceScreen project={project()} onBack={onBack} /></div>)
    await userEvent.click(screen.getByRole('button', { name: 'Tìm trong đồ thị' }))
    await userEvent.type(screen.getByLabelText('Tìm trong đồ thị', { selector: 'input' }), 'login')
    await userEvent.click(await screen.findByText('login'))
    await userEvent.click(await screen.findByRole('button', { name: 'Mở mã' }))
    await userEvent.type(await screen.findByLabelText('editor'), 'x')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    await userEvent.click(screen.getByRole('button', { name: /Dự án|Quay lại|←/ }))
    expect(confirm).toHaveBeenCalledWith('Còn 1 tệp có thay đổi chưa lưu. Rời khỏi dự án và bỏ các thay đổi này?')
    expect(onBack).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /Dự án|Quay lại|←/ }))
    expect(onBack).toHaveBeenCalledTimes(1)
    confirm.mockRestore()
  })

  it('đóng thẻ sạch thì không hỏi', async () => {
    await openFromSearch()
    await screen.findByLabelText('editor')
    const confirm = vi.spyOn(window, 'confirm')
    await userEvent.click(screen.getByRole('button', { name: 'Đóng a.dart' }))
    expect(confirm).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('opens the export dialog scoped to the whole project from the Kiến trúc tab', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Xuất…' }))
    expect(screen.getByRole('dialog', { name: 'Xuất đồ thị: demo' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Toàn bộ dự án')).toBeNull() // phạm vi đã là toàn bộ
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Xuất đồ thị: demo' })).toBeNull()
  })

  it('tìm đường: không nối được thì báo và không vẽ cạnh', async () => {
    const a = gnode('lib/a.dart::A.run#method', 'run')
    const b = gnode('lib/b.dart::B.go#method', 'go')
    const paths = vi.fn(async () => ({ nodes: [a, b], edges: [], unconnected: [b.id] }))
    const search = vi.fn(async (_p: string, q: string) => [{ node: q.startsWith('go') ? b : a, score: 1 }])
    installNexgraph({ graph: { neighbors: vi.fn(async (_p: string, q: { node: string }) => ({ nodes: [q.node === b.id ? b : a], edges: [], truncated: false })), search, paths } })
    render(<div style={{ width: 1000, height: 700 }}><WorkspaceScreen project={project()} /></div>)
    await userEvent.click(screen.getByRole('button', { name: 'Tìm trong đồ thị' }))
    await userEvent.type(screen.getByLabelText('Tìm trong đồ thị', { selector: 'input' }), 'run')
    fireEvent.click(await screen.findByRole('button', { name: /run/ }))
    const nodeLabel = await within(await flowEl()).findByText('run')
    fireEvent.contextMenu(nodeLabel)
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Tìm đường tới…' }))
    expect(screen.getByRole('status', { name: 'Chế độ chọn đích' })).toHaveTextContent('Bấm node đích')
    const box = screen.getByLabelText('Tìm trong đồ thị', { selector: 'input' })
    await userEvent.clear(box)
    await userEvent.type(box, 'go')
    fireEvent.click(await screen.findByRole('button', { name: /go/ }))
    await waitFor(() => expect(paths).toHaveBeenCalledWith('p1', [a.id, b.id]))
    expect(await screen.findByText('Không tìm thấy liên kết trực tiếp trong graph')).toBeInTheDocument()
    expect(document.querySelectorAll('.react-flow__edge')).toHaveLength(0)
  })

  it('vùng ảnh hưởng tô node bị ảnh hưởng và mở panel ảnh hưởng', async () => {
    const a = gnode('lib/a.dart::A.run#method', 'run')
    const c = gnode('lib/c.dart::C.use#method', 'use')
    const impactOf = vi.fn(async () => ({ node: a, impacted: [{ node: c, score: 1, hops: 1 }], tests: [], truncated: false }))
    installNexgraph({ graph: { neighbors: vi.fn(async () => ({ nodes: [a, c], edges: [], truncated: false })),
      search: vi.fn(async () => [{ node: a, score: 1 }]), impactOf } })
    render(<div style={{ width: 1000, height: 700 }}><WorkspaceScreen project={project()} /></div>)
    await userEvent.click(screen.getByRole('button', { name: 'Tìm trong đồ thị' }))
    await userEvent.type(screen.getByLabelText('Tìm trong đồ thị', { selector: 'input' }), 'run')
    fireEvent.click(await screen.findByRole('button', { name: /run/ }))
    const flow = await flowEl()
    fireEvent.contextMenu(await within(flow).findByText('run'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Vùng ảnh hưởng nếu sửa' }))
    expect(impactOf).toHaveBeenCalledWith('p1', a.id)
    expect(await screen.findByText('Ảnh hưởng nếu sửa run')).toBeInTheDocument()
    await waitFor(() => expect(within(flow).getByText('ảnh hưởng')).toBeInTheDocument())
  })

  it('đổi ngôn ngữ áp dụng ngay cho nhãn thẻ workspace', async () => {
    installNexgraph()
    render(<div style={{ width: 1000, height: 700 }}><LocaleHost render={() => <WorkspaceScreen project={project()} />} /></div>)
    expect(await screen.findByRole('tab', { name: 'Kiến trúc' })).toBeInTheDocument()
    act(() => setLocale('en'))
    expect(await screen.findByRole('tab', { name: 'Architecture' })).toBeInTheDocument()
  })

  it('tab Báo cáo: câu hỏi gợi ý chạy Hỏi graph và chuyển sang Graph; Xuất Markdown chọn sẵn markdown', async () => {
    const a = gnode('lib/a.dart::A.run#method', 'run')
    const ask = vi.fn(async () => ({ seeds: [a], nodes: [a], edges: [], truncated: false }))
    const report = vi.fn(async () => ({ god_nodes: [], communities: [], surprising: [], cycles: { cycles: [], total: 0 }, freshness: { indexed_at: null, index_commit: null, head_commit: null, changed_files: 0, stale: false }, gaps: { isolated: { total: 0, nodes: [] }, ambiguous_edges: { total: 0, edges: [] } }, benchmark: null, truncated: false,
      questions: [{ question: 'run làm gì?', why: '' }] }))
    installNexgraph({ graph: { ask, report } })
    render(<div style={{ width: 1000, height: 700 }}><WorkspaceScreen project={project()} /></div>)
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Kiến trúc', 'Bản đồ', 'Luồng', 'Graph', 'Cây', 'Báo cáo'])
    await userEvent.click(screen.getByRole('tab', { name: 'Báo cáo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Xuất Markdown' }))
    expect(screen.getByLabelText('Báo cáo Markdown')).toBeChecked()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(await screen.findByRole('button', { name: 'run làm gì?' }))
    expect(ask).toHaveBeenCalledWith('p1', 'run làm gì?')
    expect(await screen.findByRole('tab', { name: 'Graph', selected: true })).toBeInTheDocument()
    expect(await within(await flowEl()).findByText('run')).toBeInTheDocument()
  })

  it('câu hỏi gợi ý lỗi hoặc không khớp vẫn báo trên tab Graph', async () => {
    const ask = vi.fn().mockRejectedValueOnce({ code: 'bad_param', message: 'Câu hỏi không có từ nào tìm được' })
      .mockResolvedValueOnce({ seeds: [], nodes: [], edges: [], truncated: false })
    const report = vi.fn(async () => ({ god_nodes: [], communities: [], surprising: [], cycles: { cycles: [], total: 0 }, freshness: { indexed_at: null, index_commit: null, head_commit: null, changed_files: 0, stale: false }, gaps: { isolated: { total: 0, nodes: [] }, ambiguous_edges: { total: 0, edges: [] } }, benchmark: null, truncated: false,
      questions: [{ question: 'q1?', why: '' }] }))
    installNexgraph({ graph: { ask, report, neighbors: vi.fn(async () => ({ nodes: [], edges: [], truncated: false })) } })
    render(<div style={{ width: 1000, height: 700 }}><WorkspaceScreen project={project()} /></div>)
    await userEvent.click(screen.getByRole('tab', { name: 'Báo cáo' }))
    await userEvent.click(await screen.findByRole('button', { name: 'q1?' }))
    expect(await screen.findByText('Câu hỏi không có từ nào tìm được')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Graph', selected: true })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Báo cáo' }))
    await userEvent.click(await screen.findByRole('button', { name: 'q1?' }))
    expect(await screen.findByText('Không tìm thấy node nào khớp câu hỏi')).toBeInTheDocument()
  })
})
describe('WorkspaceScreen: multibuffer', () => {
  it('mở thẻ nhiều đoạn từ request và giữ thẻ tệp gốc khi đóng thẻ đó', async () => {
    const file = { ...gnode('lib/a.dart#file', 'a.dart'), kind: 'file' as const, line_start: 1 }
    const child = { id: 1, source: '.#repository', target: file.id, type: 'CONTAINS' as const, evidence: null,
      subtype: null, confidence: 'EXTRACTED' as const, confidence_score: 1, origin: 'ast' as const }
    installNexgraph({ graph: { neighbors: vi.fn(async () => ({ nodes: [file], edges: [child], truncated: false })) } })
    render(<div style={{ width: 1000, height: 700 }}><WorkspaceScreen project={project()} /></div>)
    const item = await screen.findByRole('treeitem', { name: 'a.dart' })
    item.focus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('tab', { name: 'a.dart', selected: true })).toBeInTheDocument()

    act(() => requestMultiBuffer({ id: 'm1', title: 'Hai đoạn', excerpts: buildExcerpts([
      { file: 'lib/a.dart', line: 2 }, { file: 'lib/b.dart', line: 5 }
    ]) }))
    expect(await screen.findByRole('tab', { name: 'Hai đoạn', selected: true })).toBeInTheDocument()
    const pane = screen.getByRole('tabpanel', { name: 'Hai đoạn' })
    expect(within(pane).getByLabelText('lib/a.dart:1-4')).toBeInTheDocument()
    expect(within(pane).getByLabelText('lib/b.dart:3-7')).toBeInTheDocument()
    const multi = pane.querySelector<HTMLElement>('.multi-buffer')!
    expect(await within(multi).findAllByLabelText('editor')).toHaveLength(2)

    await userEvent.click(screen.getByRole('button', { name: 'Đóng Hai đoạn' }))
    expect(screen.queryByRole('tab', { name: 'Hai đoạn' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'a.dart' })).toBeInTheDocument()
  })

  it('chỉ thẻ nhiều đoạn đang chọn được hiện; đổi thẻ thì đoạn mã ẩn hẳn và không chặn trình soạn thảo bên dưới', async () => {
    const file = { ...gnode('lib/a.dart#file', 'a.dart'), kind: 'file' as const, line_start: 1 }
    const child = { id: 1, source: '.#repository', target: file.id, type: 'CONTAINS' as const, evidence: null,
      subtype: null, confidence: 'EXTRACTED' as const, confidence_score: 1, origin: 'ast' as const }
    installNexgraph({ graph: { neighbors: vi.fn(async () => ({ nodes: [file], edges: [child], truncated: false })) } })
    render(<div style={{ width: 1000, height: 700 }}><WorkspaceScreen project={project()} /></div>)
    const item = await screen.findByRole('treeitem', { name: 'a.dart' })
    item.focus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('tab', { name: 'a.dart', selected: true })).toBeInTheDocument()
    const fileEditor = await screen.findByLabelText('editor') // lúc này mới có editor của tệp a.dart

    act(() => requestMultiBuffer({ id: 'm1', title: 'Thẻ một', excerpts: buildExcerpts([{ file: 'lib/b.dart', line: 5 }, { file: 'lib/c.dart', line: 9 }]) }))
    expect(await screen.findByRole('tab', { name: 'Thẻ một', selected: true })).toBeInTheDocument()
    act(() => requestMultiBuffer({ id: 'm2', title: 'Thẻ hai', excerpts: buildExcerpts([{ file: 'lib/d.dart', line: 2 }, { file: 'lib/e.dart', line: 6 }]) }))
    expect(await screen.findByRole('tab', { name: 'Thẻ hai', selected: true })).toBeInTheDocument()
    const pane = screen.getByRole('tabpanel', { name: 'Thẻ hai' })
    const [first, second] = Array.from(pane.querySelectorAll<HTMLElement>('.multi-buffer'))

    // jsdom không có bố cục nên không dò được phần tử nằm đè: thẻ ẩn phải là display:none thì mới không còn lớp nào đè hay chặn nhấp chuột.
    // Thẻ hai đang chọn: chỉ nó hiện và nhận được nhấp chuột; thẻ một và tệp gốc ẩn.
    expect(first).toHaveStyle({ display: 'none' })
    expect(second).toHaveStyle({ display: 'flex' })
    expect(within(first).getByLabelText('lib/b.dart:3-7')).not.toBeVisible()
    expect(within(second).getByLabelText('lib/d.dart:1-4')).toBeVisible()
    expect(fileEditor).not.toBeVisible()
    const [picked] = await within(second).findAllByLabelText('editor')
    expect(picked).toBeVisible()
    await userEvent.click(picked)
    expect(picked).toHaveFocus()

    // Chọn thẻ một: hai thẻ đổi vai.
    await userEvent.click(screen.getByRole('tab', { name: 'Thẻ một' }))
    expect(first).toHaveStyle({ display: 'flex' })
    expect(second).toHaveStyle({ display: 'none' })
    expect(within(first).getByLabelText('lib/b.dart:3-7')).toBeVisible()
    expect(within(second).getByLabelText('lib/d.dart:1-4')).not.toBeVisible()

    // Về thẻ tệp: cả hai thẻ nhiều đoạn ẩn hẳn (tiêu đề đoạn cũng biến mất), editor của tệp hiện và nhận được nhấp chuột.
    await userEvent.click(screen.getByRole('tab', { name: 'a.dart' }))
    expect(first).toHaveStyle({ display: 'none' })
    expect(second).toHaveStyle({ display: 'none' })
    expect(within(first).getByLabelText('lib/b.dart:3-7')).not.toBeVisible()
    expect(within(second).getByLabelText('lib/d.dart:1-4')).not.toBeVisible()
    expect(fileEditor).toBeVisible()
    await userEvent.click(fileEditor)
    expect(fileEditor).toHaveFocus()
  })

  it('lệnh Xem dấu trang và Mở multibuffer dựng thẻ nhiều đoạn từ dấu trang và tệp đang mở', async () => {
    const file = { ...gnode('lib/a.dart#file', 'a.dart'), kind: 'file' as const, line_start: 1 }
    const child = { id: 1, source: '.#repository', target: file.id, type: 'CONTAINS' as const, evidence: null,
      subtype: null, confidence: 'EXTRACTED' as const, confidence_score: 1, origin: 'ast' as const }
    installNexgraph({ graph: { neighbors: vi.fn(async () => ({ nodes: [file], edges: [child], truncated: false })) } })
    const demo = project({ project_id: 'p-bookmarks' }) // dự án riêng để dấu trang không dính sang test khác
    render(<div style={{ width: 1000, height: 700 }}><WorkspaceScreen project={demo} /></div>)
    const item = await screen.findByRole('treeitem', { name: 'a.dart' })
    item.focus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('tab', { name: 'a.dart', selected: true })).toBeInTheDocument()
    // Workspace đang mount nhận và xoá request ngay (getPendingMultiBuffer() luôn rỗng), nên kiểm qua thẻ đã dựng.
    const run = (id: string) => act(() => { expect(runCommand(id)).toBe(true) })

    run('editor.open_multibuffer')
    expect(await screen.findByRole('tab', { name: 'Nhiều đoạn mã', selected: true })).toBeInTheDocument()
    expect(within(screen.getByRole('tabpanel', { name: 'Nhiều đoạn mã' })).getByLabelText('lib/a.dart:1-3')).toBeInTheDocument()

    run('editor.view_bookmarks')
    expect(await screen.findByText('Không có dấu trang nào trong dự án này.')).toBeInTheDocument()

    act(() => { toggleBookmark(demo.project_id, 'lib/a.dart', 2); toggleBookmark(demo.project_id, 'lib/b.dart', 5) })
    run('editor.view_bookmarks')
    expect(await screen.findByRole('tab', { name: 'Dấu trang', selected: true })).toBeInTheDocument()
    const pane = screen.getByRole('tabpanel', { name: 'Dấu trang' })
    const marks = within(pane).getByLabelText('lib/a.dart:1-4').closest<HTMLElement>('.multi-buffer')!
    expect(within(marks).getByLabelText('lib/b.dart:3-7')).toBeInTheDocument()
    expect(await within(marks).findAllByLabelText('editor')).toHaveLength(2)
  })
})
describe('WorkspaceScreen: dock và trung tâm thông báo', () => {
  it('notify tăng badge, nút × xoá một thông báo và lệnh clear xoá hết', async () => {
    act(() => clearNotifications())
    render(<><div style={{ width: 1000, height: 700 }}><WorkspaceScreen project={project()} /></div><NotificationCenter /></>)
    const bell = screen.getByRole('button', { name: 'Thông báo' })
    expect(within(bell).queryByText('1')).not.toBeInTheDocument()
    act(() => { notify('Thông báo A'); notify('Thông báo B') })
    expect(within(bell).getByText('2')).toBeInTheDocument()
    act(() => { expect(runCommand('notifications.toggle')).toBe(true) })
    const panel = screen.getByRole('dialog', { name: 'Trung tâm thông báo' })
    expect(within(panel).getByText('Thông báo A')).toBeInTheDocument()
    await userEvent.click(within(panel).getAllByRole('button', { name: 'Đóng thông báo' })[0])
    expect(within(bell).getByText('1')).toBeInTheDocument()
    expect(screen.queryByText('Thông báo A')).not.toBeInTheDocument()
    act(() => { expect(runCommand('notification.clear')).toBe(true) })
    expect(within(bell).queryByText('1')).not.toBeInTheDocument()
    act(() => { runCommand('notifications.toggle'); clearNotifications() })
  })

  it('thao tác thật trong Workspace (Xem dấu trang) làm badge chuông tăng', async () => {
    act(() => clearNotifications())
    installNexgraph()
    render(<><div style={{ width: 1000, height: 700 }}><WorkspaceScreen project={project({ project_id: 'p-badge' })} /></div><NotificationCenter /></>)
    const bell = screen.getByRole('button', { name: 'Thông báo' })
    expect(within(bell).queryByText('1')).not.toBeInTheDocument()
    act(() => { expect(runCommand('editor.view_bookmarks')).toBe(true) })
    expect(await screen.findByText('Không có dấu trang nào trong dự án này.')).toBeInTheDocument()
    expect(within(bell).getByText('1')).toBeInTheDocument()
    act(() => { expect(runCommand('notifications.toggle')).toBe(true) })
    expect(within(screen.getByRole('dialog', { name: 'Trung tâm thông báo' })).getByText('Không có dấu trang nào trong dự án này.')).toBeInTheDocument()
    act(() => { runCommand('notifications.toggle'); clearNotifications() })
  })

  it('dock.right đổi bên phải và dock.all ẩn rồi khôi phục các bảng', async () => {
    localStorage.setItem('nexgraph.chat.dock', 'left')
    setup()
    expect(screen.queryByRole('complementary', { name: 'Trợ lý AI' })).not.toBeInTheDocument()
    act(() => { expect(runCommand('dock.right')).toBe(true) })
    await waitFor(() => expect(localStorage.getItem('nexgraph.chat.dock')).toBe('right'))
    expect(screen.getByRole('complementary', { name: 'Trợ lý AI' })).toBeVisible()
    act(() => { runCommand('dock.right') })
    expect(screen.queryByRole('complementary', { name: 'Trợ lý AI' })).not.toBeInTheDocument()
    act(() => { runCommand('dock.right'); expect(runCommand('dock.all')).toBe(true) })
    expect(screen.queryByRole('complementary', { name: 'Duyệt tệp' })).not.toBeInTheDocument()
    act(() => { expect(runCommand('dock.all')).toBe(true) })
    expect(screen.getByRole('complementary', { name: 'Duyệt tệp' })).toBeInTheDocument()
  })

  it('dock.all bỏ snapshot khi panel đổi trong lúc dock ẩn', () => {
    setup()
    expect(screen.getByRole('complementary', { name: 'Duyệt tệp' })).toBeVisible()
    act(() => { expect(runCommand('dock.all')).toBe(true) })
    expect(screen.queryByRole('complementary', { name: 'Duyệt tệp' })).toBeNull()
    act(() => { expect(runCommand('project_search.toggle')).toBe(true) })
    expect(screen.getByRole('complementary', { name: 'Tìm trong tệp' })).toBeVisible()
    act(() => { expect(runCommand('dock.all')).toBe(true) })
    expect(screen.queryByRole('complementary', { name: 'Duyệt tệp' })).toBeNull()
    expect(screen.queryByRole('complementary', { name: 'Tìm trong tệp' })).toBeNull()
    act(() => { expect(runCommand('dock.all')).toBe(true) })
    expect(screen.getByRole('complementary', { name: 'Tìm trong tệp' })).toBeVisible()
  })

  it('view.zoom_pane cũng ẩn bảng terminal', () => {
    setup()
    act(() => { expect(runCommand('terminal.toggle')).toBe(true) })
    expect(screen.getByRole('region', { name: 'Terminal' })).toBeVisible()
    act(() => { expect(runCommand('view.zoom_pane')).toBe(true) })
    expect(screen.queryByRole('region', { name: 'Terminal' })).toBeNull()
    act(() => { runCommand('view.zoom_pane') })
    expect(screen.getByRole('region', { name: 'Terminal' })).toBeVisible()
  })

  it('picker.reopen mở lại picker gần nhất: task rồi file finder', async () => {
    installNexgraph()
    Object.assign(window.nexgraph, { tasks: {
      list: vi.fn(async () => [{ label: 'build', command: 'dart build', type: 'shell' }]),
      resolve: vi.fn(async (_p: string, t: unknown) => t)
    } })
    render(<WorkspaceScreen project={project()} />)
    act(() => { expect(runCommand('task.spawn')).toBe(true) })
    expect(await screen.findByRole('dialog', { name: 'Chạy task' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Chạy task' }), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Chạy task' })).toBeNull())
    act(() => { expect(runCommand('picker.reopen')).toBe(true) })
    expect(await screen.findByRole('dialog', { name: 'Chạy task' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Chạy task' }), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Chạy task' })).toBeNull())

    act(() => { expect(runCommand('file.new')).toBe(true) })
    expect(await screen.findByRole('dialog', { name: 'Tìm tệp' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Tìm tệp' }), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tìm tệp' })).toBeNull())
    act(() => { expect(runCommand('picker.reopen')).toBe(true) })
    expect(await screen.findByRole('dialog', { name: 'Tìm tệp' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Chạy task' })).toBeNull()
  })

  it('chia đôi trên rồi sang phải đổi trục, terminal vẫn nằm ngoài khung chia đôi', async () => {
    const entries = [{ path: 'a.ts', name: 'a.ts', kind: 'file' as const }]
    installNexgraph({ fs: { list: vi.fn(async () => ({ entries, truncated: false })) } })
    render(<WorkspaceScreen project={project()} />)
    await userEvent.click(await screen.findByRole('treeitem', { name: 'a.ts' }))
    // Bấm cây mở thẻ xem trước; bấm thẻ tệp để có editor đang hoạt động (lệnh chia đôi cần tệp đang mở).
    await userEvent.click(await screen.findByRole('tab', { name: 'a.ts' }))
    const canvas = () => document.querySelector('.canvas-wrap') as HTMLElement
    expect(canvas().getAttribute('data-split')).toBeNull()

    act(() => { expect(runCommand('editor.split_up')).toBe(true) })
    expect(canvas().getAttribute('data-split')).toBe('up')
    expect(canvas().querySelectorAll('.editor-side')).toHaveLength(1)
    act(() => { expect(runCommand('terminal.toggle')).toBe(true) })
    const terminal = screen.getByRole('region', { name: 'Terminal' })

    act(() => { expect(runCommand('editor.split_right')).toBe(true) })
    expect(canvas().getAttribute('data-split')).toBe('right')
    // Terminal là anh em của khung chia đôi trong cột center, không nằm trong canvas-wrap:
    // đổi trục chia đôi không được kéo terminal theo (lỗi cũ: terminal dính trục dọc).
    expect(canvas().contains(terminal)).toBe(false)
    expect(terminal.parentElement?.classList.contains('center')).toBe(true)
    expect(canvas().querySelectorAll('.code-viewer.editor-tab')).toHaveLength(2)
  })

  it('các lệnh bố cục, tiêu điểm và chia đôi 4 hướng đều có handler', () => {
    setup()
    expect(screen.getByRole('toolbar', { name: 'Thao tác nhanh' })).toBeInTheDocument()
    for (const id of ['view.zoom_pane', 'view.centered_layout', 'focus.next_part', 'focus.previous_part',
      'picker.reopen', 'editor.split_up', 'editor.split_down', 'editor.split_left', 'editor.split_right']) {
      act(() => { expect(runCommand(id)).toBe(true) })
    }
    expect(document.querySelector('.workspace .center')).toHaveStyle({ maxWidth: '960px' })
  })
  it('file.new và file.open_recent mở bộ tìm tệp kèm danh sách gần đây', async () => {
    localStorage.setItem('nexgraph.recentFiles:p1', JSON.stringify(['lib/recent.dart']))
    installNexgraph({ fs: { files: vi.fn(async () => ({ files: ['lib/recent.dart'], truncated: false })) } })
    render(<WorkspaceScreen project={project()} />)
    act(() => { expect(runCommand('file.open_recent')).toBe(true) })
    const dialog = await screen.findByRole('dialog', { name: 'Tìm tệp' })
    expect(within(dialog).getByText('recent.dart')).toBeInTheDocument()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tìm tệp' })).toBeNull())
    act(() => { expect(runCommand('file.new')).toBe(true) })
    expect(await screen.findByRole('dialog', { name: 'Tìm tệp' })).toBeInTheDocument()
  })

  it('file.save_all lưu từng tệp đang dirty, không bỏ qua tệp còn lại khi một tệp lỗi', async () => {
    const entries = ['a.ts', 'b.ts'].map((name) => ({ path: name, name, kind: 'file' as const }))
    const read = vi.fn(async () => ({ text: 'one\n', eol: '\n' as const, bom: false, mtimeMs: 1, version: 'v1', readOnly: false }))
    const write = vi.fn(async (_pid: string, file: string) => {
      if (file === 'b.ts') throw new Error('lỗi ghi')
      return { mtimeMs: 2, version: 'v2' }
    })
    installNexgraph({ fs: { list: vi.fn(async () => ({ entries, truncated: false })), read, write } })
    render(<WorkspaceScreen project={project()} />)
    for (const name of ['a.ts', 'b.ts']) await userEvent.click(await screen.findByRole('treeitem', { name }))
    const editors = await screen.findAllByLabelText('editor')
    expect(editors).toHaveLength(2)
    fireEvent.input(editors[0], { target: { value: 'one\nx' } })
    fireEvent.input(editors[1], { target: { value: 'one\ny' } })
    await waitFor(() => expect(screen.getAllByText('Chưa lưu')).toHaveLength(2))
    act(() => { expect(runCommand('file.save_all')).toBe(true) })
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2))
    expect(write).toHaveBeenCalledWith('p1', 'a.ts', 'one\nx', expect.objectContaining({ expectedVersion: 'v1' }))
    expect(write).toHaveBeenCalledWith('p1', 'b.ts', 'one\ny', expect.objectContaining({ expectedVersion: 'v1' }))
  })

  it('file.save_as lưu bản mới, mở thẻ path mới và đóng thẻ cũ', async () => {
    const read = vi.fn(async (_pid: string, path: string) => {
      if (path === 'a.ts') return { text: 'one\n', eol: '\n' as const, bom: false, mtimeMs: 1, version: 'v1', readOnly: false }
      throw Object.assign(new Error('missing'), { code: 'file_not_found' })
    })
    const write = vi.fn(async () => ({ mtimeMs: 2, version: 'v2' }))
    installNexgraph({ fs: {
      list: vi.fn(async () => ({ entries: [{ path: 'a.ts', name: 'a.ts', kind: 'file' as const }], truncated: false })), read, write
    } })
    render(<WorkspaceScreen project={project()} />)
    await userEvent.click(await screen.findByRole('treeitem', { name: 'a.ts' }))
    fireEvent.input(await screen.findByLabelText('editor'), { target: { value: 'one\nchanged' } })
    act(() => { expect(runCommand('file.save_as')).toBe(true) })
    await userEvent.type(await screen.findByRole('combobox', { name: 'Lưu thành…' }), 'b.ts')
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('tab', { name: 'b.ts', selected: true })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'a.ts' })).toBeNull())
    expect(write).toHaveBeenCalledWith('p1', 'b.ts', 'one\nchanged', expect.objectContaining({ expectedVersion: null }))
  })

  it('workspace dựng từ shell: đúng 4 slot và registry mở được các panel cũ', async () => {
    installNexgraph()
    const view = render(<div style={{ width: 1000, height: 700 }}><WorkspaceScreen project={project()} /></div>)
    const parts = () => Array.from(view.container.querySelectorAll<HTMLElement>('.workspace-shell > [data-ws-part]')).map((el) => el.dataset.wsPart)
    expect(parts()).toEqual(['rail', 'sidebar', 'center', 'dock'])
    const rail = screen.getByRole('navigation', { name: 'Thanh hoạt động' })
    for (const entry of WORKBENCH_PANELS.filter((panel) => panel.group !== 'dock' && panel.id !== 'diagnostics')) {
      expect(within(rail).getByRole('button', { name: entry.title() })).toBeInTheDocument()
    }
    const explorer = getWorkbenchPanel('explorer')!
    expect(screen.getByRole('complementary', { name: explorer.title() })).toBeInTheDocument()
    await userEvent.click(within(rail).getByRole('button', { name: explorer.title() }))
    expect(screen.queryByRole('complementary', { name: explorer.title() })).not.toBeInTheDocument()
    await userEvent.click(within(rail).getByRole('button', { name: explorer.title() }))
    expect(screen.getByRole('complementary', { name: explorer.title() })).toBeInTheDocument()
    for (const id of ['find', 'git', 'debug', 'search', 'changes']) {
      const entry = getWorkbenchPanel(id)!
      await userEvent.click(within(rail).getByRole('button', { name: entry.title() }))
      expect(screen.getByRole('complementary', { name: entry.title() })).toBeInTheDocument()
    }
    act(() => { setChatDock('left') })
    expect(parts()).toEqual(['rail', 'dock', 'center'])
    view.unmount()
  })
})
