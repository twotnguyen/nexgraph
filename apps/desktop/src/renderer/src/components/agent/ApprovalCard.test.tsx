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
