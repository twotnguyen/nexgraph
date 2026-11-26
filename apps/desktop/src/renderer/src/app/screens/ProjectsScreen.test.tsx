// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { installNexgraph, project } from '../../test-utils'
import { ProjectsScreen } from './ProjectsScreen'

describe('ProjectsScreen', () => {
  it('picks a folder, opens the project and reports it', async () => {
    const { api } = installNexgraph()
    const onOpened = vi.fn()
    render(<ProjectsScreen engineReady onOpened={onOpened} />)
    await userEvent.click(screen.getByRole('button', { name: 'Mở thư mục…' }))
    await waitFor(() => expect(onOpened).toHaveBeenCalledWith(project()))
    expect(api.project.open).toHaveBeenCalledWith('/Đồ án/demo')
  })

  it('does nothing when the dialog is cancelled', async () => {
    const { api } = installNexgraph({ project: { pickFolder: vi.fn(async () => null) } })
    const onOpened = vi.fn()
    render(<ProjectsScreen engineReady onOpened={onOpened} />)
    await userEvent.click(screen.getByRole('button', { name: 'Mở thư mục…' }))
    expect(api.project.open).not.toHaveBeenCalled()
    expect(onOpened).not.toHaveBeenCalled()
  })

  it('shows an error message when opening fails', async () => {
    installNexgraph({ project: { open: vi.fn(async () => { throw Object.assign(new Error('x'), { code: 'bad_path' }) }) } })
    render(<ProjectsScreen engineReady onOpened={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Mở thư mục…' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Không mở được thư mục này')
  })

  it('disables opening while the engine is not ready', () => {
    installNexgraph()
    render(<ProjectsScreen engineReady={false} onOpened={() => {}} />)
    expect(screen.getByRole('button', { name: 'Mở thư mục…' })).toBeDisabled()
    expect(screen.getByText('Engine chưa sẵn sàng, vui lòng đợi…')).toBeInTheDocument()
  })

  it('lists recent projects and opens one by clicking it', async () => {
    const recent = [project({ name: 'bookstore', path: '/a/bookstore' }), project({ project_id: 'p2', name: 'ứng dụng', path: '/b/ứng dụng' })]
    const { api } = installNexgraph({ project: { list: vi.fn(async () => recent) } })
    const onOpened = vi.fn()
    render(<ProjectsScreen engineReady onOpened={onOpened} />)
    await userEvent.click(await screen.findByRole('button', { name: /^ứng dụng/ }))
    expect(api.project.open).toHaveBeenCalledWith('/b/ứng dụng')
  })

  it('shows the last index date and distinguishes unindexed projects', async () => {
    const timestamp = 1_700_000_000
    installNexgraph({ project: { list: vi.fn(async () => [
      project({ name: 'Đã có đồ thị', last_indexed_at: timestamp }),
      project({ project_id: 'p2', name: 'Dự án mới', last_indexed_at: null })
    ]) } })
    render(<ProjectsScreen engineReady onOpened={() => {}} />)
    const indexed = await screen.findByRole('button', { name: /^Đã có đồ thị/ })
    expect(indexed.querySelector('time')).toHaveAttribute('datetime', new Date(timestamp * 1000).toISOString())
    expect(screen.getByRole('button', { name: /^Dự án mới/ })).toHaveTextContent('Chưa lập chỉ mục')
  })

  it('only removes a recent item after confirmation', async () => {
    const item = project({ name: 'ứng dụng' })
    const remove = vi.fn(async () => {})
    installNexgraph({ project: { list: vi.fn(async () => [item]), remove } })
    render(<ProjectsScreen engineReady onOpened={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Gỡ ứng dụng khỏi danh sách' }))
    const dialog = await screen.findByRole('dialog', { name: 'Gỡ dự án khỏi danh sách' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }))
    expect(remove).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Gỡ ứng dụng khỏi danh sách' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Gỡ dự án' }))
    expect(remove).toHaveBeenCalledWith(item.project_id)
    expect(await screen.findByText('Đã gỡ ứng dụng khỏi danh sách gần đây.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^ứng dụng/ })).not.toBeInTheDocument()
  })

  it('opens a project from a GitHub URL after the clone job finishes', async () => {
    const cloned = project({ project_id: 'p9', name: 'repo-1a2b3c4d', path: '/data/clones/repo-1a2b3c4d' })
    const { api } = installNexgraph({
      index: { status: vi.fn(async () => ({ job_id: 'c1', project_id: null, kind: 'clone', state: 'done' as const,
        files_done: 2, files_total: 2, message: null, result: { project: cloned } })) }
    })
    const onOpened = vi.fn()
    render(<ProjectsScreen engineReady onOpened={onOpened} />)
    await userEvent.click(screen.getByRole('button', { name: 'Mở từ URL…' }))
    await userEvent.type(screen.getByLabelText('URL kho mã GitHub hoặc GitLab'), 'https://github.com/owner/repo')
    await userEvent.click(screen.getByRole('button', { name: 'Tải về và mở' }))
    await waitFor(() => expect(onOpened).toHaveBeenCalledWith(cloned))
    expect(api.sources.clone).toHaveBeenCalledWith('https://github.com/owner/repo')
  })

  it('shows the engine error when the URL is rejected', async () => {
    installNexgraph({ sources: { clone: vi.fn(async () => { throw { code: 'bad_url', message: 'Chỉ nhận URL https://github.com' } }) } })
    render(<ProjectsScreen engineReady onOpened={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Mở từ URL…' }))
    await userEvent.type(screen.getByLabelText('URL kho mã GitHub hoặc GitLab'), 'https://example.com/a/b')
    await userEvent.click(screen.getByRole('button', { name: 'Tải về và mở' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Chỉ nhận URL https://github.com')
  })

  it('adds a recent project to the shared graph and removes a member', async () => {
    const a = project({ project_id: 'pa', name: 'thư viện', path: '/a' })
    const b = project({ project_id: 'pb', name: 'ứng dụng', path: '/b' })
    const members = vi.fn(async () => [{ project_id: 'pa', name: 'thư viện', path: '/a', added_at: 1, available: true }])
    const { api } = installNexgraph({ project: { list: vi.fn(async () => [a, b]) }, globalGraph: { list: members } })
    render(<ProjectsScreen engineReady onOpened={() => {}} onOpenGlobal={() => {}} />)
    const group = await screen.findByRole('region', { name: 'Graph chung' })
    expect(await within(group).findByRole('checkbox', { name: 'thư viện' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Thêm thư viện vào graph chung' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Thêm ứng dụng vào graph chung' }))
    expect(api.globalGraph.add).toHaveBeenCalledWith('pb')
    await userEvent.click(within(group).getByRole('button', { name: 'Gỡ thư viện khỏi graph chung' }))
    expect(api.globalGraph.remove).toHaveBeenCalledWith('pa')
  })

  it('opens the combined view with the selected members', async () => {
    const members = [
      { project_id: 'pa', name: 'thư viện', path: '/a', added_at: 1, available: true },
      { project_id: 'pb', name: 'ứng dụng', path: '/b', added_at: 2, available: true },
      { project_id: 'pc', name: null, path: null, added_at: 3, available: false }
    ]
    installNexgraph({ globalGraph: { list: vi.fn(async () => members) } })
    const onOpenGlobal = vi.fn()
    render(<ProjectsScreen engineReady onOpened={() => {}} onOpenGlobal={onOpenGlobal} />)
    const group = await screen.findByRole('region', { name: 'Graph chung' })
    const view = within(group).getByRole('button', { name: 'Xem chung' })
    await within(group).findByRole('checkbox', { name: 'thư viện' })
    expect(view).toBeDisabled()
    await userEvent.click(within(group).getByRole('checkbox', { name: 'thư viện' }))
    await userEvent.click(within(group).getByRole('checkbox', { name: 'ứng dụng' }))
    expect(within(group).getByRole('checkbox', { name: /Không còn dùng được/ })).toBeDisabled()
    await userEvent.click(view)
    expect(onOpenGlobal).toHaveBeenCalledWith(['pa', 'pb'])
  })

  it('cảnh báo khi không đọc được lần lập chỉ mục cuối của dự án', async () => {
    installNexgraph({ project: { list: vi.fn(async () => [project({
      name: 'Hỏng', last_indexed_at: null, last_index_error: 'Không đọc được lần lập chỉ mục cuối (DatabaseError: bad)'
    })]) } })
    render(<ProjectsScreen engineReady onOpened={() => {}} />)
    const row = await screen.findByRole('button', { name: /^Hỏng/ })
    expect(row).toHaveTextContent('Không đọc được lần lập chỉ mục cuối')
    expect(row.querySelector('[role="status"]')).toHaveAttribute('title', 'Không đọc được lần lập chỉ mục cuối (DatabaseError: bad)')
  })
})