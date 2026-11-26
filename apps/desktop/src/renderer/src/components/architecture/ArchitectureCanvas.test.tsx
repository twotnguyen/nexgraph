// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { NexGraphApi } from '@nexgraph/contracts/api'
import type { ArchEvidence, ArchView } from '@nexgraph/contracts/graph-types'
import { installNexgraph } from '../../test-utils'
import { setLocale } from '../../state/locale'

afterEach(() => setLocale('vi'))

vi.mock('../../services/elkLayoutService', async () => ({
  layoutDiagram: async (nodes: { id: string }[]) => ({ pos: Object.fromEntries(nodes.map((n, i) => [n.id, { x: i * 220, y: 0 }])), routes: {} })
}))

import { ArchitectureCanvas } from './ArchitectureCanvas'

beforeAll(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  vi.stubGlobal('ResizeObserver', RO)
  vi.stubGlobal('DOMMatrixReadOnly', class { m22 = 1; constructor() {} })
})

const block = (id: string, label: string, kind: ArchView['blocks'][number]['kind'] = 'directory', size = 3) =>
  ({ id, label, kind, size, symbols: size * 4, drillable: kind !== 'file' })
const ROOT: ArchView = {
  parent: null,
  blocks: [block('dir:lib', 'lib', 'directory', 8), block('dir:test', 'test', 'directory', 1),
           block('file:lib/a.dart', 'a.dart', 'file', 1), block('more:', 'Khác (9 mục)', 'group', 18)],
  links: [{ from: 'dir:test', to: 'dir:lib', count: 3, types: { CALLS: 2, IMPORTS: 1 } },
          { from: 'dir:lib', to: 'file:lib/a.dart', count: 1, types: { IMPORTS: 1 } }]
}
const CHILD = (id: string): ArchView => ({ parent: { id, label: id.split('/').pop()! }, blocks: [block('file:lib/x.dart', 'x.dart', 'file', 1)], links: [] })
const ev = (line: number): ArchEvidence => ({ file: 'lib/a.dart', line, edge: { id: line, source: 'lib/a.dart::A.run#method', target: 'lib/b.dart#file',
  type: 'CALLS', subtype: null, confidence: 'INFERRED', confidence_score: 0.9, origin: 'resolver', evidence: { file: 'lib/a.dart', line, col: 0 } } })

function setup(over: Partial<NexGraphApi['graph']> = {}, onParentChange?: (parent?: string) => void) {
  const architecture = vi.fn(async (_p: string, parent?: string) => (parent ? CHILD(parent) : ROOT))
  const archEvidence = vi.fn(async () => [ev(12), ev(30)])
  installNexgraph({ graph: { architecture, archEvidence, ...over } })
  const onOpenNode = vi.fn()
  render(<div style={{ width: 900, height: 600 }}><ArchitectureCanvas projectId="p1" onOpenNode={onOpenNode} onParentChange={onParentChange} /></div>)
  return { architecture, archEvidence, onOpenNode }
}
const nodeByText = (text: string) => screen.getByText(text, { selector: '.react-flow__node b' })

