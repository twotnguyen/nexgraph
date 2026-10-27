// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ScanInfo } from '@shared/graph-types'
import { installNexgraph } from './test-utils'
import App from './App'

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
})
