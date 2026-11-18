// @vitest-environment jsdom
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionSnapshot, ProjectCommands } from '@shared/agent-types'
import { emptyAgentSnapshot, installNexgraph } from '../../test-utils'
import { useAgentWorkbench } from './useAgentWorkbench'
import { WorkbenchControls } from './WorkbenchControls'

const pending = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const info = { id: 's1', title: 'Hội thoại một', createdAt: 1, updatedAt: 2, provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'm', messageCount: 1 }
function Controls({ projectId = 'p1', runtime }: { projectId?: string; runtime?: 'pi' | 'antigravity-cli' }) {
  const work = useAgentWorkbench(projectId, () => {})
  return <WorkbenchControls projectId={projectId} work={work} busy={false} mode="edit" runtime={runtime} />
}
const openSettings = async () => {
  const settings = screen.getByRole('button', { name: 'Quyền & giới hạn' })
  await waitFor(() => expect(settings).toBeEnabled())
  await userEvent.click(settings)
}
afterEach(() => vi.restoreAllMocks())

describe('WorkbenchControls', () => {
  it('không hiển thị số lượt hoặc số dư Pro giả khi CLI không cung cấp thống kê', async () => {
    installNexgraph({ agent: { snapshot: vi.fn(async () => ({ ...emptyAgentSnapshot(), runtime: 'antigravity-cli' as const, task: {
      id: 'task', sessionId: 'session', status: 'completed' as const, startedAt: 1, finishedAt: 2, turns: 0, turnsKnown: false,
      runtime: 'antigravity-cli' as const, limits: emptyAgentSnapshot().limits, checkpointIds: []
    } })) } })
    render(<Controls runtime="antigravity-cli" />)
    expect(await screen.findByText('Hoàn tất · Antigravity CLI')).toBeInTheDocument()
    expect(screen.queryByText(/0\/20 lượt/)).not.toBeInTheDocument()
    await openSettings()
    expect(screen.getByText(/không phải số dư tài khoản hay trần thanh toán/)).toBeInTheDocument()
    expect(screen.getByLabelText('Lượt mô hình')).toBeDisabled()
    expect(screen.getByLabelText('Token / tác vụ')).toBeDisabled()
  })

  it('Google chỉ sửa giới hạn thời gian và không gửi giá trị 0 từ ô lượt/token bị khóa', async () => {
    const { api } = installNexgraph()
    render(<Controls runtime="antigravity-cli" />)
    await openSettings()
    const minutes = screen.getByLabelText('Phút / tác vụ')
    await userEvent.clear(minutes)
    await userEvent.type(minutes, '5')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu thời gian' }))
    expect(api.agent.setLimits).toHaveBeenCalledWith('p1', { maxTurns: 20, maxDurationMs: 300000, maxTokens: 100000 })
  })

  it('đợi snapshot và danh sách phiên trước khi bật thao tác', async () => {
    const initial = pending<AgentSessionSnapshot>()
    const { api } = installNexgraph({ agent: { snapshot: vi.fn(() => initial.promise) } })
    render(<Controls />)
    expect(screen.getByRole('button', { name: '+ Phiên mới' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Lịch sử' })).toBeDisabled()
    await act(async () => initial.resolve(emptyAgentSnapshot()))
    await waitFor(() => expect(screen.getByRole('button', { name: '+ Phiên mới' })).toBeEnabled())
    expect(api.agent.listSessions).toHaveBeenCalledWith('p1')
  })

  it('đổi tên bằng ô nhập trong ứng dụng và gọi rename đúng phiên', async () => {
    const { api } = installNexgraph({ agent: { listSessions: vi.fn(async () => [info]) } })
    render(<Controls />)
    const history = screen.getByRole('button', { name: 'Lịch sử' })
    await waitFor(() => expect(history).toBeEnabled())
    await userEvent.click(history)
    await userEvent.click(await screen.findByRole('button', { name: 'Đổi tên Hội thoại một' }))
    const name = screen.getByRole('textbox', { name: 'Tên cuộc trò chuyện' })
    await userEvent.clear(name)
    await userEvent.type(name, 'Tên mới')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu tên' }))
    expect(api.agent.renameSession).toHaveBeenCalledWith('p1', 's1', 'Tên mới')
  })

  it('xác nhận bật tự động và từ chối bật chạy lệnh không thay đổi quyền lệnh', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true).mockReturnValueOnce(false)
    const { api } = installNexgraph()
    render(<Controls />)
    await openSettings()
    await userEvent.selectOptions(screen.getByLabelText('Thực thi'), 'auto')
    await waitFor(() => expect(api.agent.setExecution).toHaveBeenCalledWith('p1', { policy: 'auto', allowCommands: false }))
    const commands = screen.getByRole('checkbox', { name: 'Cho phép chạy lệnh build/test' })
    await waitFor(() => expect(commands).toBeEnabled())
    await userEvent.click(commands)
    expect(api.agent.setExecution).toHaveBeenCalledTimes(1)
    expect(commands).not.toBeChecked()
  })

  it('kết quả nhận diện lệnh của dự án cũ không xuất hiện ở dự án mới', async () => {
    const old = pending<ProjectCommands>()
    installNexgraph({ agent: { projectCommands: vi.fn((pid) => pid === 'p1' ? old.promise : Promise.resolve({ commands: [], warnings: [] })) } })
    const view = render(<Controls />)
    await openSettings()
    await userEvent.click(screen.getByRole('button', { name: 'Nhận diện lệnh dự án' }))
    view.rerender(<Controls projectId="p2" />)
    await act(async () => old.resolve({ commands: [{ id: 'old', label: 'Lệnh dự án cũ', executable: 'pnpm', args: ['test'], cwd: '.', timeoutMs: 1000 }], warnings: [] }))
    expect(screen.queryByText('Lệnh dự án cũ')).not.toBeInTheDocument()
  })
})

describe('useAgentWorkbench ordering', () => {
  it('hai lần tạo phiên trong cùng tick chỉ gọi backend một lần', async () => {
    const create = pending<AgentSessionSnapshot>()
    const { api } = installNexgraph({ agent: { newSession: vi.fn(() => create.promise) } })
    const { result } = renderHook(() => useAgentWorkbench('p1', () => {}))
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => { void result.current.create(); void result.current.create() })
    expect(api.agent.newSession).toHaveBeenCalledTimes(1)
    await act(async () => create.resolve(emptyAgentSnapshot()))
    await waitFor(() => expect(result.current.pending).toBe(false))
  })

  it('snapshot thao tác đã bị invalidate không ghi đè phiên đang dùng', async () => {
    const created = pending<AgentSessionSnapshot>()
    installNexgraph({ agent: { newSession: vi.fn(() => created.promise) } })
    const receive = vi.fn()
    const { result } = renderHook(() => useAgentWorkbench('p1', receive))
    await waitFor(() => expect(result.current.loading).toBe(false))
    receive.mockClear()
    act(() => { void result.current.create(); result.current.invalidate() })
    await act(async () => created.resolve({ ...emptyAgentSnapshot(), session: info }))
    expect(receive).not.toHaveBeenCalled()
    await waitFor(() => expect(result.current.pending).toBe(false))
  })

  it('khôi phục giữ các checkpoint còn xung đột để người dùng thử lại', async () => {
    const initial: AgentSessionSnapshot = { ...emptyAgentSnapshot(), task: {
      id: 'task', sessionId: 'session', status: 'completed', startedAt: 1, finishedAt: 2, turns: 1,
      limits: emptyAgentSnapshot().limits, checkpointIds: ['done', 'conflict']
    } }
    installNexgraph({ agent: {
      snapshot: vi.fn(async () => initial),
      rollback: vi.fn(async () => ({ restored: ['a.ts'], conflicts: [{ path: 'b.ts', reason: 'Bản nháp chưa lưu' }] })),
      checkpoints: vi.fn(async () => [
        { id: 'done', path: 'a.ts', before: 'a', after: 'b', createdAt: 1, restored: true },
        { id: 'conflict', path: 'b.ts', before: 'a', after: 'b', createdAt: 1 }
      ])
    } })
    const { result } = renderHook(() => useAgentWorkbench('p1', () => {}))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => result.current.rollback())
    expect(result.current.task?.checkpointIds).toEqual(['conflict'])
    expect(result.current.notice).toContain('b.ts')
  })
})