describe('ArchitectureCanvas', () => {
  it('hiện attribution của React Flow đúng giấy phép', async () => {
    setup()
    await screen.findByText('lib', { selector: '.react-flow__node b' })
    const attribution = document.querySelector('.react-flow__attribution')
    expect(attribution).not.toBeNull()
    expect(attribution).toHaveTextContent('React Flow')
  })

  it('mở tệp từ bản đồ tại thư mục chứa và chọn đúng khối tệp', async () => {
    const architecture = vi.fn(async () => CHILD('dir:lib'))
    installNexgraph({ graph: { architecture } })
    render(<ArchitectureCanvas projectId="p1" initialParent="file:lib/x.dart" onOpenNode={() => {}} />)
    await screen.findByText('x.dart', { selector: '.react-flow__node b' })
    expect(architecture).toHaveBeenCalledWith('p1', 'dir:lib')
    expect(nodeByText('x.dart').closest('.react-flow__node')).toHaveClass('selected')
  })

  it('renders one node per block, the legend, and one relation per link with its count', async () => {
    setup()
    await waitFor(() => expect(document.querySelectorAll('.react-flow__node')).toHaveLength(4))
    expect(screen.getByText('Mũi tên = quan hệ có thật trong code')).toBeInTheDocument()
    expect(screen.getByText('Số trên mũi tên = số bằng chứng')).toBeInTheDocument()
    const rel = screen.getByRole('list', { name: 'Quan hệ giữa các khối' })
    expect(within(rel).getAllByRole('button')).toHaveLength(2)
    expect(within(rel).getByRole('button', { name: /test.*lib/ })).toHaveTextContent('3')
    expect(screen.getByText('8 tệp')).toBeInTheDocument()
  })

  it('drills into a directory block, extends the breadcrumb and can go back', async () => {
    const onParentChange = vi.fn()
    const { architecture } = setup({}, onParentChange)
    await waitFor(() => expect(document.querySelectorAll('.react-flow__node')).toHaveLength(4))
    fireEvent.click(nodeByText('lib'))
    await waitFor(() => expect(architecture).toHaveBeenLastCalledWith('p1', 'dir:lib'))
    expect(onParentChange).toHaveBeenLastCalledWith('dir:lib')
    const crumbs = screen.getByRole('navigation', { name: 'Đường dẫn khối' })
    await waitFor(() => expect(within(crumbs).getAllByRole('button')).toHaveLength(2))
    await userEvent.click(within(crumbs).getByRole('button', { name: 'Dự án' }))
    await waitFor(() => expect(architecture).toHaveBeenLastCalledWith('p1', undefined))
    expect(onParentChange).toHaveBeenLastCalledWith(undefined)
    expect(within(crumbs).getAllByRole('button')).toHaveLength(1)
  })

  it('opens the file node for a file block instead of drilling', async () => {
    const { architecture, onOpenNode } = setup()
    await waitFor(() => expect(document.querySelectorAll('.react-flow__node')).toHaveLength(4))
    fireEvent.click(nodeByText('a.dart'))
    expect(onOpenNode).toHaveBeenCalledWith('lib/a.dart#file')
    expect(architecture).toHaveBeenCalledTimes(1)
  })

  it('drills into a "Khác" group block', async () => {
    const { architecture } = setup()
    await waitFor(() => expect(document.querySelectorAll('.react-flow__node')).toHaveLength(4))
    fireEvent.click(nodeByText('Khác (9 mục)'))
    await waitFor(() => expect(architecture).toHaveBeenLastCalledWith('p1', 'more:'))
  })

  it('opens the evidence popover for a relation and opens a node from it', async () => {
    const { archEvidence, onOpenNode } = setup()
    const rel = await screen.findByRole('list', { name: 'Quan hệ giữa các khối' })
    await userEvent.click(within(rel).getByRole('button', { name: /test.*lib/ }))
    expect(archEvidence).toHaveBeenCalledWith('p1', 'dir:test', 'dir:lib', 50)
    const dialog = await screen.findByRole('dialog', { name: 'Bằng chứng' })
    expect(within(dialog).getByRole('button', { name: /lib\/a\.dart:12/ })).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: /lib\/a\.dart:30/ }))
    expect(onOpenNode).toHaveBeenCalledWith('lib/a.dart::A.run#method')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows a hint when there are no blocks', async () => {
    setup({ architecture: vi.fn(async () => ({ parent: null, blocks: [], links: [] })) })
    expect(await screen.findByText('Chưa có dữ liệu, hãy lập chỉ mục')).toBeInTheDocument()
  })

  it('shows engine errors instead of a blank screen', async () => {
    setup({ architecture: vi.fn(async () => { throw Object.assign(new Error('Không có khối dir:x'), { code: 'unknown_block' }) }) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Không có khối dir:x')
  })

  it('shows evidence errors inside the popover', async () => {
    setup({ archEvidence: vi.fn(async () => { throw Object.assign(new Error('Không có khối'), { code: 'unknown_block' }) }) })
    const rel = await screen.findByRole('list', { name: 'Quan hệ giữa các khối' })
    await userEvent.click(within(rel).getAllByRole('button')[0])
    expect(await within(await screen.findByRole('dialog')).findByRole('alert')).toHaveTextContent('Không có khối')
  })

  it('đổi ngôn ngữ áp dụng ngay cho breadcrumb và phụ đề số tệp, không gọi lại engine', async () => {
    const { architecture } = setup()
    expect(await screen.findByText('8 tệp')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Đường dẫn khối' })).toHaveTextContent('Dự án')
    act(() => setLocale('en'))
    expect(await screen.findByText('8 files')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Block path' })).toHaveTextContent('Project')
    expect(architecture).toHaveBeenCalledTimes(1)
    act(() => setLocale('vi'))
    expect(await screen.findByText('8 tệp')).toBeInTheDocument()
  })

  it('breadcrumb đã drill giữ tên thư mục khi đổi ngôn ngữ', async () => {
    setup()
    await waitFor(() => expect(document.querySelectorAll('.react-flow__node')).toHaveLength(4))
    fireEvent.click(nodeByText('lib'))
    const crumbs = await screen.findByRole('navigation', { name: 'Đường dẫn khối' })
    await waitFor(() => expect(within(crumbs).getAllByRole('button')).toHaveLength(2))
    act(() => setLocale('en'))
    expect(screen.getByRole('navigation', { name: 'Block path' })).toHaveTextContent('Project › lib')
  })
})
