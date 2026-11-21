import { Fragment, useEffect, useRef, useState } from 'react'
import type { AgentMode, ProjectCommands } from '@shared/agent-types'
import { Icon } from '../common/icons'
import { tr } from '../../strings'
import type { AgentInspection, AgentWorkbench } from './useAgentWorkbench'
import './agent-history.css'

const messageOf = (e: unknown): string => e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e)
const pinText = (pinned: boolean): string => pinned ? tr('Bỏ ghim') : tr('Ghim')

/** Thời gian rút gọn kiểu Wu ở cột phải danh sách: vừa xong, 17 phút, 5 giờ, 3 ngày… */
export function ago(time: number, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - time) / 60_000)
  if (minutes < 1) return tr('vừa xong')
  for (const [size, unit] of [[525_600, '{count} năm'], [43_200, '{count} tháng'], [10_080, '{count} tuần'], [1_440, '{count} ngày'], [60, '{count} giờ']] as const)
    if (minutes >= size) return tr(unit, { count: Math.floor(minutes / size) })
  return tr('{count} phút', { count: minutes })
}

/** Danh sách cuộc trò chuyện (khung trái của Wu): ô tìm, hàng 29px, đổi tên/xóa hiện khi rê chuột. */
export function WorkbenchHistory({ work, busy, onPicked }: { work: AgentWorkbench; busy: boolean; onPicked?: () => void }) {
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
  const locked = busy || work.pending || work.loading
  const needle = query.trim().toLocaleLowerCase('vi')
  const sessions = needle ? work.sessions.filter((session) => session.title.toLocaleLowerCase('vi').includes(needle)) : work.sessions
  const pinned = sessions.filter((session) => work.pinnedIds.includes(session.id))
  const unpinned = sessions.filter((session) => !work.pinnedIds.includes(session.id))
  return <section className="agent-history" aria-label={tr('Lịch sử trò chuyện')}>
    <label className="agent-history-search"><Icon name="search" size={15} />
      <input type="search" aria-label={tr('Tìm cuộc trò chuyện')} placeholder={tr('Tìm cuộc trò chuyện…')} value={query} onChange={(event) => setQuery(event.target.value)} />
    </label>
    {work.error && <p role="alert" className="error">{work.error}</p>}
    {work.sessions.length === 0 ? <div className="agent-history-empty">
      <Icon name="chat" size={28} />
      <strong>{tr('Chưa có cuộc trò chuyện')}</strong>
      <span>{tr('Bắt đầu một phiên với trợ lý.')}</span>
      <button type="button" disabled={locked} onClick={() => { void work.create(); onPicked?.() }}><Icon name="plus" size={14} />{tr('Phiên mới')}</button>
    </div> : sessions.length === 0 ? <p className="agent-history-empty">{tr('Không có cuộc trò chuyện khớp')}</p> : <ul className="agent-history-list">
      {pinned.length > 0 && <li className="agent-history-group" role="presentation"><h3>{tr('Đã ghim')}</h3></li>}
      {[...pinned, ...unpinned].map((session, index) => <Fragment key={session.id}>
        {pinned.length > 0 && index === pinned.length && <li className="agent-history-group" role="presentation"><h3>{tr('Khác')}</h3></li>}
        <li className="agent-history-row" aria-current={session.id === work.sessionId ? 'true' : undefined}>
          {renaming?.id === session.id ? <form className="agent-session-rename" onSubmit={(event) => {
            event.preventDefault()
            if (renaming.title.trim()) void work.rename(session.id, renaming.title.trim()).then(() => setRenaming(null))
          }}>
            <input aria-label={tr('Tên cuộc trò chuyện')} value={renaming.title} disabled={locked} autoFocus onChange={(event) => setRenaming({ id: session.id, title: event.target.value })} />
            <button type="submit" disabled={locked || !renaming.title.trim()}>{tr('Lưu tên')}</button>
            <button type="button" disabled={locked} onClick={() => setRenaming(null)}>{tr('Hủy')}</button>
          </form> : <>
            <button type="button" className="agent-history-title" disabled={locked} title={`${session.provider} · ${session.model}`}
              onClick={() => { void work.switchTo(session.id); onPicked?.() }}>
              <span>{session.title}</span><time dateTime={new Date(session.updatedAt).toISOString()}>{ago(session.updatedAt)}</time>
            </button>
            <span className="agent-history-actions">
              <button type="button" className="agent-icon-button agent-history-pin" disabled={locked} aria-pressed={work.pinnedIds.includes(session.id)}
                aria-label={`${pinText(work.pinnedIds.includes(session.id))} ${session.title}`}
                title={`${pinText(work.pinnedIds.includes(session.id))} ${session.title}`}
                onClick={() => work.togglePin(session.id)}>{pinText(work.pinnedIds.includes(session.id))}</button>
              <button type="button" className="agent-icon-button" disabled={locked} aria-label={tr('Tạo nhánh từ {name}', { name: session.title })} title={tr('Tạo nhánh từ {name}', { name: session.title })}
                onClick={() => { void work.fork(session.id, onPicked) }}><Icon name="branch" size={13} /></button>
              <button type="button" className="agent-icon-button" disabled={locked} aria-label={tr('Đổi tên {name}', { name: session.title })} title={tr('Đổi tên {name}', { name: session.title })} onClick={() => setRenaming({ id: session.id, title: session.title })}><Icon name="pencil" size={13} /></button>
              <button type="button" className="agent-icon-button" disabled={locked} aria-label={tr('Xóa {name}', { name: session.title })} title={tr('Xóa {name}', { name: session.title })} onClick={() => { if (window.confirm(tr('Xóa cuộc trò chuyện “{name}”?', { name: session.title }))) void work.remove(session.id) }}><Icon name="trash" size={13} /></button>
            </span>
          </>}
        </li>
      </Fragment>)}
    </ul>}
  </section>
}

