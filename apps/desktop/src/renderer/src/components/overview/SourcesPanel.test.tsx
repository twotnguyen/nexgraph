// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SourceItem } from '@shared/graph-types'
import { installNexgraph } from '../../test-utils'
import { SourcesPanel } from './SourcesPanel'

const item: SourceItem = { name: 'docs_page.md', file: 'sources/docs_page.md', size: 120, added_at: 1_700_000_000, url: 'https://example.com/docs/page' }
const done = { job_id: 's1', project_id: 'p1', kind: 'ingest', state: 'done' as const, files_done: 2, files_total: 2, message: null,
  result: { file: 'sources/docs_page.md' } }

describe('SourcesPanel', () => {
  it('lists sources and removes one', async () => {
    const list = vi.fn().mockResolvedValueOnce([item]).mockResolvedValue([])
    const { api } = installNexgraph({ sources: { list } })
    render(<SourcesPanel projectId="p1" />)
    expect(await screen.findByText('https://example.com/docs/page')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Xoá docs_page.md' }))
    expect(api.sources.remove).toHaveBeenCalledWith('p1', 'docs_page.md')
    expect(await screen.findByText('Chưa có nguồn nào.')).toBeInTheDocument()
  })

  it('adds a URL, waits for the job and reloads the list', async () => {
    const list = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([item])
    const { api } = installNexgraph({ sources: { list }, index: { status: vi.fn(async () => done) } })
    render(<SourcesPanel projectId="p1" />)
    await screen.findByText('Chưa có nguồn nào.')
    await userEvent.type(screen.getByLabelText('URL nguồn'), 'https://example.com/docs/page')
    await userEvent.click(screen.getByRole('button', { name: 'Thêm' }))
    expect(api.sources.add).toHaveBeenCalledWith('p1', 'https://example.com/docs/page')
    expect(await screen.findByText('docs_page.md')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('URL nguồn')).toHaveValue(''))
  })

  it('shows why a URL was rejected', async () => {
    installNexgraph({ sources: { add: vi.fn(async () => { throw { code: 'bad_url', message: 'Blocked URL scheme' } }) } })
    render(<SourcesPanel projectId="p1" />)
    await userEvent.type(await screen.findByLabelText('URL nguồn'), 'file:///etc/passwd')
    await userEvent.click(screen.getByRole('button', { name: 'Thêm' }))
    // UI Việt dịch câu tiếng Anh của engine theo mã `bad_url` (I18N-IPC), không hiện câu thô.
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được: URL nguồn không hợp lệ.')
  })
})
