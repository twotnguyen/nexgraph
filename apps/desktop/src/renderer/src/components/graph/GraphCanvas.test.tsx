// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { NexGraphApi } from '@shared/api'
import type { GraphNode, Neighborhood } from '@shared/graph-types'
import { installNexgraph } from '../../test-utils'
import { setLocale, useLocale } from '../../state/locale'

afterEach(() => setLocale('vi'))

/** App thật đăng ký useLocale rồi dựng lại canvas trong render của nó; test lẻ dùng render-prop để giống. */
function LocaleHost({ render }: { render: () => ReactNode }) {
  useLocale()
  return <>{render()}</>
}

vi.mock('../../services/elkLayoutService', async () => ({
  layoutDiagram: async (nodes: { id: string }[]) => ({ pos: Object.fromEntries(nodes.map((n, i) => [n.id, { x: i * 220, y: 0 }])), routes: {} })
}))

import { GraphCanvas } from './GraphCanvas'
import { NodeInspector } from './NodeInspector'

beforeAll(() => {
  // React Flow cần các API của trình duyệt mà jsdom không có.
  class RO { observe() {} unobserve() {} disconnect() {} }
  vi.stubGlobal('ResizeObserver', RO)
  vi.stubGlobal('DOMMatrixReadOnly', class { m22 = 1; constructor() {} })
})

const gnode = (id: string, over: Partial<GraphNode> = {}): GraphNode => ({
  id, kind: 'class', label: id, qualified_name: id, language: 'dart', file: 'lib/a.dart', line_start: 3, line_end: 9,
  is_test: false, origin: 'ast', signature: null, community: null, ...over
})
const hood = (ids: string[], truncated = false): Neighborhood => ({
  nodes: ids.map((i) => gnode(i)),
  edges: ids.slice(1).map((t, i) => ({ id: i + 1, source: ids[0], target: t, type: 'CALLS', subtype: null, confidence: 'INFERRED' as const,
    confidence_score: 0.9, origin: 'resolver', evidence: { file: 'lib/a.dart', line: 4, col: 0 } })),
  truncated
})

const renderCanvas = (neighbors: NexGraphApi['graph']['neighbors'], onSelect = vi.fn()) => {
  installNexgraph({ graph: { neighbors } })
  render(<div style={{ width: 800, height: 600 }}><GraphCanvas projectId="p1" startNodeId=".#repository" onSelect={onSelect} /></div>)
  return onSelect
}

describe('GraphCanvas', () => {
  it('renders one React Flow node per neighbor', async () => {
    renderCanvas(vi.fn(async () => hood(['.#repository', 'a', 'b', 'c', 'd'])))
    await waitFor(() => expect(document.querySelectorAll('.react-flow__node')).toHaveLength(5))
  })

  it('re-centres on the clicked node and reports the selection', async () => {
    const neighbors = vi.fn(async (_p: string, q: { node: string }) => hood([q.node, 'x', 'y']))
    const onSelect = renderCanvas(neighbors)
    await screen.findByText('x')
    fireEvent.click(screen.getByText('x')) // userEvent gửi mousedown mà d3-zoom của React Flow không chạy được trong jsdom
    await waitFor(() => expect(neighbors).toHaveBeenLastCalledWith('p1', expect.objectContaining({ node: 'x', depth: 1, limit: 2000 })))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'x' }))
  })

  it('shows a notice when the neighborhood was truncated', async () => {
    renderCanvas(vi.fn(async () => hood(['.#repository', 'a'], true)))
    expect(await screen.findByText(/Đã cắt bớt/)).toHaveAttribute('role', 'status')
  })
  it('shows total count when truncated with total', async () => {
    renderCanvas(vi.fn(async () => ({ ...hood(['.#repository', 'a'], true), total: 12345 })))
    expect(await screen.findByText(/12345/)).toHaveAttribute('role', 'status')
  })

  it('shows a message instead of a blank screen when the node is unknown', async () => {
    renderCanvas(vi.fn(async () => { throw Object.assign(new Error('Không có nút'), { code: 'unknown_node' }) }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Không có nút')
  })

  it('goes back to the root with "Về gốc"', async () => {
    const neighbors = vi.fn(async (_p: string, q: { node: string }) => hood([q.node, 'x']))
    renderCanvas(neighbors)
    fireEvent.click(await screen.findByText('x'))
    await userEvent.click(screen.getByRole('button', { name: 'Về gốc' }))
    await waitFor(() => expect(neighbors).toHaveBeenLastCalledWith('p1', expect.objectContaining({ node: '.#repository' })))
  })

  it('đổi ngôn ngữ áp dụng ngay cho nút trên toolbar', async () => {
    installNexgraph({ graph: { neighbors: vi.fn(async () => hood(['.#repository', 'a'])) } })
    render(<div style={{ width: 800, height: 600 }}><LocaleHost render={() => <GraphCanvas projectId="p1" startNodeId=".#repository" />} /></div>)
    expect(await screen.findByRole('button', { name: 'Về gốc' })).toBeInTheDocument()
    act(() => setLocale('en'))
    expect(await screen.findByRole('button', { name: 'Back to root' })).toBeInTheDocument()
  })
})

