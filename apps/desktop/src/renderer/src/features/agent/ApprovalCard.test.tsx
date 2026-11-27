// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApprovalCard } from './ApprovalCard'

const mocks = vi.hoisted(() => ({ create: vi.fn(() => ({ dispose: vi.fn() })) }))
vi.mock('../editor/monaco', () => ({ languageFor: () => 'typescript', createDiffEditor: mocks.create }))

describe('ApprovalCard', () => {
  it('lệnh hiển thị executable, từng argument, cwd và timeout; duyệt/từ chối giữ API', async () => {
    const decide = vi.fn()
    const { container } = render(<ApprovalCard request={{ id: 'cmd', tool: 'command', executable: 'pnpm',
      args: ['test', 'a b', '$(unsafe)'], cwd: '/Đồ án/demo', timeoutMs: 65000 }} onDecide={decide} />)
    expect(container.querySelector('pre')).toHaveTextContent('pnpm "test" "a b" "$(unsafe)"')
    expect(screen.getByText('/Đồ án/demo')).toBeInTheDocument()
    expect(screen.getByText('65 giây')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cho phép chạy' }))
    await userEvent.click(screen.getByRole('button', { name: 'Từ chối' }))
    expect(decide.mock.calls).toEqual([[true], [false]])
  })

  it('web hiện nguyên URL hoặc câu tìm dạng văn bản (không thành link bấm được), không dựng diff', async () => {
    mocks.create.mockClear()
    const decide = vi.fn()
    const { container, unmount } = render(<ApprovalCard request={{ id: 'w1', tool: 'webfetch', target: 'https://docs.example.test/a?q=<b>' }} onDecide={decide} />)
    expect(screen.getByRole('group', { name: 'Mở trang web' })).toBeInTheDocument()
    expect(container.querySelector('pre')).toHaveTextContent('https://docs.example.test/a?q=<b>')
    expect(container.querySelector('a')).toBeNull()
    expect(mocks.create).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Cho phép' }))
    expect(decide.mock.calls).toEqual([[true]])
    unmount()
    render(<ApprovalCard request={{ id: 'w2', tool: 'websearch', target: 'vitest mock timers' }} onDecide={vi.fn()} />)
    expect(screen.getByRole('group', { name: 'Tìm trên web' })).toBeInTheDocument()
    expect(screen.getByText('vitest mock timers')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Xem diff ở giữa' })).toBeNull()
  })

  it('tệp vẫn dùng Monaco diff và cho mở inspector ở giữa', async () => {
    const inspect = vi.fn()
    const request = { id: 'file', tool: 'edit' as const, path: 'src/app.ts', before: 'old', after: 'new' }
    const { unmount } = render(<ApprovalCard request={request} onDecide={vi.fn()} onInspect={inspect} />)
    expect(mocks.create).toHaveBeenCalledWith(expect.anything(), { before: 'old', after: 'new', language: 'typescript' })
    await userEvent.click(screen.getByRole('button', { name: 'Xem diff ở giữa' }))
    expect(inspect).toHaveBeenCalledWith(request)
    const editor = mocks.create.mock.results.at(-1)!.value
    unmount()
    expect(editor.dispose).toHaveBeenCalledOnce()
  })
})
