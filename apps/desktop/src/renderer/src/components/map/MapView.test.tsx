// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { MapEdge, MapNode, ProjectMap } from '@shared/graph-types'
import { installNexgraph } from '../../test-utils'
import { MapView } from './MapView'

vi.mock('./SigmaView', () => ({
  SigmaView: (p: { nodes: MapNode[]; edges: MapEdge[]; visibleEdges?: MapEdge[]; dimmed?: Set<string>; onNodeClick: (id: string) => void;
    onEdgeClick: (s: string, t: string) => void; onUnsupported: () => void }) => (
    <div data-testid="sigma" data-dimmed={p.dimmed?.size ?? 0}>
      {p.nodes.map((n) => <button key={n.id} type="button" onClick={() => p.onNodeClick(n.id)}>{n.label}</button>)}
      {(p.visibleEdges ?? p.edges).map((e) => <button key={e.source + e.target} data-testid="e" type="button" onClick={() => p.onEdgeClick(e.source, e.target)}>{`${e.source}>${e.target}`}</button>)}
      <button type="button" data-testid="unsupported" onClick={p.onUnsupported}>x</button>
    </div>
  )
}))

const node = (id: string, label: string, over: Partial<MapNode> = {}): MapNode =>
  ({ id, label, kind: id.startsWith('dir:') ? 'directory' : 'file', files: 1, symbols: 0, community: null, drillable: id.startsWith('dir:'), ...over })
const rootMap: ProjectMap = {
  parent: null,
  nodes: [node('dir:src', 'src', { files: 1000, symbols: 8400, community: 2 }), node('dir:app', 'app', { files: 199 }), node('file:setup.py', 'setup.py')],
  edges: [
    { source: 'dir:app', target: 'dir:src', weight: 2, types: { IMPORTS: 2 } },
    { source: 'dir:src', target: 'file:setup.py', weight: 5, types: { CALLS: 5 } }
  ],
  truncated: false,
  totals: { files: 1200, nodes: 3 }
}
const setup = (graph: Record<string, unknown> = {}) => {
  const h = installNexgraph({ graph: { map: vi.fn(async () => rootMap), ...graph } })
  const onOpenNode = vi.fn()
  const onOpenArch = vi.fn()
  render(<MapView projectId="p1" onOpenNode={onOpenNode} onOpenCode={vi.fn()} onOpenArch={onOpenArch} />)
  return { ...h, onOpenNode, onOpenArch }
}

