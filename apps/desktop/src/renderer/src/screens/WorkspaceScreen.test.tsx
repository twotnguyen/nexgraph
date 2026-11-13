// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { GraphNode, Neighborhood } from '@shared/graph-types'
import { emptyChanges, installNexgraph, project } from '../test-utils'

vi.mock('../services/elkLayoutService', async () => ({
  layoutGraph: async (nodes: { id: string }[]) => Object.fromEntries(nodes.map((n, i) => [n.id, { x: i * 220, y: 0 }]))
}))

import { WorkspaceScreen } from './WorkspaceScreen'

beforeAll(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  vi.stubGlobal('ResizeObserver', RO)
  vi.stubGlobal('DOMMatrixReadOnly', class { m22 = 1; constructor() {} })
})

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
  installNexgraph({ graph: { neighbors, search } })
  render(<div style={{ width: 1000, height: 700 }}><WorkspaceScreen project={project()} /></div>)
  return { neighbors, search }
}

describe('WorkspaceScreen', () => {
  it('Ctrl+L bật/tắt cột trợ lý AI', async () => {
    setup()
    expect(screen.queryByRole('complementary', { name: 'Trợ lý AI' })).toBeNull()
    await userEvent.keyboard('{Control>}l{/Control}')
    expect(await screen.findByRole('complementary', { name: 'Trợ lý AI' })).toBeInTheDocument()
    await userEvent.keyboard('{Control>}l{/Control}')
    expect(screen.queryByRole('complementary', { name: 'Trợ lý AI' })).toBeNull()
  })

  it('mục Tham quan của thanh hoạt động mở panel và nạp chuyến tham quan', async () => {
    const tour = vi.fn(async () => ({ steps: [] }))
    installNexgraph({ graph: { tour } })
    render(<div style={{ width: 1000, height: 700 }}><WorkspaceScreen project={project()} /></div>)
    await userEvent.click(screen.getByRole('button', { name: 'Tham quan' }))
    expect(tour).toHaveBeenCalledWith('p1')
    expect(await screen.findByText(/Chưa đủ dữ liệu/)).toBeInTheDocument()
  })

  it('starts on the Kiến trúc tab with the search panel open', () => {
    setup()
    expect(screen.getByRole('tab', { name: 'Kiến trúc', selected: true })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Graph', selected: false })).toBeInTheDocument()
    expect(screen.getByLabelText('Tìm kiếm', { selector: 'input' })).toBeInTheDocument()
  })

  it('toggles the search panel from the activity bar', async () => {
    setup()
    const btn = screen.getByRole('button', { name: 'Tìm kiếm' })
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(btn)
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByLabelText('Tìm kiếm', { selector: 'input' })).not.toBeInTheDocument()
    await userEvent.click(btn)
    expect(screen.getByLabelText('Tìm kiếm', { selector: 'input' })).toBeInTheDocument()
  })

  it('opening a search result switches to the Graph tab centred on that node', async () => {
    const { neighbors } = setup()
    await userEvent.type(screen.getByLabelText('Tìm kiếm', { selector: 'input' }), 'login')
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
    expect(api.watch.start).toHaveBeenCalledWith('p1', '/Đồ án/demo')
    unmount()
    expect(api.watch.stop).toHaveBeenCalledWith('p1')
  })

  it('opens the Thay đổi panel and jumps to the Graph tab with the node highlighted', async () => {
    const neighbors = vi.fn(async (_p: string, q: { node: string }) => ({ nodes: [gnode(q.node, 'build')], edges: [], truncated: false }))
    const { api } = installNexgraph({ graph: { changes: vi.fn(async () => changes), neighbors } })
    render(<div style={{ width: 1000, height: 700 }}><WorkspaceScreen project={project()} /></div>)
    await userEvent.click(screen.getByRole('button', { name: 'Thay đổi' }))
    const impacted = await screen.findByRole('region', { name: 'Vùng ảnh hưởng' })
    expect(api.graph.changes).toHaveBeenCalled()
    await userEvent.click(within(impacted).getByRole('button', { name: /build/ }))
    expect(screen.getByRole('tab', { name: 'Graph', selected: true })).toBeInTheDocument()
    await waitFor(() => expect(neighbors).toHaveBeenCalledWith('p1', expect.objectContaining({ node: 'lib/b.dart::build#method' })))
    expect(await screen.findByText('ảnh hưởng')).toBeInTheDocument()
  })
})

