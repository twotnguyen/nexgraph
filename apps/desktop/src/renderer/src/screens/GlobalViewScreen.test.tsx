// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GraphNode } from '@nexgraph/contracts/graph-types'
import { installNexgraph } from '../test-utils'
import { GlobalViewScreen } from './GlobalViewScreen'

const canvas = vi.fn()
vi.mock('../components/graph/GraphCanvas', () => ({
  GraphCanvas: (props: { overlay?: { nodes: GraphNode[] } | null; highlights?: Record<string, string> }) => {
    canvas(props)
    return <div data-testid="canvas">{props.overlay?.nodes.map((n) => n.label).join(',')}</div>
  }
}))

const node = (id: string, label: string, project_id: string) => ({
  id, label, project_id, kind: 'function' as const, qualified_name: label, language: 'typescript', file: 'src/a.ts',
  line_start: 1, line_end: 2, is_test: false, origin: 'ast', signature: null, community: null
})

describe('GlobalViewScreen', () => {
  it('draws the merged graph, searches across projects and exports', async () => {
    const graph = vi.fn(async () => ({
      projects: [{ project_id: 'pa', name: 'thư viện' }, { project_id: 'pb', name: 'ứng dụng' }],
      nodes: [node('pa::add', 'add', 'pa'), node('pb::checkout', 'checkout', 'pb')],
      edges: [{ id: 1, source: 'pb::checkout', target: 'pa::add', type: 'CALLS', subtype: 'member_call', confidence: 'INFERRED' as const,
        confidence_score: 0.85, origin: 'resolver', evidence: null, cross_repo: true }],
      truncated: false, skipped: []
    }))
    const search = vi.fn(async () => [{ project_id: 'pa', project_name: 'thư viện', score: 3, node: node('add', 'add', 'pa') },
      { project_id: 'pz', project_name: 'khác', score: 2, node: node('x', 'x', 'pz') }])
    const exportFn = vi.fn(async () => ({ files: ['/tmp/nexgraph-global-graph.json'], nodes: 2, edges: 1, truncated: false, skipped: [] }))
    const { api } = installNexgraph({ globalGraph: { graph, search, export: exportFn } })
    const onBack = vi.fn()
    render(<GlobalViewScreen projectIds={['pa', 'pb']} onBack={onBack} />)
    expect(await screen.findByTestId('canvas')).toHaveTextContent('add,checkout')
    expect(graph).toHaveBeenCalledWith(['pa', 'pb'], expect.any(Number))
    expect(screen.getByRole('heading', { name: 'Xem chung' })).toBeInTheDocument()
    expect(screen.getByText(/thư viện, ứng dụng/)).toBeInTheDocument()
    expect(screen.getByText('1 cạnh liên repo')).toBeInTheDocument()

    await userEvent.type(screen.getByRole('searchbox', { name: 'Tìm trong graph chung' }), 'add{Enter}')
    expect(api.globalGraph.search).toHaveBeenCalledWith('add', expect.any(Number), ['pa', 'pb'])
    const hit = await screen.findByRole('button', { name: /add/ })
    expect(screen.queryByText('khác')).not.toBeInTheDocument() // chỉ dự án đang xem
    await userEvent.click(hit)
    await waitFor(() => expect(canvas).toHaveBeenLastCalledWith(expect.objectContaining({ highlights: { 'pa::add': 'current' } })))

    await userEvent.click(screen.getByRole('button', { name: 'Xuất graph.json gộp' }))
    expect(exportFn).toHaveBeenCalledWith(['pa', 'pb'])
    expect(await screen.findByText(/nexgraph-global-graph.json/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Dự án/ }))
    expect(onBack).toHaveBeenCalled()
  })

  it('shows the engine error instead of the canvas', async () => {
    installNexgraph({ globalGraph: { graph: vi.fn(async () => { throw new Error('hỏng') }) } })
    render(<GlobalViewScreen projectIds={['pa']} onBack={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('hỏng')
  })
})