describe('MapView', () => {
  it('tải bản đồ gốc, hiện dòng trạng thái, bấm nút thư mục hiện thẻ thông tin', async () => {
    setup()
    expect(await screen.findByText('Hiện 3 nút cho 1.200 tệp')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'src' }))
    expect(screen.getByText('1.000 tệp · 8.400 symbol')).toBeInTheDocument()
    expect(screen.getByText('Cụm 2')).toBeInTheDocument()
  })

  it('"Phóng vào" gọi map với parent, thêm breadcrumb; bấm "Gốc" quay lại', async () => {
    const { api } = setup()
    await userEvent.click(await screen.findByRole('button', { name: 'src' }))
    await userEvent.click(screen.getByRole('button', { name: 'Phóng vào' }))
    await waitFor(() => expect(api.graph.map).toHaveBeenLastCalledWith('p1', { parent: 'dir:src', detail: 400 }))
    const crumbs = screen.getByRole('navigation', { name: 'Đường dẫn bản đồ' })
    expect(crumbs).toHaveTextContent('Gốc › src')
    await userEvent.click(within(crumbs).getByRole('button', { name: 'Gốc' }))
    await waitFor(() => expect(api.graph.map).toHaveBeenLastCalledWith('p1', { parent: undefined, detail: 400 }))
  })

  it('"Mở ở Graph" gọi onOpenNode với id nút đồ thị', async () => {
    const { onOpenNode } = setup()
    await userEvent.click(await screen.findByRole('button', { name: 'src' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mở ở Graph' }))
    expect(onOpenNode).toHaveBeenLastCalledWith('src#directory')
    await userEvent.click(screen.getByRole('button', { name: 'setup.py' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mở ở Graph' }))
    expect(onOpenNode).toHaveBeenLastCalledWith('setup.py#file')
  })

  it('mở Kiến trúc với block đang chọn', async () => {
    const { onOpenArch } = setup()
    await userEvent.click(await screen.findByRole('button', { name: 'src' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mở ở Kiến trúc' }))
    expect(onOpenArch).toHaveBeenCalledWith('dir:src')
  })

  it('bấm cạnh thì lấy bằng chứng và hiện popover có tiêu đề', async () => {
    const archEvidence = vi.fn(async () => [])
    setup({ archEvidence })
    await userEvent.click((await screen.findAllByTestId('e'))[0])
    expect(archEvidence).toHaveBeenCalledWith('p1', 'dir:app', 'dir:src', 50)
    expect(await screen.findByText('app → src · 2 quan hệ')).toBeInTheDocument()
  })

  it('chỉ hiện bằng chứng của cạnh đang mở', async () => {
    let resolveFirst: (value: []) => void = () => {}
    let resolveSecond: (value: []) => void = () => {}
    const archEvidence = vi.fn(() => archEvidence.mock.calls.length === 1
      ? new Promise<[]>((resolve) => { resolveFirst = resolve })
      : new Promise<[]>((resolve) => { resolveSecond = resolve }))
    setup({ archEvidence })
    const edges = await screen.findAllByTestId('e')
    await userEvent.click(edges[0])
    await userEvent.click(edges[1])
    resolveFirst([])

    await waitFor(() => expect(screen.getByText('Đang tải…')).toBeInTheDocument())
    expect(screen.getByText('src → setup.py · 5 quan hệ')).toBeInTheDocument()
    resolveSecond([])
  })

  it('tắt IMPORTS thì cạnh chỉ có IMPORTS biến mất; kéo trọng số tối thiểu lọc cạnh nhẹ', async () => {
    setup()
    expect(await screen.findAllByTestId('e')).toHaveLength(2)
    await userEvent.click(screen.getByRole('checkbox', { name: /IMPORTS/ }))
    expect(screen.getAllByTestId('e')).toHaveLength(1)
    await userEvent.click(screen.getByRole('checkbox', { name: /IMPORTS/ }))
    const slider = screen.getByLabelText('Trọng số tối thiểu')
    fireEvent.change(slider, { target: { value: '4' } })   // bỏ cạnh trọng số 2
    expect(screen.getAllByTestId('e')).toHaveLength(1)
  })

  it('huy hiệu vòng phụ thuộc: bấm hiện danh sách, chọn một vòng thì làm mờ nút không chứa tệp trong vòng', async () => {
    setup({ cycles: vi.fn(async () => ({ cycles: [{ files: ['src/a.py', 'src/b.py'], size: 2 }], total: 1 })) })
    await userEvent.click(await screen.findByRole('button', { name: '1 vòng phụ thuộc' }))
    await userEvent.click(screen.getByRole('button', { name: /2 tệp import vòng/ }))
    expect(screen.getByTestId('sigma').dataset.dimmed).toBe('2')   // 3 nút − 1 (src)
  })

  it('không có vòng: huy hiệu không hiện; bản đồ bị cắt hiện "Đã lược bớt cạnh nhẹ nhất"', async () => {
    setup({ map: vi.fn(async () => ({ ...rootMap, truncated: true })) })
    expect(await screen.findByText(/Đã lược bớt cạnh nhẹ nhất/)).toBeInTheDocument()
    expect(screen.queryByText(/vòng phụ thuộc/)).toBeNull()
  })

  it('SigmaView báo không hỗ trợ thì hiện câu noWebgl', async () => {
    setup()
    await userEvent.click(await screen.findByTestId('unsupported'))
    expect(await screen.findByRole('alert')).toHaveTextContent('không bật được WebGL')
  })

  it('dự án rỗng hiện câu empty; lỗi tải hiện role=alert', async () => {
    setup({ map: vi.fn(async () => ({ ...rootMap, nodes: [], edges: [], totals: { files: 0, nodes: 0 } })) })
    expect(await screen.findByText('Dự án chưa có tệp nào được lập chỉ mục.')).toBeInTheDocument()
  })

  it('lỗi tải hiện role=alert với message của lỗi', async () => {
    setup({ map: vi.fn(async () => { throw { code: 'not_indexed', message: 'Chưa lập chỉ mục' } }) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa lập chỉ mục')
  })
})
