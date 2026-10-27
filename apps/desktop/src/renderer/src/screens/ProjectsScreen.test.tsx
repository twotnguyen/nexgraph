// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { installNexgraph, project } from '../test-utils'
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
    await userEvent.click(await screen.findByRole('button', { name: /ứng dụng/ }))
    expect(api.project.open).toHaveBeenCalledWith('/b/ứng dụng')
  })
})
