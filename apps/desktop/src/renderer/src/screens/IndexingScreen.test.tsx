// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { installNexgraph, progress, project } from '../test-utils'
import { setLocale, useLocale } from '../state/locale'
import { IndexingScreen } from './IndexingScreen'

const setup = (over = {}) => {
  const h = installNexgraph(over)
  const onExplore = vi.fn()
  render(<IndexingScreen project={project()} onExplore={onExplore} />)
  return { ...h, onExplore }
}
const emit = (h: ReturnType<typeof installNexgraph>, e: ReturnType<typeof progress>) => act(() => h.emit(e))

describe('IndexingScreen subdir', () => {
  it('starts the index for the subdirectory and says so', async () => {
    const h = installNexgraph()
    render(<IndexingScreen project={project()} subdir="lib/features" onExplore={() => {}} />)
    expect(screen.getByText('Thư mục con: lib/features')).toBeInTheDocument()
    await waitFor(() => expect(h.api.index.start).toHaveBeenCalledWith('p1', { subdir: 'lib/features' }))
  })
})

describe('IndexingScreen', () => {
  it('cảnh báo số mục không đọc được khi quét xong và đổi ngôn ngữ tại chỗ', async () => {
    const h = installNexgraph()
    function Harness() { useLocale(); return <IndexingScreen project={project()} onExplore={() => {}} /> }
    render(<Harness />)
    await waitFor(() => expect(h.api.index.start).toHaveBeenCalled())
    emit(h, progress('done', 10, 10, { result: { unreadable_count: 3 } }))
    expect(await screen.findByText('3 mục không đọc được khi quét — kiểm tra quyền đọc của các mục đó.')).toBeInTheDocument()
    act(() => setLocale('en'))
    expect(await screen.findByText('3 items could not be read during the scan — check read permissions.')).toBeInTheDocument()
    act(() => setLocale('vi'))
  })

  it('M1: không hiện câu Việt thô của engine khi đã có cảnh báo mục không đọc được', async () => {
    const h = installNexgraph()
    function Harness() { useLocale(); return <IndexingScreen project={project()} onExplore={() => {}} /> }
    render(<Harness />)
    await waitFor(() => expect(h.api.index.start).toHaveBeenCalled())
    emit(h, progress('done', 10, 10, { message: '1 mục không đọc được khi quét (ví dụ blocked)', result: { unreadable_count: 1 } }))
    act(() => setLocale('en'))
    expect(await screen.findByText('1 item could not be read during the scan — check read permissions.')).toBeInTheDocument()
    expect(screen.queryByText(/\(ví dụ/)).toBeNull()
    act(() => setLocale('vi'))
    expect(await screen.findByText('1 mục không đọc được khi quét — kiểm tra quyền đọc của các mục đó.')).toBeInTheDocument()
    expect(screen.queryByText(/\(ví dụ/)).toBeNull()
  })

  it('passes explicit document flags through, including false', async () => {
    const h = installNexgraph()
    render(<IndexingScreen project={project()} options={{ exclude: [], includeDocs: false, includeMedia: false }} onExplore={() => {}} />)
    await waitFor(() => expect(h.api.index.start).toHaveBeenCalledWith('p1', { includeDocs: false, includeMedia: false }))
  })

  it('starts the index once for the project', async () => {
    const h = setup()
    await waitFor(() => expect(h.api.index.start).toHaveBeenCalledWith('p1'))
  })

  it('shows structure progress and keeps "Bắt đầu khám phá" disabled', async () => {
    const h = setup()
    await waitFor(() => expect(h.api.index.start).toHaveBeenCalled())
    emit(h, progress('structure', 40, 100))
    expect(await screen.findByText('40 / 100')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bắt đầu khám phá' })).toBeDisabled()
    expect(screen.getByRole('progressbar', { name: 'Đọc cấu trúc' })).toHaveAttribute('aria-valuenow', '40')
  })

  it('enables exploring only after the initial graph is published', async () => {
    const h = setup()
    await waitFor(() => expect(h.api.index.start).toHaveBeenCalled())
    emit(h, progress('resolve', 100, 100))
    const btn = screen.getByRole('button', { name: 'Bắt đầu khám phá' })
    expect(btn).toBeDisabled()
    emit(h, progress('done', 100, 100))
    await waitFor(() => expect(btn).toBeEnabled())
    expect(btn).toBeEnabled()
    await userEvent.click(btn)
    expect(h.onExplore).toHaveBeenCalled()
  })

  it('keeps a cancelled job terminal even if an older progress event arrives', async () => {
    const h = setup()
    emit(h, progress('cancelled', 3, 100))
    expect(await screen.findByRole('heading', { name: 'Đã hủy lập chỉ mục: demo' })).toBeInTheDocument()
    emit(h, progress('structure', 4, 100))
    expect(screen.getByRole('heading', { name: 'Đã hủy lập chỉ mục: demo' })).toBeInTheDocument()
  })

  it('shows a terminal error from the engine', async () => {
    const h = setup()
    emit(h, progress('error', 0, 0, { message: 'boom' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
  })

  it('keeps the engine warning visible when the index finished with file errors', async () => {
    const h = setup()
    emit(h, progress('done', 100, 100, { message: '2 tệp không đọc được hoặc lỗi trích xuất (ví dụ b.py: Không đọc được tệp)' }))
    expect(await screen.findByText(/2 tệp không đọc được/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bắt đầu khám phá' })).toBeEnabled()
  })

  it('cancel button calls index.cancel with the job id', async () => {
    const h = setup()
    await waitFor(() => expect(h.api.index.start).toHaveBeenCalled())
    emit(h, progress('structure', 1, 100))
    await userEvent.click(await screen.findByRole('button', { name: 'Hủy' }))
    expect(h.api.index.cancel).toHaveBeenCalledWith('j1')
  })

  it('ignores events of another project', async () => {
    const h = setup()
    emit(h, progress('structure', 99, 100, { project_id: 'other' }))
    expect(screen.queryByText('99 / 100')).not.toBeInTheDocument()
  })

  it('opens a completed job without SSE, including when start returns an existing job', async () => {
    const h = setup({ index: {
      start: vi.fn(async () => ({ jobId: 'already-started' })),
      status: vi.fn(async () => progress('done', 10, 10, { job_id: 'already-started' }))
    } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Bắt đầu khám phá' })).toBeEnabled())
    expect(h.api.index.status).toHaveBeenCalledWith('already-started')
    expect(screen.getByText('10 / 10')).toBeInTheDocument()
  })

  it('starts only one job when StrictMode resubscribes the effect', async () => {
    const h = installNexgraph()
    render(<StrictMode><IndexingScreen project={project()} onExplore={() => {}} /></StrictMode>)
    await waitFor(() => expect(h.api.index.status).toHaveBeenCalledWith('j1'))
    expect(h.api.index.start).toHaveBeenCalledTimes(1)
  })

  it('ignores same-project SSE for another job and stale poll snapshots', async () => {
    let finishRead!: (value: ReturnType<typeof progress>) => void
    const h = setup({ index: { status: vi.fn(() => new Promise((resolve) => { finishRead = resolve })) } })
    await waitFor(() => expect(h.api.index.status).toHaveBeenCalledWith('j1'))
    emit(h, progress('resolve', 10, 10, { job_id: 'previous-job' }))
    expect(screen.getByRole('button', { name: 'Bắt đầu khám phá' })).toBeDisabled()
    emit(h, progress('resolve', 10, 10))
    expect(screen.getByText('Đang nối quan hệ để hoàn tất đồ thị')).toBeInTheDocument()
    await act(async () => finishRead(progress('structure', 1, 10)))
    expect(screen.getByText('Đang nối quan hệ để hoàn tất đồ thị')).toBeInTheDocument()
  })

  it('shows a lost job instead of waiting indefinitely', async () => {
    const h = installNexgraph({ index: { status: vi.fn(async () => {
      throw Object.assign(new Error('Không có công việc j1'), { code: 'unknown_job' })
    }) } })
    const onBack = vi.fn()
    render(<IndexingScreen project={project()} onExplore={() => {}} onBack={onBack} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Không có công việc j1')
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeEnabled()
    expect(h.api.index.status).toHaveBeenCalledTimes(1)
  })

  it('retries a bounded number of times when status requests hang', async () => {
    vi.useFakeTimers()
    try {
      const h = setup({ index: { status: vi.fn(() => new Promise(() => {})) } })
      await act(async () => vi.advanceTimersByTimeAsync(17_000))
      expect(screen.getByRole('alert')).toHaveTextContent('Engine không trả trạng thái lập chỉ mục kịp thời')
      await act(async () => vi.advanceTimersByTimeAsync(30_000))
      expect(h.api.index.status).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the start error when index cannot start', async () => {
    setup({ index: { start: vi.fn(async () => { throw Object.assign(new Error('Engine chưa sẵn sàng'), { code: 'internal' }) }) } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Engine chưa sẵn sàng')
  })

  it('only shows preparation while queued, including when no files are found', async () => {
    const h = setup()
    expect(await screen.findByText('Đang chuẩn bị danh sách tệp…')).toBeInTheDocument()
    emit(h, progress('structure', 0, 0))
    expect(await screen.findByText('Không có tệp phù hợp')).toBeInTheDocument()
    expect(screen.queryByText('Đang chuẩn bị danh sách tệp…')).not.toBeInTheDocument()
  })

  it('shows "Quay lại" and calls onBack when job is cancelled and onBack is provided', async () => {
    const h = installNexgraph()
    const onBack = vi.fn()
    render(<IndexingScreen project={project()} onExplore={() => {}} onBack={onBack} />)
    await waitFor(() => expect(h.api.index.start).toHaveBeenCalled())
    emit(h, progress('cancelled', 0, 100))
    const backBtn = await screen.findByRole('button', { name: 'Quay lại' })
    expect(backBtn).toBeEnabled()
    await userEvent.click(backBtn)
    expect(onBack).toHaveBeenCalled()
  })
})