describe('WorkspaceScreen: code viewer tabs', () => {
  const slice = { file: 'lib/a.dart', start: 1, end: 3, text: 'one\ntwo\nthree', language: 'dart', stale: false }

  async function openFromSearch() {
    const code = vi.fn(async () => slice)
    const neighbors = vi.fn(async (_p: string, q: { node: string }) => hood(q.node))
    const search = vi.fn(async () => [{ node: gnode('lib/a.dart::AuthService.login#method', 'login'), score: 2 }])
    const { api } = installNexgraph({ graph: { code, neighbors, search } })
    render(<div style={{ width: 1000, height: 700 }}><WorkspaceScreen project={project()} /></div>)
    await userEvent.type(screen.getByLabelText('Tìm kiếm', { selector: 'input' }), 'login')
    await userEvent.click(await screen.findByText('login'))
    await userEvent.click(await screen.findByRole('button', { name: 'Mở mã' }))
    return { api, code }
  }

  it('opens a file tab from the inspector, once per file, and closes back to the previous tab', async () => {
    const { code } = await openFromSearch()
    expect(await screen.findByRole('tab', { name: 'a.dart', selected: true })).toBeInTheDocument()
    expect(code).toHaveBeenCalledWith('p1', 'lib/a.dart', 1)
    await screen.findByText('two')
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
    const code = vi.fn(async () => slice)
    installNexgraph({ graph: {
      code,
      architecture: vi.fn(async () => ({ parent: null, links: [{ from: 'dir:lib', to: 'dir:test', count: 1, types: { CALLS: 1 } }],
        blocks: [{ id: 'dir:lib', label: 'lib', kind: 'directory' as const, size: 1, symbols: 1, drillable: true },
                 { id: 'dir:test', label: 'test', kind: 'directory' as const, size: 1, symbols: 1, drillable: true }] })),
      archEvidence: vi.fn(async () => evidence)
    } })
    render(<div style={{ width: 1000, height: 700 }}><WorkspaceScreen project={project()} /></div>)
    await userEvent.click(await screen.findByRole('button', { name: /lib → test/ }))
    await userEvent.click(await screen.findByRole('button', { name: /lib\/a\.dart:2/ }))
    expect(await screen.findByRole('tab', { name: 'a.dart', selected: true })).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('[data-line="2"][data-highlight="true"]')).toBeTruthy())
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
    await userEvent.type(screen.getByLabelText('Tìm kiếm', { selector: 'input' }), 'run')
    fireEvent.click(await screen.findByRole('button', { name: /run/ }))
    const nodeLabel = await within(await flowEl()).findByText('run')
    fireEvent.contextMenu(nodeLabel)
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Tìm đường tới…' }))
    expect(screen.getByRole('status', { name: 'Chế độ chọn đích' })).toHaveTextContent('Bấm node đích')
    const box = screen.getByLabelText('Tìm kiếm', { selector: 'input' })
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
    await userEvent.type(screen.getByLabelText('Tìm kiếm', { selector: 'input' }), 'run')
    fireEvent.click(await screen.findByRole('button', { name: /run/ }))
    const flow = await flowEl()
    fireEvent.contextMenu(await within(flow).findByText('run'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Vùng ảnh hưởng nếu sửa' }))
    expect(impactOf).toHaveBeenCalledWith('p1', a.id)
    expect(await screen.findByText('Ảnh hưởng nếu sửa run')).toBeInTheDocument()
    await waitFor(() => expect(within(flow).getByText('ảnh hưởng')).toBeInTheDocument())
  })

  it('tab Báo cáo: câu hỏi gợi ý chạy Hỏi graph và chuyển sang Graph; Xuất Markdown chọn sẵn markdown', async () => {
    const a = gnode('lib/a.dart::A.run#method', 'run')
    const ask = vi.fn(async () => ({ seeds: [a], nodes: [a], edges: [], truncated: false }))
    const report = vi.fn(async () => ({ god_nodes: [], communities: [], surprising: [], benchmark: null, truncated: false,
      questions: [{ question: 'run làm gì?', why: '' }] }))
    installNexgraph({ graph: { ask, report, neighbors: vi.fn() } })
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
    const report = vi.fn(async () => ({ god_nodes: [], communities: [], surprising: [], benchmark: null, truncated: false,
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
