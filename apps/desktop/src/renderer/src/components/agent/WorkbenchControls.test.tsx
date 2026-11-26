// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionSnapshot, ProjectCommands } from '@nexgraph/contracts/agent-types'
import { emptyAgentSnapshot, installNexgraph } from '../../test-utils'
import { useAgentWorkbench } from './useAgentWorkbench'
import { WorkbenchHistory, WorkbenchSettings, WorkbenchStatus, ago } from './WorkbenchControls'
import { msgText } from '../../state/messages'

const pending = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const info = { id: 's1', title: 'Hội thoại một', createdAt: 1, updatedAt: 2, provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'm', messageCount: 1 }
function Controls({ projectId = 'p1', runtime, onPicked, onSnapshot }: { projectId?: string; runtime?: 'pi' | 'antigravity-cli'; onPicked?: () => void; onSnapshot?: (snapshot: AgentSessionSnapshot) => void }) {
  const work = useAgentWorkbench(projectId, onSnapshot ?? (() => {}))
  return <>
    <WorkbenchStatus projectId={projectId} work={work} busy={false} />
    <WorkbenchSettings projectId={projectId} work={work} busy={false} mode="edit" runtime={runtime} />
    <WorkbenchHistory work={work} busy={false} onPicked={onPicked} />
  </>
}
const openSettings = async () => {
  await waitFor(() => expect(screen.getByLabelText('Phút / tác vụ')).toBeEnabled())
}
const enabledButton = async (name: string) => {
  const button = await screen.findByRole('button', { name })
  await waitFor(() => expect(button).toBeEnabled())
  return button
}
const clickAction = (button: HTMLElement) => {
  fireEvent.mouseOver(button.closest('li')!)
  fireEvent.click(button)
}
afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

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

  it('M3: dòng thử lại chỉ hiện câu dễ hiểu; chi tiết SDK thô nằm trong mục mở rộng', async () => {
    const { emitAgent } = installNexgraph()
    render(<Controls />)
    act(() => emitAgent('p1', { type: 'retry', attempt: 2, maxAttempts: 2, delayMs: 2000, message: 'terminated: other side closed (UND_ERR_SOCKET)' }))
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Đang thử lại 2/2 sau 2 giây. Không kết nối được tới nhà cung cấp AI.')
    expect(status).not.toHaveTextContent('UND_ERR_SOCKET')
    expect(screen.getByText('Chi tiết kỹ thuật')).toBeInTheDocument()
    expect(screen.getByText('terminated: other side closed (UND_ERR_SOCKET)')).toBeInTheDocument()
    act(() => emitAgent('p1', { type: 'retry', attempt: 1, maxAttempts: 3, delayMs: 1000, message: '429 Too Many Requests' }))
    expect(screen.getByRole('status')).toHaveTextContent('Nhà cung cấp AI đang giới hạn tốc độ hoặc hết hạn mức.')
    expect(screen.getByRole('status')).not.toHaveTextContent('429')
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
    expect(screen.getByRole('button', { name: 'Phiên mới' })).toBeDisabled()
    await act(async () => initial.resolve(emptyAgentSnapshot()))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Phiên mới' })).toBeEnabled())
    expect(api.agent.listSessions).toHaveBeenCalledWith('p1')
  })

  it('đổi tên bằng ô nhập trong ứng dụng và gọi rename đúng phiên', async () => {
    const { api } = installNexgraph({ agent: { listSessions: vi.fn(async () => [info]) } })
    render(<Controls />)
    clickAction(await enabledButton('Đổi tên Hội thoại một'))
    const name = screen.getByRole('textbox', { name: 'Tên cuộc trò chuyện' })
    await userEvent.clear(name)
    await userEvent.type(name, 'Tên mới')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu tên' }))
    expect(api.agent.renameSession).toHaveBeenCalledWith('p1', 's1', 'Tên mới')
  })

  it('lọc danh sách theo ô tìm và ghi thời gian rút gọn', async () => {
    installNexgraph({ agent: { listSessions: vi.fn(async () => [info, { ...info, id: 's2', title: 'Sửa lỗi đăng nhập' }]) } })
    render(<Controls />)
    await screen.findByRole('button', { name: /^Sửa lỗi đăng nhập/ })
    await userEvent.type(screen.getByRole('searchbox', { name: 'Tìm cuộc trò chuyện' }), 'đăng')
    expect(screen.queryByRole('button', { name: /^Hội thoại một/ })).not.toBeInTheDocument()
    expect(ago(0, 30_000)).toBe('vừa xong')
    expect(ago(0, 17 * 60_000)).toBe('17 phút')
    expect(ago(0, 3 * 86_400_000)).toBe('3 ngày')
    expect(ago(0, 15 * 86_400_000)).toBe('2 tuần')
  })

  it('giữ nhóm ghim theo dự án khi chuyển dự án, tải lại và bỏ ghim', async () => {
    const second = { ...info, id: 's2', title: 'Sửa lỗi đăng nhập' }
    const third = { ...info, id: 's3', title: 'Xem báo cáo' }
    installNexgraph({ agent: { listSessions: vi.fn(async (pid) => pid === 'p1'
      ? [info, second, third] : [{ ...third, title: 'Phiên dự án hai' }]) } })
    const view = render(<Controls />)
    clickAction(await enabledButton('Ghim Xem báo cáo'))
    clickAction(screen.getByRole('button', { name: 'Ghim Sửa lỗi đăng nhập' }))
    expect(screen.getByText('Đã ghim')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Khác' })).toBeInTheDocument()
    expect(Array.from(screen.getByRole('list').querySelectorAll('.agent-history-title span'), (node) => node.textContent))
      .toEqual(['Sửa lỗi đăng nhập', 'Xem báo cáo', 'Hội thoại một'])

    await userEvent.type(screen.getByRole('searchbox', { name: 'Tìm cuộc trò chuyện' }), 'đăng')
    expect(screen.getByText('Đã ghim')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Khác' })).not.toBeInTheDocument()
    expect(screen.queryByText('Xem báo cáo')).not.toBeInTheDocument()
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Tìm cuộc trò chuyện' }))
    view.rerender(<Controls projectId="p2" />)
    expect(await screen.findByRole('button', { name: 'Ghim Phiên dự án hai' })).toBeInTheDocument()
    expect(screen.queryByText('Đã ghim')).not.toBeInTheDocument()
    clickAction(await enabledButton('Ghim Phiên dự án hai'))
    view.rerender(<Controls projectId="p1" />)
    expect(await screen.findByRole('button', { name: 'Bỏ ghim Sửa lỗi đăng nhập' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ghim Hội thoại một' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Bỏ ghim Sửa lỗi đăng nhập' })).toHaveAttribute('aria-pressed', 'true')
    view.rerender(<Controls projectId="p2" />)
    expect(await screen.findByRole('button', { name: 'Bỏ ghim Phiên dự án hai' })).toBeInTheDocument()
    view.rerender(<Controls projectId="p1" />)
    await enabledButton('Bỏ ghim Sửa lỗi đăng nhập')
    view.unmount()

    const restored = render(<Controls />)
    clickAction(await enabledButton('Bỏ ghim Sửa lỗi đăng nhập'))
    expect(screen.getByRole('button', { name: 'Bỏ ghim Xem báo cáo' })).toBeInTheDocument()
    restored.unmount()
    render(<Controls />)
    expect(await screen.findByRole('button', { name: 'Ghim Sửa lỗi đăng nhập' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bỏ ghim Xem báo cáo' })).toBeInTheDocument()
  })

  it('khôi phục dữ liệu ghim sai định dạng và bỏ ghim trùng lặp', async () => {
    localStorage.setItem('nexgraph.agent.pinned.p1', '[null,42,"s1","s1",""]')
    installNexgraph({ agent: { listSessions: vi.fn(async () => [info]) } })
    const view = render(<Controls />)
    clickAction(await enabledButton('Bỏ ghim Hội thoại một'))
    expect(screen.queryByText('Đã ghim')).not.toBeInTheDocument()
    view.unmount()
    localStorage.setItem('nexgraph.agent.pinned.p1', '{')
    render(<Controls />)
    expect(await screen.findByRole('button', { name: 'Ghim Hội thoại một' })).toBeInTheDocument()
  })

  it('vẫn mở lịch sử khi không đọc được bộ nhớ ghim và lưu lại khi có thể', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage unavailable') })
    installNexgraph({ agent: { listSessions: vi.fn(async () => [info]) } })
    const view = render(<Controls />)
    clickAction(await enabledButton('Ghim Hội thoại một'))
    expect(screen.getByRole('button', { name: 'Bỏ ghim Hội thoại một' })).toBeInTheDocument()
    getItem.mockRestore()
    view.unmount()
    render(<Controls />)
    expect(await screen.findByRole('button', { name: 'Bỏ ghim Hội thoại một' })).toBeInTheDocument()
  })

  it('bỏ ghim phiên đã xóa ngay cả khi tải snapshot sau đó thất bại', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const snapshot = vi.fn(async () => emptyAgentSnapshot()).mockResolvedValueOnce(emptyAgentSnapshot())
      .mockRejectedValueOnce(new Error('Không tải được snapshot'))
    const { api } = installNexgraph({ agent: { snapshot, listSessions: vi.fn(async () => [info]) } })
    const view = render(<Controls />)
    clickAction(await enabledButton('Ghim Hội thoại một'))
    clickAction(screen.getByRole('button', { name: 'Xóa Hội thoại một' }))
    expect(await within(screen.getByRole('region', { name: 'Lịch sử trò chuyện' })).findByRole('alert')).toHaveTextContent('Không tải được snapshot')
    expect(api.agent.deleteSession).toHaveBeenCalledWith('p1', 's1')
    view.unmount()
    render(<Controls />)
    expect(await screen.findByRole('button', { name: 'Ghim Hội thoại một' })).toBeInTheDocument()
  })

  it('giữ ghim nếu không xóa được hội thoại', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    installNexgraph({ agent: {
      deleteSession: vi.fn(async () => { throw new Error('Không thể xóa') }),
      listSessions: vi.fn(async () => [info])
    } })
    const view = render(<Controls />)
    clickAction(await enabledButton('Ghim Hội thoại một'))
    clickAction(screen.getByRole('button', { name: 'Xóa Hội thoại một' }))
    expect(await within(screen.getByRole('region', { name: 'Lịch sử trò chuyện' })).findByRole('alert')).toHaveTextContent('Không thể xóa')
    view.unmount()
    render(<Controls />)
    expect(await screen.findByRole('button', { name: 'Bỏ ghim Hội thoại một' })).toBeInTheDocument()
  })

  it('xóa ghim của dự án gốc dù chuyển dự án trong khi đang xóa', async () => {
    const deletion = pending<void>()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    installNexgraph({ agent: {
      deleteSession: vi.fn(() => deletion.promise),
      listSessions: vi.fn(async (pid) => pid === 'p1' ? [info] : [{ ...info, title: 'Phiên dự án hai' }])
    } })
    const view = render(<Controls />)
    clickAction(await enabledButton('Ghim Hội thoại một'))
    clickAction(screen.getByRole('button', { name: 'Xóa Hội thoại một' }))
    view.rerender(<Controls projectId="p2" />)
    await enabledButton('Ghim Phiên dự án hai')
    await act(async () => deletion.resolve())
    view.rerender(<Controls projectId="p1" />)
    expect(await screen.findByRole('button', { name: 'Ghim Hội thoại một' })).toBeInTheDocument()
  })

  it('xóa ghim khi quay lại dự án trước khi thao tác xóa hoàn tất', async () => {
    const deletion = pending<void>()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    installNexgraph({ agent: {
      deleteSession: vi.fn(() => deletion.promise),
      listSessions: vi.fn(async (pid) => pid === 'p1' ? [info] : [{ ...info, title: 'Phiên dự án hai' }])
    } })
    const view = render(<Controls />)
    clickAction(await enabledButton('Ghim Hội thoại một'))
    clickAction(screen.getByRole('button', { name: 'Xóa Hội thoại một' }))
    view.rerender(<Controls projectId="p2" />)
    await enabledButton('Ghim Phiên dự án hai')
    view.rerender(<Controls projectId="p1" />)
    await enabledButton('Bỏ ghim Hội thoại một')
    await act(async () => deletion.resolve())
    expect(screen.getByRole('button', { name: 'Ghim Hội thoại một' })).toBeInTheDocument()
  })

  it('không khôi phục ghim cũ từ phiên đang tải khi xóa hoàn tất', async () => {
    const deletion = pending<void>()
    const firstList = pending<(typeof info)[]>()
    let p1Reads = 0
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    installNexgraph({ agent: {
      deleteSession: vi.fn(() => deletion.promise),
      listSessions: vi.fn((pid) => pid === 'p1'
        ? ++p1Reads === 1 ? Promise.resolve([info]) : firstList.promise
        : Promise.resolve([{ ...info, title: 'Phiên dự án hai' }]))
    } })
    const view = render(<Controls />)
    clickAction(await enabledButton('Ghim Hội thoại một'))
    clickAction(screen.getByRole('button', { name: 'Xóa Hội thoại một' }))
    view.rerender(<Controls projectId="p2" />)
    await enabledButton('Ghim Phiên dự án hai')
    view.rerender(<Controls projectId="p1" />)
    await waitFor(() => expect(p1Reads).toBe(2))
    await act(async () => deletion.resolve())
    await act(async () => firstList.resolve([info]))
    expect(await enabledButton('Ghim Hội thoại một')).toBeInTheDocument()
  })

  it('báo lỗi lưu ghim nhưng vẫn cho phép dùng trong phiên hiện tại', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable') })
    installNexgraph({ agent: { listSessions: vi.fn(async () => [info]) } })
    render(<Controls />)
    clickAction(await enabledButton('Ghim Hội thoại một'))
    expect(screen.getByRole('button', { name: 'Bỏ ghim Hội thoại một' })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Lịch sử trò chuyện' })).getByRole('alert')).toHaveTextContent('Không thể lưu')
  })

  it('tạo nhánh của phiên và mở snapshot mới mà không xóa phiên cũ', async () => {
    const child = { ...info, id: 's2', title: 'Nhánh mới' }
    const forked = { ...emptyAgentSnapshot(), session: child }
    let sessions = [info]
    const forkSession = vi.fn(async () => { sessions = [child, info]; return forked })
    const onPicked = vi.fn()
    const onSnapshot = vi.fn()
    const { api } = installNexgraph({ agent: { forkSession, listSessions: vi.fn(async () => sessions) } })
    render(<Controls onPicked={onPicked} onSnapshot={onSnapshot} />)
    clickAction(await enabledButton('Tạo nhánh từ Hội thoại một'))
    await waitFor(() => expect(onPicked).toHaveBeenCalledTimes(1))
    expect(forkSession).toHaveBeenCalledWith('p1', 's1')
    expect(onSnapshot).toHaveBeenCalledWith(forked)
    expect((await screen.findByRole('button', { name: /^Nhánh mới/ })).closest('li')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: /^Hội thoại một/ })).toBeInTheDocument()
    expect(api.agent.deleteSession).not.toHaveBeenCalled()
  })

  it('mở nhánh ngay sau khi nhận snapshot dù danh sách chưa tải lại', async () => {
    const list = pending<(typeof info)[]>()
    const child = { ...info, id: 's2', title: 'Nhánh mới' }
    const onPicked = vi.fn()
    const onSnapshot = vi.fn()
    installNexgraph({ agent: {
      listSessions: vi.fn().mockResolvedValueOnce([info]).mockImplementation(() => list.promise),
      forkSession: vi.fn(async () => ({ ...emptyAgentSnapshot(), session: child }))
    } })
    render(<Controls onPicked={onPicked} onSnapshot={onSnapshot} />)
    clickAction(await enabledButton('Tạo nhánh từ Hội thoại một'))
    await waitFor(() => expect(onPicked).toHaveBeenCalledTimes(1))
    expect(onSnapshot).toHaveBeenCalledWith(expect.objectContaining({ session: child }))
    await act(async () => list.resolve([child, info]))
  })

  it('giữ lịch sử và hiện lỗi nếu tạo nhánh thất bại', async () => {
    const onPicked = vi.fn()
    installNexgraph({ agent: { forkSession: vi.fn(async () => { throw new Error('Không thể tạo nhánh') }), listSessions: vi.fn(async () => [info]) } })
    render(<Controls onPicked={onPicked} />)
    clickAction(await enabledButton('Tạo nhánh từ Hội thoại một'))
    expect(await within(screen.getByRole('region', { name: 'Lịch sử trò chuyện' })).findByRole('alert')).toHaveTextContent('Không thể tạo nhánh')
    expect(onPicked).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /^Hội thoại một/ })).toBeInTheDocument()
  })

  it('không mở nhánh của dự án cũ khi chuyển dự án trước khi hoàn tất', async () => {
    const fork = pending<AgentSessionSnapshot>()
    const onPicked = vi.fn()
    const onSnapshot = vi.fn()
    installNexgraph({ agent: { forkSession: vi.fn(() => fork.promise), listSessions: vi.fn(async (pid) =>
      pid === 'p1' ? [info] : [{ ...info, title: 'Phiên dự án hai' }]) } })
    const view = render(<Controls onPicked={onPicked} onSnapshot={onSnapshot} />)
    clickAction(await enabledButton('Tạo nhánh từ Hội thoại một'))
    view.rerender(<Controls projectId="p2" onPicked={onPicked} onSnapshot={onSnapshot} />)
    await enabledButton('Ghim Phiên dự án hai')
    const oldFork = { ...emptyAgentSnapshot(), session: { ...info, id: 'old-fork' } }
    await act(async () => fork.resolve(oldFork))
    expect(onPicked).not.toHaveBeenCalled()
    expect(onSnapshot).not.toHaveBeenCalledWith(oldFork)
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
    expect(msgText(result.current.notice)).toContain('b.ts')
  })
})
