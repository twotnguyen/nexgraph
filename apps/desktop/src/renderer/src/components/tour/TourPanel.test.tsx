// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GraphNode, TourStep } from '@shared/graph-types'
import { installNexgraph } from '../../test-utils'
import { TourPanel } from './TourPanel'

const node = (id: string): GraphNode => ({ id, kind: 'file', label: id, qualified_name: id, language: null, file: id, line_start: null, line_end: null,
  is_test: false, origin: 'ast', signature: null, community: null })
const steps: TourStep[] = [
  { order: 1, kind: 'entry', title: 'Điểm khởi động', body: 'main bắt đầu', node: node('a.py#file'), flow_id: 7, block_id: null },
  { order: 2, kind: 'community', title: 'Cụm lõi', body: '3 tệp', node: node('b.py#file'), flow_id: null, block_id: 'com:3' },
  { order: 3, kind: 'hub', title: 'Điểm nóng: f', body: '5 nơi gọi', node: node('c.py::f#function'), flow_id: null, block_id: null }
]
const handlers = () => ({ onOpenFlow: vi.fn(), onOpenNode: vi.fn(), onOpenArch: vi.fn() })
const setup = (tour: (p: string) => Promise<{ steps: TourStep[] }>) => {
  installNexgraph({ graph: { tour } })
  const h = handlers()
  render(<TourPanel projectId="p1" projectName="demo" {...h} />)
  return h
}

describe('TourPanel', () => {
  it('hiện tiêu đề, các bước; bước đầu là bước hiện tại và mở luồng của nó', async () => {
    const h = setup(vi.fn(async () => ({ steps })))
    expect(await screen.findByText('Tham quan demo · 3 bước')).toBeInTheDocument()
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Điểm khởi động')
    expect(h.onOpenFlow).toHaveBeenCalledWith(7)
  })

  it('"Bước sau" chuyển bước và mở đúng đích; bước cuối đổi nút thành "Xem lại từ đầu"', async () => {
    const h = setup(vi.fn(async () => ({ steps })))
    await userEvent.click(await screen.findByRole('button', { name: 'Bước sau' }))
    expect(h.onOpenArch).toHaveBeenCalledWith('com:3')
    await userEvent.click(screen.getByRole('button', { name: 'Bước sau' }))
    expect(h.onOpenNode).toHaveBeenCalledWith('c.py::f#function')
    await userEvent.click(screen.getByRole('button', { name: 'Xem lại từ đầu' }))
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Điểm khởi động')
  })

  it('bấm thẳng vào một bước thì nhảy tới bước đó; "Bước trước" bị vô hiệu ở bước 1', async () => {
    const h = setup(vi.fn(async () => ({ steps })))
    await screen.findByText('Tham quan demo · 3 bước')
    expect(screen.getByRole('button', { name: 'Bước trước' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: /Điểm nóng/ }))
    expect(h.onOpenNode).toHaveBeenCalledWith('c.py::f#function')
    expect(screen.getByRole('button', { name: 'Bước trước' })).toBeEnabled()
  })

  it('không có bước nào: hiện câu empty', async () => {
    setup(vi.fn(async () => ({ steps: [] })))
    expect(await screen.findByText(/Chưa đủ dữ liệu/)).toBeInTheDocument()
  })

  it('lỗi tải: role=alert', async () => {
    setup(vi.fn(async () => { throw { code: 'not_indexed', message: 'Chưa lập chỉ mục' } }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa lập chỉ mục')
  })
})