export function WorkbenchSettings({ projectId, work, busy, mode, runtime, onSuggest }: { projectId: string; work: AgentWorkbench; busy: boolean; mode: AgentMode | null; runtime?: 'pi' | 'antigravity-cli'; onSuggest?: (text: string) => void }) {
  const [commands, setCommands] = useState<ProjectCommands | null>(null)
  const [localError, setLocalError] = useState('')
  const [commandsLoading, setCommandsLoading] = useState(false)
  const commandRead = useRef(0)
  useEffect(() => {
    commandRead.current++
    setCommands(null); setLocalError(''); setCommandsLoading(false)
    return () => { commandRead.current++ }
  }, [projectId])
  const locked = busy || work.pending || work.loading
  const googleAccount = runtime === 'antigravity-cli'
  const loadCommands = async () => {
    const read = ++commandRead.current
    setCommandsLoading(true); setLocalError('')
    try {
      const result = await window.nexgraph.agent.projectCommands(projectId)
      if (read === commandRead.current) setCommands(result)
    } catch (e) {
      if (read === commandRead.current) setLocalError(messageOf(e))
    } finally { if (read === commandRead.current) setCommandsLoading(false) }
  }
  return <section className="agent-subpanel" aria-label={tr('Quyền và giới hạn AI')}>
    <label>{tr('Thực thi')}<select disabled={locked || mode !== 'edit'} value={work.execution.policy} onChange={(event) => {
      const policy = event.target.value === 'auto' ? 'auto' : 'review'
      if (policy === 'auto' && !window.confirm(tr('Tự động ghi các tệp được phép trong dự án cho phiên này? Lệnh build/test luôn cần bạn duyệt riêng và chỉ chạy khi bạn bật quyền chạy lệnh.'))) return
      void work.saveExecution({ ...work.execution, policy })
    }}><option value="review">{tr('Duyệt từng thay đổi')}</option><option value="auto">{tr('Tự động trong phiên này')}</option></select></label>
    <label><input type="checkbox" checked={work.execution.allowCommands} disabled={locked || mode !== 'edit'} onChange={(event) => {
      if (event.target.checked && !window.confirm(tr('Cho phép chạy script/lệnh của dự án bằng quyền tài khoản Windows/macOS hiện tại? Chỉ bật với dự án bạn tin cậy. Checkpoint lưu mã nguồn văn bản được phép; không hoàn tác mọi tác động bên ngoài của lệnh.'))) return
      void work.saveExecution({ ...work.execution, allowCommands: event.target.checked })
    }} />{tr('Cho phép chạy lệnh build/test')}</label>
    <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void work.saveLimits({ maxTurns: googleAccount ? work.limits.maxTurns : Number(data.get('turns')), maxDurationMs: Number(data.get('minutes')) * 60_000, maxTokens: googleAccount ? work.limits.maxTokens : Number(data.get('tokens')) }) }}>
      <div className="agent-limits" key={`${work.limits.maxTurns}/${work.limits.maxDurationMs}/${work.limits.maxTokens}`}>
        <label>{tr('Lượt mô hình')}{googleAccount ? <input type="text" value={tr('Chưa hỗ trợ')} disabled /> : <input type="number" name="turns" min="1" max="200" defaultValue={work.limits.maxTurns} disabled={locked} required />}</label>
        <label>{tr('Phút / tác vụ')}<input type="number" name="minutes" min="1" max="60" defaultValue={work.limits.maxDurationMs / 60_000} disabled={locked} required /></label>
        <label>{tr('Token / tác vụ')}{googleAccount ? <input type="text" value={tr('Chưa hỗ trợ')} disabled /> : <input type="number" name="tokens" min="1000" max="2000000" step="1000" defaultValue={work.limits.maxTokens} disabled={locked} required />}</label>
      </div><button type="submit" disabled={locked}>{googleAccount ? tr('Lưu thời gian') : tr('Lưu giới hạn')}</button>
    </form>
    <p className="muted small">{tr('Hỏi và Lập kế hoạch luôn chỉ đọc. Quyền chạy lệnh không được bật lại tự động khi mở ứng dụng.')}</p>
    {googleAccount && <p className="muted small">{tr('NexGraph dừng tác vụ khi hết thời gian. Antigravity chưa cung cấp trần lượt mô hình hoặc token cho kết nối này. Token chỉ hiển thị khi CLI báo, không phải số dư tài khoản hay trần thanh toán.')}</p>}
    <button type="button" disabled={locked || commandsLoading} onClick={() => void loadCommands()}>{commandsLoading ? tr('Đang nhận diện lệnh…') : tr('Nhận diện lệnh dự án')}</button>
    {commands && <div className="agent-command-suggestions">{commands.commands.map((command) => <button type="button" key={command.id} disabled={locked} title={`${command.executable} ${command.args.join(' ')}`} onClick={() => onSuggest?.(tr('Hãy chạy {command} và phân tích kết quả. Nếu thất bại, tìm nguyên nhân và đề xuất hoặc thực hiện sửa phù hợp với chế độ hiện tại.', { command: `${command.executable} ${command.args.join(' ')}` }))}>{command.label}</button>)}{commands.warnings.map((warning) => <p className="muted small" key={warning}>{warning}</p>)}</div>}
    {localError && <p role="alert" className="error">{localError}</p>}
  </section>
}

