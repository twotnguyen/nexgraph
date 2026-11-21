// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ScanInfo } from '@shared/graph-types'
import { installNexgraph, progress, project } from './test-utils'
import { formatDate } from './state/locale'
import App from './App'

// jsdom không chạy được Monaco (thiếu matchMedia khi nạp phần gợi ý/hover); test này không mở editor.
vi.mock('./components/editor/monaco', () => ({ languageFor: () => 'plaintext', createEditor: vi.fn(), createDiffEditor: vi.fn(), createMirror: () => null }))

const small: ScanInfo = { files: 120, by_language: { dart: 120 }, large: false, threshold: 5000, top_dirs: [] }
const large: ScanInfo = {
  files: 9000, by_language: { dart: 9000 }, large: true, threshold: 5000,
  top_dirs: [{ path: 'lib/features', files: 6000 }]
}

async function openProject(scan: () => Promise<ScanInfo>) {
  const h = installNexgraph({ index: { scan: vi.fn(scan) } })
  render(<App />)
  await userEvent.click(await screen.findByRole('button', { name: 'Mở thư mục…' }))
  return h
}

describe('App flow after opening a project', () => {
  it('không crash renderer khi preload API chưa inject (dev reload)', () => {
    delete (window as unknown as { nexgraph?: unknown }).nexgraph
    expect(() => render(<App />)).not.toThrow()
    expect(screen.getByRole('button', { name: 'Mở thư mục…' })).toBeInTheDocument()
    installNexgraph() // khôi phục cho các test sau
  })

  it('goes straight to indexing for a small project', async () => {
    const h = await openProject(async () => small)
    expect(await screen.findByText('Đang lập chỉ mục: demo')).toBeInTheDocument()
    expect(screen.queryByText(/vượt ngưỡng/)).not.toBeInTheDocument()
    await waitFor(() => expect(h.api.index.start).toHaveBeenCalledWith('p1'))
  })

  it('warns about a large project and does not index until the user chooses', async () => {
    const h = await openProject(async () => large)
    expect(await screen.findByText(/vượt ngưỡng 5\.000/)).toBeInTheDocument()
    expect(h.api.index.start).not.toHaveBeenCalled()
  })

  it('indexes the chosen subdirectory', async () => {
    const h = await openProject(async () => large)
    await userEvent.click(await screen.findByRole('button', { name: /lib\/features/ }))
    expect(await screen.findByText('Đang lập chỉ mục: demo')).toBeInTheDocument()
    expect(screen.getByText('Thư mục con: lib/features')).toBeInTheDocument()
    await waitFor(() => expect(h.api.index.start).toHaveBeenCalledWith('p1', { subdir: 'lib/features' }))
  })

  it('indexes everything when asked', async () => {
    const h = await openProject(async () => large)
    await userEvent.click(await screen.findByRole('button', { name: 'Lập chỉ mục toàn bộ' }))
    await waitFor(() => expect(h.api.index.start).toHaveBeenCalledWith('p1'))
  })

  it('cancel returns to the projects screen without indexing', async () => {
    const h = await openProject(async () => large)
    await userEvent.click(await screen.findByRole('button', { name: 'Hủy' }))
    expect(await screen.findByRole('button', { name: 'Mở thư mục…' })).toBeInTheDocument()
    expect(h.api.index.start).not.toHaveBeenCalled()
  })

  it('a failing scan does not block indexing', async () => {
    const h = await openProject(async () => { throw new Error('boom') })
    expect(await screen.findByText('Đang lập chỉ mục: demo')).toBeInTheDocument()
    await waitFor(() => expect(h.api.index.start).toHaveBeenCalledWith('p1'))
  })

  it('mở dự án đã index vào workspace và vẫn có thể lập chỉ mục lại từ Tổng quan', async () => {
    const h = installNexgraph({ project: { open: vi.fn(async () => project({ last_indexed_at: 1_700_000_000 })) },
      graph: { report: vi.fn(async () => ({ god_nodes: [], communities: [], surprising: [], questions: [], cycles: { cycles: [], total: 0 }, freshness: { indexed_at: null, index_commit: null, head_commit: null, changed_files: 0, stale: false }, gaps: { isolated: { total: 0, nodes: [] }, ambiguous_edges: { total: 0, edges: [] } }, benchmark: null, truncated: false })) } })
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Mở thư mục…' }))
    expect(await screen.findByRole('tab', { name: 'Kiến trúc', selected: true })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Báo cáo' }))
    expect(await screen.findByRole('tab', { name: 'Báo cáo', selected: true })).toBeInTheDocument()
    expect(h.api.index.start).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '← Tổng quan' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Index lại/ }))
    expect(await screen.findByText('Đang lập chỉ mục: demo')).toBeInTheDocument()
    await waitFor(() => expect(h.api.index.start).toHaveBeenCalledWith('p1'))
  })

  it('giữ thẻ đang chọn và không chạy lệnh workspace khi Cài đặt đang mở', async () => {
    installNexgraph({ project: { open: vi.fn(async () => project({ last_indexed_at: 1_700_000_000 })) },
      graph: { report: vi.fn(async () => ({ god_nodes: [], communities: [], surprising: [], questions: [], cycles: { cycles: [], total: 0 }, freshness: { indexed_at: null, index_commit: null, head_commit: null, changed_files: 0, stale: false }, gaps: { isolated: { total: 0, nodes: [] }, ambiguous_edges: { total: 0, edges: [] } }, benchmark: null, truncated: false })) } })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Mở thư mục…' }))
    await user.click(await screen.findByRole('tab', { name: 'Báo cáo' }))
    const modifier = /mac/i.test(navigator.platform) ? 'Meta' : 'Control'
    await user.keyboard(`{${modifier}>},{/${modifier}}`)
    const back = await screen.findByRole('button', { name: '← Dự án' })
    expect(screen.queryByRole('tab', { name: 'Báo cáo' })).not.toBeInTheDocument()
    await user.keyboard(`{${modifier}>}{Shift>}d{/Shift}{/${modifier}}`)
    await user.click(back)
    expect(await screen.findByRole('tab', { name: 'Báo cáo', selected: true })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Gỡ lỗi' })).not.toBeInTheDocument()
  })

  it.each(['cancelled', 'error'] as const)('cho xem đồ thị hiện có và quay lại cùng tác vụ index lại (%s)', async (state) => {
    const indexed = project({ last_indexed_at: 1_700_000_000 })
    const h = installNexgraph({ project: { open: vi.fn(async () => indexed) } })
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Mở thư mục…' }))
    await userEvent.click(await screen.findByRole('button', { name: '← Tổng quan' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Index lại/ }))
    await waitFor(() => expect(h.api.index.status).toHaveBeenCalledWith('j1'))
    act(() => h.emit(progress('resolve', 4, 4)))
    await userEvent.click(await screen.findByRole('button', { name: 'Mở đồ thị hiện có' }))
    expect(await screen.findByRole('tab', { name: 'Kiến trúc', selected: true })).toBeInTheDocument()
    expect(await screen.findByText('Đồ thị từ lần lập chỉ mục thành công trước vẫn khả dụng.')).toBeInTheDocument()

    act(() => h.emit(progress(state, 4, 4, { message: state === 'error' ? 'Không ghi được đồ thị mới' : null })))
    await userEvent.click(screen.getByRole('button', { name: '← Tiến độ lập chỉ mục' }))
    if (state === 'error') expect(screen.getByRole('alert')).toHaveTextContent('Không ghi được đồ thị mới')
    else expect(screen.getByRole('heading', { name: 'Đã hủy lập chỉ mục: demo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mở đồ thị hiện có' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Quay lại' }))
    expect(await screen.findByRole('button', { name: /^Index lại/ })).toBeInTheDocument()
    expect(h.api.index.start).toHaveBeenCalledTimes(1)
  })

  it('dùng mốc lập chỉ mục đã công bố sau lần thành công đầu tiên', async () => {
    const indexedAt = 1_700_000_000
    const list = vi.fn(async () => [project({ last_indexed_at: indexedAt })]).mockResolvedValueOnce([])
    const h = installNexgraph({ project: { list } })
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Mở thư mục…' }))
    await waitFor(() => expect(h.api.index.status).toHaveBeenCalledWith('j1'))
    act(() => h.emit(progress('done', 10, 10)))
    await userEvent.click(screen.getByRole('button', { name: 'Bắt đầu khám phá' }))
    await userEvent.click(await screen.findByRole('button', { name: '← Tổng quan' }))
    expect(await screen.findByText(`Index lần cuối: ${formatDate(indexedAt * 1000)}`)).toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('quay lại danh sách dự án khi lần lập chỉ mục đầu tiên thất bại', async () => {
    const h = await openProject(async () => small)
    await waitFor(() => expect(h.api.index.status).toHaveBeenCalledWith('j1'))
    act(() => h.emit(progress('error', 3, 10, { message: 'Không ghi được đồ thị' })))
    expect(screen.getByRole('button', { name: 'Bắt đầu khám phá' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Mở đồ thị hiện có' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Quay lại' }))
    expect(await screen.findByRole('button', { name: 'Mở thư mục…' })).toBeInTheDocument()
  })
})
