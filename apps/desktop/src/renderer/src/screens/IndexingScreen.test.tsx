// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { installNexgraph, progress, project } from '../test-utils'
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
  it('passes explicit document flags through, including false', async () => {
    const h = installNexgraph()
    render(<IndexingScreen project={project()} options={{ exclude: [], includeDocs: false, includeMedia: false }} onExplore={() => {}} />)
    await waitFor(() => expect(h.api.index.start).toHaveBeenCalledWith('p1', { includeDocs: false, includeMedia: false }))
  })

  it('starts the index once for the project', async () => {
    const h = setup()
    await waitFor(() => expect(h.api.index.start).toHaveBeenCalledWith('p1'))
  })

  it('shows structure progress and keeps "Bắt đầu khám phá" disabled until phase 1 is done', async () => {
    const h = setup()
    await waitFor(() => expect(h.api.index.start).toHaveBeenCalled())
    emit(h, progress('structure', 40, 100))
    expect(await screen.findByText('40 / 100')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bắt đầu khám phá' })).toBeDisabled()
    expect(screen.getByRole('progressbar', { name: 'Đọc cấu trúc' })).toHaveAttribute('aria-valuenow', '40')
  })

  it('enables exploring once phase 2 starts, and calls onExplore', async () => {
    const h = setup()
    await waitFor(() => expect(h.api.index.start).toHaveBeenCalled())
    emit(h, progress('resolve', 100, 100))
    const btn = await screen.findByRole('button', { name: 'Bắt đầu khám phá' })
    expect(btn).toBeEnabled()
    await userEvent.click(btn)
    expect(h.onExplore).toHaveBeenCalled()
  })

  it('shows cancelled and error states', async () => {
    const h = setup()
    emit(h, progress('cancelled', 3, 100))
    expect(await screen.findByText('Đã hủy lập chỉ mục')).toBeInTheDocument()
    emit(h, progress('error', 0, 0, { message: 'boom' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
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

  it('tolerates index_running (job already started) without showing an error', async () => {
    const h = setup({ index: { start: vi.fn(async () => { throw Object.assign(new Error('x'), { code: 'index_running' }) }) } })
    await waitFor(() => expect(h.api.index.start).toHaveBeenCalled())
    emit(h, progress('structure', 5, 10))
    expect(await screen.findByText('5 / 10')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the start error when index cannot start', async () => {
    setup({ index: { start: vi.fn(async () => { throw Object.assign(new Error('Engine chưa sẵn sàng'), { code: 'internal' }) }) } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Engine chưa sẵn sàng')
  })
})