describe('NodeInspector', () => {
  it('shows file and line range of the selected node', () => {
    render(<NodeInspector node={gnode('lib/a.dart::A#class', { label: 'A', signature: 'class A' })} />)
    expect(screen.getByText('lib/a.dart:3–9')).toBeInTheDocument()
    expect(screen.getByText('class')).toBeInTheDocument()
    expect(screen.getByText('class A')).toBeInTheDocument()
  })

  it('shows nothing selected message when node is null', () => {
    render(<NodeInspector node={null} />)
    expect(screen.getByText('Chọn một nút để xem chi tiết')).toBeInTheDocument()
  })
})

describe('GraphCanvas highlights', () => {
  const renderWith = (highlights?: Record<string, 'changed' | 'impacted' | 'test' | 'gap'>) => {
    installNexgraph({ graph: { neighbors: vi.fn(async () => hood(['.#repository', 'a', 'b', 'c', 'd'])) } })
    render(<div style={{ width: 800, height: 600 }}><GraphCanvas projectId="p1" startNodeId=".#repository" highlights={highlights} /></div>)
  }
  const nodeEl = (label: string) => screen.getByText(label).closest('.react-flow__node') as HTMLElement
  // Màu của nút tròn nằm ở biến --node-c (tô nền và viền hình tròn).
  const colorOf = (label: string) => (nodeEl(label).querySelector('.dot-node') as HTMLElement).style.getPropertyValue('--node-c')

  it('tags and colours highlighted nodes by meaning', async () => {
    renderWith({ a: 'changed', b: 'impacted', c: 'test', d: 'gap' })
    await screen.findByText('a')
    expect(colorOf('a')).toBe('var(--orange)')
    expect(within(nodeEl('a')).getByText('đã đổi')).toBeInTheDocument()
    expect(within(nodeEl('b')).getByText('ảnh hưởng')).toBeInTheDocument()
    expect(colorOf('c')).toBe('var(--green)')
    expect(within(nodeEl('c')).getByText('test')).toBeInTheDocument()
    expect(colorOf('d')).toBe('var(--color-error-red)')
    expect(within(nodeEl('d')).getByText('chưa có test')).toBeInTheDocument()
  })

  it('leaves the look unchanged without highlights', async () => {
    renderWith()
    await screen.findByText('a')
    expect(colorOf('a')).toBe('var(--blue)')
    expect(document.querySelectorAll('.tag')).toHaveLength(0)
  })
})

describe('kindStyle cho tài liệu', () => {
  it('nút document và concept có màu riêng', async () => {
    const { kindStyle } = await import('./kindStyle')
    expect(kindStyle('document').color).toBe('var(--amber)')
    expect(kindStyle('concept').color).toBe('var(--amber)')
  })
})
