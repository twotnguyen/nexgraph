// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GraphNode, NodeExplain } from '@shared/graph-types'
import { installNexgraph } from '../../test-utils'
import { NodeInspector } from './NodeInspector'

const gnode = (id: string, label: string, over: Partial<GraphNode> = {}): GraphNode => ({ id, kind: 'function', label, qualified_name: label,
  language: 'python', file: 't.py', line_start: 1, line_end: 2, is_test: false, origin: 'ast', signature: null, community: null, ...over })

const target = gnode('t.py::target#function', 'target')
const explain = (over: Partial<NodeExplain> = {}): NodeExplain => ({
  node: target, degree: 26, community: { id: 'com:3', label: 'Thanh toán' },
  groups: [
    { direction: 'in', type: 'CALLS', total: 25, nodes: [gnode('a.py::a0#function', 'a0')],
      more_by_file: [{ file: 'c.py', count: 3 }, { file: 'd.py', count: 2 }] },
    { direction: 'out', type: 'CALLS', total: 1, nodes: [gnode('t.py::helper#function', 'helper')], more_by_file: [] }
  ], ...over
})

describe('NodeInspector', () => {
  it('thẻ Giải thích hiện bậc, cụm, nhóm cạnh và phần bị gom theo tệp', async () => {
    const { api } = installNexgraph({ graph: { explain: vi.fn(async () => explain()) } })
    const onOpenNode = vi.fn()
    render(<NodeInspector node={target} projectId="p1" onOpenNode={onOpenNode} />)
    expect(await screen.findByText('26 liên kết · cụm Thanh toán')).toBeInTheDocument()
    expect(api.graph.explain).toHaveBeenCalledWith('p1', 't.py::target#function')
    expect(screen.getByText('← CALLS (25)')).toBeInTheDocument()
    expect(screen.getByText('+5 trong 2 tệp: c.py (3), d.py (2)')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'helper' }))
    expect(onOpenNode).toHaveBeenCalledWith(expect.objectContaining({ id: 't.py::helper#function' }))
  })

  it('node document có nút Đọc mục, bấm thì hiện thân mục', async () => {
    const doc = gnode('docs/guide.md::Setup#document', 'Setup', { kind: 'document', file: 'docs/guide.md', language: 'markdown' })
    const section = vi.fn(async () => ({ node: doc, file: 'docs/guide.md', start: 5, end: 9, text: '## Setup\nchạy [REDACTED]', truncated: false, stale: false }))
    installNexgraph({ graph: { explain: vi.fn(async () => explain({ node: doc, groups: [], degree: 0, community: null })), section } })
    render(<NodeInspector node={doc} projectId="p1" />)
    await userEvent.click(screen.getByRole('button', { name: 'Đọc mục' }))
    expect(section).toHaveBeenCalledWith('p1', 'docs/guide.md::Setup#document')
    expect(await screen.findByText(/chạy \[REDACTED\]/)).toBeInTheDocument()
  })

  it('mục bị cắt hiện dòng nhỏ "Đã cắt bớt — mở tệp để xem đầy đủ" (UI-TRUNC)', async () => {
    const doc = gnode('docs/guide.md::Setup#document', 'Setup', { kind: 'document', file: 'docs/guide.md', language: 'markdown' })
    const section = vi.fn(async () => ({ node: doc, file: 'docs/guide.md', start: 5, end: 9, text: '## Setup', truncated: true, stale: false }))
    installNexgraph({ graph: { explain: vi.fn(async () => explain({ node: doc, groups: [], degree: 0, community: null })), section } })
    render(<NodeInspector node={doc} projectId="p1" />)
    await userEvent.click(screen.getByRole('button', { name: 'Đọc mục' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Đã cắt bớt — mở tệp để xem đầy đủ')
  })

  it('node không phải document không có nút Đọc mục', () => {
    installNexgraph({ graph: { explain: vi.fn(async () => explain()) } })
    render(<NodeInspector node={target} projectId="p1" />)
    expect(screen.queryByRole('button', { name: 'Đọc mục' })).not.toBeInTheDocument()
  })
})

describe('NodeInspector — kết quả AI (W9)', () => {
  it('nút do AI tạo có nhãn suy luận bởi AI', async () => {
    installNexgraph({ graph: { explain: vi.fn(async () => explain()) } })
    render(<NodeInspector node={gnode('README.md::Ý tưởng#concept', 'Ý tưởng', { kind: 'concept', origin: 'llm' })} projectId="p1" onOpenNode={vi.fn()} />)
    expect(await screen.findByText(/Suy luận bởi AI/)).toBeInTheDocument()
  })
})