/** Trạng thái tác vụ, token và công cụ của phiên; nằm ngay trên ô soạn tin. */
export function WorkbenchStatus({ projectId, work, busy, onInspect }: { projectId: string; work: AgentWorkbench; busy: boolean; onInspect?: (inspection: AgentInspection) => void }) {
  const [localError, setLocalError] = useState('')
  const activeTask = useRef(work.task?.id)
  activeTask.current = work.task?.id
  useEffect(() => setLocalError(''), [projectId])
  const taskLabels = { running: tr('Đang thực hiện'), waiting_approval: tr('Chờ duyệt'), completed: tr('Hoàn tất'), failed: tr('Thất bại'), cancelled: tr('Đã dừng') }
  return <>
    {work.error && <p role="alert" className="error">{work.error}</p>}
    {localError && <p role="alert" className="error">{localError}</p>}
    {work.notice && <p role="status" className="agent-notice">{work.notice}</p>}
    {work.task && <div className="agent-task-status" role="status"><span>{taskLabels[work.task.status]}{work.task.turnsKnown === false ? ' · Antigravity CLI' : tr(' · {turns}/{max} lượt', { turns: work.task.turns, max: work.task.limits.maxTurns })}</span>
      {!busy && !!work.task.checkpointIds?.length && <>
        <button type="button" disabled={work.pending || work.loading} onClick={() => {
          const taskId = work.task!.id
          void window.nexgraph.agent.checkpoints(projectId, taskId).then((checkpoints) => {
            if (activeTask.current !== taskId) return
            for (const checkpoint of checkpoints) onInspect?.({ id: checkpoint.id, title: tr('Thay đổi · {path}', { path: checkpoint.path }), file: checkpoint.path, before: checkpoint.before, after: checkpoint.after })
          }).catch((e) => setLocalError(messageOf(e)))
        }}>{tr('Xem thay đổi')}</button>
        <button type="button" disabled={work.pending} onClick={() => { if (window.confirm(tr('Khôi phục mã nguồn đã lưu trong checkpoint của tác vụ? Tệp đã bị sửa thêm sẽ được giữ và báo xung đột.'))) void work.rollback() }}>{tr('Hoàn tác')}</button>
      </>}
    </div>}
    {work.tools.length > 0 && <details className="agent-timeline"><summary>{tr('Công cụ ({count})', { count: work.tools.length })}</summary>{work.tools.map((tool) => <details key={tool.id}><summary>{tool.status === 'running' ? '◌' : tool.status === 'failed' ? '×' : '✓'} {tool.name} {tool.durationMs !== undefined && <small>{(tool.durationMs / 1000).toFixed(1)}s</small>}</summary><pre>{tool.input}</pre><pre>{tool.output || tr('Đang chờ kết quả…')}</pre>{onInspect && <button type="button" onClick={() => onInspect({ id: tool.id, title: tool.name, text: tr('Tham số\n{input}\n\nKết quả\n{output}', { input: tool.input, output: tool.output }) })}>{tr('Mở ở vùng làm việc')}</button>}</details>)}</details>}
  </>
}

/** Token tích lũy, hiện ở dòng chân dưới ô soạn tin. */
export function workbenchUsage(work: AgentWorkbench): string | null {
  if (work.usage.inputTokens + work.usage.outputTokens === 0) return null
  const cost = work.usage.costUsd === null ? tr('Chi phí: chưa xác định') : `≈ $${work.usage.costUsd.toFixed(4)}`
  return tr('{input} vào · {output} ra · {cost}', { input: work.usage.inputTokens.toLocaleString(), output: work.usage.outputTokens.toLocaleString(), cost })
}
