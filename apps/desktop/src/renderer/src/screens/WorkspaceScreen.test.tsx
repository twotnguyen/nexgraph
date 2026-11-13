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
const hood = (center: string): Neighborhood => ({ nodes: [gnode(center, 'login')], edges: [], truncated: false })

function setup() {
  const neighbors = vi.fn(async (_p: string, q: { node: string }) => hood(q.node))
  const search = vi.fn(async () => [{ node: gnode('lib/a.dart::AuthService.login#method', 'login'), score: 2 }])
  installNexgraph({ graph: { neighbors, search } })
  render(<div style={{ width: 1000, height: 700 }}><WorkspaceScreen project={project()} /></div>)
  return { neighbors, search }
}

describe('WorkspaceScreen', () => {
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
})
