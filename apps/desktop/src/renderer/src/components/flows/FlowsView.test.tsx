// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { FlowDetail, FlowList, GraphNode } from '@shared/graph-types'
import { installNexgraph } from '../../test-utils'
import { FlowsView } from './FlowsView'

vi.mock('../graph/GraphCanvas', () => ({
  GraphCanvas: ({ overlay, highlights }: { overlay?: { nodes: GraphNode[] }; highlights?: Record<string, string> }) => (
    <div
      data-testid="canvas"
      data-nodes={overlay?.nodes.length ?? 0}
      data-current={Object.entries(highlights ?? {}).find(([, v]) => v === 'current')?.[0]}
    />
  )
}))

const node = (id: string, label = id): GraphNode => ({
  id,
  kind: 'function',
  label,
  qualified_name: label,
  language: 'python',
  file: 'app.py',
  line_start: 1,
  line_end: 10,
  is_test: false,
  origin: 'ast',
  signature: null,
  community: null
})

const list: FlowList = {
  flows: [
    {
      id: 7,
      name: 'login',
      kind: 'route',
      detail: 'app.post("/auth/login")',
      entry: node('app.py::login#function', 'login'),
      steps: 3,
      files: 2,
      depth: 2,
      criticality: 0.8,
      truncated: false
    }
  ],
  total: 1,
  truncated: false
}

const detail: FlowDetail = {
  flow: list.flows[0],
  steps: [
    { order: 0, depth: 0, node: node('app.py::login#function', 'login'), caller: null, line: null },
    {
      order: 1,
      depth: 1,
      node: { ...node('service.py::login_user#function', 'login_user'), file: 'service.py', line_start: 4, line_end: 7 },
      caller: 'app.py::login#function',
      line: 9
    },
    {
      order: 2,
      depth: 2,
      node: { ...node('repo.py::find_user#function', 'find_user'), file: 'repo.py', line_start: 2, line_end: 4 },
      caller: 'service.py::login_user#function',
      line: 5
    }
  ]
}

const slice = { file: 'service.py', start: 2, end: 10, text: 'def login_user(): pass', language: 'python', stale: false }

describe('FlowsView', () => {
  it('liệt kê luồng, chọn một luồng thì vẽ đúng bước và tô bước hiện tại', async () => {
    const onOpenCode = vi.fn()
    const { api } = installNexgraph({
      graph: {
        flows: vi.fn(async () => list),
        flow: vi.fn(async () => detail),
        code: vi.fn(async () => slice)
      }
    })
    render(<FlowsView projectId="p1" onOpenCode={onOpenCode} onOpenNode={() => {}} />)
    expect(await screen.findByText('Chọn một luồng ở danh sách bên trái.')).toBeInTheDocument()

    await userEvent.click(await screen.findByRole('button', { name: /login/ }))
    expect(api.graph.flow).toHaveBeenCalledWith('p1', 7)

    const canvas = await screen.findByTestId('canvas')
    expect(canvas.dataset.nodes).toBe('3')
    expect(canvas.dataset.current).toBe('app.py::login#function')

    await userEvent.click(screen.getByRole('button', { name: 'Sau' }))
    expect(screen.getByTestId('canvas').dataset.current).toBe('service.py::login_user#function')
    expect(screen.getByText(/được gọi từ login, dòng 9/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Mở tệp' }))
    expect(onOpenCode).toHaveBeenCalledWith('service.py', 4, 7)
  })

  it('lỗi tải luồng hiện role=alert với message của lỗi', async () => {
    installNexgraph({
      graph: {
        flows: vi.fn(async () => {
          throw new Error('Không có mạng')
        })
      }
    })
    render(<FlowsView projectId="p1" onOpenCode={() => {}} onOpenNode={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Không có mạng')
  })
})
