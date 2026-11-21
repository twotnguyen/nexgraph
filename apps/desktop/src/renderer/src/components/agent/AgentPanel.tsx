import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { consentTargetForSettings, sameConsentTarget, type AiConsentTarget, type AgentMode, type ApprovalRequest, type AgentContextItem, type FileApprovalRequest, type ModelInfo } from '@shared/agent-types'
import type { AiSettings, Citation, GraphEdge, GraphNode } from '@shared/graph-types'
import { vi } from '../../strings'
import { Icon, type IconName } from '../common/icons'
import { ApprovalCard } from './ApprovalCard'
import { CitationText } from '../chat/CitationText'
import { ConsentDialog } from '../chat/ConsentDialog'
import { ConnectionDialog } from './ConnectionDialog'
import { useAgentWorkbench, type AgentInspection } from './useAgentWorkbench'
import { WorkbenchHistory, WorkbenchSettings, WorkbenchStatus, workbenchUsage } from './WorkbenchControls'
import { AnswerRating } from './AnswerRating'
import './agent-panel.css'

interface Props {
  id?: string
  projectId: string
  projectName?: string
  hidden?: boolean
  activeFile?: FileContext
  getEditorContext?: () => AgentContextItem | null
  graphContext?: AgentContextItem
  beforePrompt?: () => Promise<void>
  onInspect?: (inspection: AgentInspection) => void
  onClose?: () => void
  onConnectOpenCode?: () => void
  onOpenCode: (file: string, line: number, lineEnd?: number) => void
  onHighlight: (nodes: GraphNode[], edges: GraphEdge[], notice: string | null) => void
  onOpenSettings: () => void
  /** Khung đang nằm bên nào; có thì menu ⋯ hiện mục chuyển sang bên kia. */
  dock?: 'left' | 'right'
  onToggleDock?: () => void
}

type FileContext = { file: string; line: number; lineEnd?: number }
type Msg = { id: number | string; role: 'user'; content: string; context?: FileContext } | { id: number | string; role: 'assistant'; content: string; citations: Citation[]; tools: string[] }
type PendingConsent = { question: string; target: AiConsentTarget; model: string; context?: FileContext; attachments?: AgentContextItem[] }

/** Câu hỏi của lượt mà câu trả lời thứ `i` thuộc về. */
function questionBefore(msgs: Msg[], i: number): string {
  for (let j = i - 1; j >= 0; j--) if (msgs[j].role === 'user') return msgs[j].content
  return ''
}

function fileReference(context: FileContext): string {
  const { file, line, lineEnd } = context
  if (lineEnd && lineEnd > line) return `${file}:${line}-${lineEnd}`
  return line > 1 ? `${file}:${line}` : file
}

function targetOf(settings: AiSettings): AiConsentTarget | null {
  return consentTargetForSettings(settings)
}

function connectionLabel(settings: AiSettings | null): string {
  return settings?.runtime === 'antigravity-cli' ? `${settings.model === 'auto' || settings.model.toLowerCase().startsWith('gemini') ? 'Gemini' : 'Antigravity'} · Tài khoản Google` : settings?.provider === 'google' ? 'Gemini · API key'
    : settings?.provider === 'ollama-local' ? 'Ollama · Trên máy' : settings?.provider === 'openai' ? 'ChatGPT / OpenAI'
      : settings?.provider === 'openai-codex' ? 'Codex · ChatGPT' : settings?.provider === 'anthropic' ? 'Claude · API key'
        : settings?.provider === 'openrouter' ? 'OpenRouter · API key' : settings?.provider ?? 'Chưa có kết nối'
}

function errorCode(e: unknown): string {
  return e && typeof e === 'object' && 'code' in e ? String(e.code) : ''
}

function errorMessage(e: unknown): string {
  return vi.chat.errors[errorCode(e)] || (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e))
}

function isFileApproval(value: unknown): value is FileApprovalRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<FileApprovalRequest>
  return (request.tool === 'edit' || request.tool === 'write')
    && typeof request.id === 'string' && request.id.trim() !== ''
    && typeof request.path === 'string' && request.path.trim() !== ''
    && typeof request.before === 'string' && typeof request.after === 'string'
}

function isApproval(value: unknown): value is ApprovalRequest {
  if (isFileApproval(value)) return true
  const request = value as Partial<Extract<ApprovalRequest, { tool: 'command' }>> | null
  return !!request && request.tool === 'command' && typeof request.id === 'string' && !!request.id
    && typeof request.executable === 'string' && Array.isArray(request.args) && request.args.every((arg) => typeof arg === 'string')
    && typeof request.cwd === 'string' && Number.isFinite(request.timeoutMs)
}

const contextLabel = (item: AgentContextItem): string => item.kind === 'file'
  ? `${item.file}${item.start ? `:${item.start}${item.end && item.end !== item.start ? `-${item.end}` : ''}` : ''}${item.dirty ? ' · bản nháp' : ''}`
  : item.label ?? (item.kind === 'node' ? item.nodeId : item.kind === 'flow' ? `Luồng ${item.flowId}` : item.blockId)

type MenuItem = { label: string; icon: IconName; onSelect: () => void; disabled?: boolean }

/** Menu ⋯ ở đầu khung: popover bo 12px, hàng bo 7px như popover của Wu. */
function MoreMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])
  return <div className="agent-menu-wrap" ref={root}>
    <button type="button" className="agent-icon-button" aria-label="Thêm thao tác" title="Thêm thao tác" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}><Icon name="more" size={16} /></button>
    {open && <div role="menu" className="agent-menu">
      {items.map((item) => <button key={item.label} type="button" role="menuitem" disabled={item.disabled} onClick={() => { setOpen(false); item.onSelect() }}>
        <Icon name={item.icon} size={14} /><span>{item.label}</span>
      </button>)}
    </div>}
  </div>
}

export function AgentPanel(props: Props) {
  return <ProjectAgentPanel key={props.projectId} {...props} />
}

function ProjectAgentPanel({ id, projectId, projectName = projectId, hidden, activeFile, getEditorContext, graphContext, beforePrompt, onInspect, onClose, onConnectOpenCode, onOpenCode, onHighlight, onOpenSettings, dock, onToggleDock }: Props) {
  const [view, setView] = useState<'chat' | 'history' | 'settings'>('chat')
  const [cfg, setCfg] = useState<AiSettings | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [fileContext, setFileContext] = useState<FileContext>()
  const [attachments, setAttachments] = useState<AgentContextItem[]>([])
  const [connect, setConnect] = useState(false)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [tool, setTool] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [consent, setConsent] = useState<PendingConsent | null>(null)
  const [checking, setChecking] = useState(false)
  const [openTools, setOpenTools] = useState<number | string | null>(null)
  const [draft, setDraft] = useState('') // chữ đang chảy về của lượt hiện tại
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([])
  const [mode, setMode] = useState<AgentMode | null>(null)
  const [changingMode, setChangingMode] = useState(true)
  const modeRef = useRef<AgentMode | null>(null)
  const modePending = useRef(true)
  const turn = useRef<{ id: number; q: string; context?: FileContext; attachments?: AgentContextItem[]; tools: string[]; mode: AgentMode; cancelled?: boolean } | null>(null)
  const turnSeq = useRef(0)
  const failedTurns = useRef(new Set<number>())
  const editWarned = useRef(false) // lần đầu sang Sửa giải thích việc duyệt từng tệp
  const mounted = useRef(true)
  const visible = useRef(!hidden)
  visible.current = !hidden
  const scope = useRef<AiConsentTarget | null>(null)
  const operation = useRef<number | null>(null)
  const operationSeq = useRef(0)
  const messages = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const followMessages = useRef(true)
  const work = useAgentWorkbench(projectId, (snapshot) => {
    if (turn.current || operation.current !== null) return
    setMsgs(snapshot.messages.map((message) => message.role === 'user'
      ? { id: message.id, role: 'user', content: message.text }
      : { id: message.id, role: 'assistant', content: message.text, citations: message.citations, tools: message.tools.map((tool) => tool.name) }))
    setApprovals([])
    setOpenTools(null)
    modeRef.current = snapshot.mode
    setMode(snapshot.mode)
    if (snapshot.mode === 'edit') editWarned.current = true
  })

  useEffect(() => {
    if (hidden || !followMessages.current || !messages.current) return
    messages.current.scrollTop = messages.current.scrollHeight
  }, [hidden, msgs, draft, busy])

  const applySettings = (settings: AiSettings) => {
    const target = targetOf(settings)
    if (scope.current && !sameConsentTarget(scope.current, target)) {
      work.invalidate()
      setMsgs([])
      setApprovals([])
      setOpenTools(null)
      failedTurns.current.clear()
      void work.restore().catch((e) => { if (mounted.current) setError(errorMessage(e)) })
    }
    scope.current = target
    setCfg(settings)
    return target
  }

  const end = () => {
    turn.current = null
    setApprovals([])
    setBusy(false)
    setTool(null)
    setDraft('')
  }
  const fail = (q: string, message: string) => {
    const id = turn.current?.id ?? ++turnSeq.current
    if (failedTurns.current.has(id)) return
    failedTurns.current.add(id)
    // Giữ câu hỏi và gắn thông báo lỗi vào đúng id lượt; không xoá phần tử cuối (có thể là lượt khác).
    setMsgs((cur) => [...cur, { id, role: 'assistant', content: message, citations: [], tools: [] }])
    setText(q)
    setFileContext(turn.current?.context)
    setAttachments(turn.current?.attachments ?? [])
    setError(message)
    end()
  }

  useEffect(() => {
    let alive = true
    let read = 0
    mounted.current = true
    const refresh = () => {
      if (operation.current !== null || turn.current) return
      const which = ++read
      const beforeSubmit = operationSeq.current
      const stillCurrent = () => alive && which === read && beforeSubmit === operationSeq.current && !turn.current
      void window.nexgraph.ai.getSettings().then((s) => {
        if (stillCurrent()) applySettings(s)
      }).catch((e) => {
        if (!stillCurrent()) return
        applySettings({ baseUrl: '', model: '', hasKey: false })
        setError(errorMessage(e))
      })
    }
    refresh()
    void window.nexgraph.auth.models().then((items) => { if (alive) setModels(items) }).catch(() => {})
    window.addEventListener('focus', refresh)
    window.nexgraph.agent.getMode(projectId).then((m) => {
      if (!alive) return
      if (m === 'edit') editWarned.current = true // phiên đã ở Sửa từ trước thì không hỏi lại
      modeRef.current = m
      setMode(m)
    }).catch(() => {
      if (alive) setError(vi.agent.modeFailed)
    }).finally(() => {
      if (!alive) return
      modePending.current = false
      setChangingMode(false)
    })
    const off = window.nexgraph.agent.onEvent((pid, e) => {
      const t = turn.current
      if (!mounted.current || pid !== projectId) return
      if (e.type === 'approval') {
        const { request } = e
        if (t?.mode !== 'edit' || modeRef.current !== 'edit' || modePending.current || !isApproval(request)) return
        setApprovals((cur) => (cur.some((a) => a.id === request.id) ? cur : [...cur, request]))
        return
      }
      if (e.type === 'approval_closed') {
        setApprovals((cur) => cur.filter((a) => a.id !== e.id)) // id lạ không có gì để gỡ
        return
      }
      if (!t) return
      if (e.type === 'write_conflict') {
        if (t.mode === 'edit') setError(e.message)
        return
      }
      if (e.type === 'tool' && e.status === 'start') {
        t.tools.push(e.name)
        setTool(e.name)
      } else if (e.type === 'text') setDraft((d) => d + e.delta)
      else if (e.type === 'done') {
        setMsgs((cur) => [...cur, { id: t.id, role: 'assistant', content: e.text, citations: e.citations, tools: t.tools }])
        end()
      } else if (e.type === 'error') fail(t.q, vi.chat.errors[e.code] || e.message)
    })
    return () => {
      alive = false
      mounted.current = false
      operation.current = null
      if (turn.current) void window.nexgraph.agent.abort(projectId)
      turn.current = null
      window.removeEventListener('focus', refresh)
      off()
    }
  }, [projectId])

  useEffect(() => {
    if (!hidden) return
    operation.current = null
    setConsent(null)
    setChecking(false)
  }, [hidden])

  const configured = !!cfg && !!targetOf(cfg)
  const availableModels = models.filter((model) => cfg?.runtime === 'antigravity-cli'
    ? model.runtime === 'antigravity-cli' || model.provider === 'google-antigravity' : model.provider === cfg?.provider && model.runtime !== 'antigravity-cli')
  const toolsUnavailable = models.find((model) => model.provider === cfg?.provider && model.id === cfg?.model)?.supportsTools === false

  const isCurrent = (id: number) => mounted.current && visible.current && operation.current === id
  const begin = () => {
    if (!visible.current || operation.current !== null || turn.current || modePending.current || !modeRef.current || work.pending || work.loading || (modeRef.current === 'edit' && toolsUnavailable)) return null
    const id = ++operationSeq.current
    work.invalidate()
    operation.current = id
    setChecking(true)
    setError(null)
    return id
  }

  const finish = (id: number) => {
    if (!isCurrent(id)) return
    operation.current = null
    setChecking(false)
  }

  const pickMode = async (m: AgentMode) => {
    if (m === modeRef.current || modePending.current || operation.current !== null || consent || !visible.current || work.pending || work.loading) return
    if (m === 'edit' && turn.current) return
    if (m === 'edit' && !editWarned.current) {
      if (!window.confirm(vi.agent.editWarn)) return
      editWarned.current = true
    }
    modePending.current = true
    setChangingMode(true)
    setError(null)
    try {
      await window.nexgraph.agent.setMode(projectId, m)
      if (!mounted.current) return
      modeRef.current = m
      setMode(m)
      if (m !== 'edit') setApprovals([])
    } catch {
      if (!mounted.current) return
      modeRef.current = null
      setMode(null)
      setApprovals([])
      setError(vi.agent.modeFailed)
    } finally {
      modePending.current = false
      if (mounted.current) setChangingMode(false)
    }
  }

  const run = async (question: string, target: AiConsentTarget, context?: FileContext, attached: AgentContextItem[] = attachments) => {
    const mode = modeRef.current
    if (!mode) return
    const id = ++turnSeq.current
    turn.current = { id, q: question, context, attachments: attached, tools: [], mode }
    followMessages.current = true
    setMsgs((cur) => [...cur, { id, role: 'user', content: question, context }])
    setText('')
    setFileContext(undefined)
    setAttachments([])
    setError(null)
    setBusy(true)
    setTool(null)
    setDraft('')
    try {
      await beforePrompt?.()
      if (!mounted.current || turn.current?.id !== id || turn.current.cancelled) return
      const prompt = context ? `${question}\n\n${vi.chat.filePrompt(fileReference(context))}` : question
      if (attached.length) await window.nexgraph.agent.prompt(projectId, prompt, target, { context: attached })
      else await window.nexgraph.agent.prompt(projectId, prompt, target)
    } catch (e) {
      if (!mounted.current || turn.current?.id !== id) return
      if (errorCode(e) === 'ai_provider_changed') {
        setMsgs((cur) => cur.filter((m) => m.id !== id))
        setText(question)
        setFileContext(context)
        setAttachments(attached)
        setError(errorMessage(e))
        end()
      } else fail(question, errorMessage(e))
    }
  }

  const submit = async () => {
    const q = text.trim()
    if (!q || busy || consent || operation.current !== null || !visible.current) return
    if (q === '/login') {
      setText('')
      setConnect(true)
      return
    }
    const id = begin()
    if (id === null) return
    try {
      const settings = await window.nexgraph.ai.getSettings()
      if (!isCurrent(id)) return
      const target = applySettings(settings)
      if (!target) throw new Error(vi.chat.notConfigured)
      const allowed = await window.nexgraph.ai.hasConsent(projectId, target)
      if (!isCurrent(id)) return
      if (allowed) void run(q, target, fileContext)
      else setConsent({ question: q, target, model: settings.model, context: fileContext, attachments })
    } catch (e) {
      if (isCurrent(id)) setError(errorMessage(e))
    } finally {
      finish(id)
    }
  }

  const confirmConsent = async (pending: PendingConsent) => {
    const id = begin()
    if (id === null) return
    setConsent(null)
    try {
      const settings = await window.nexgraph.ai.getSettings()
      if (!isCurrent(id)) return
      const current = applySettings(settings)
      if (!sameConsentTarget(current, pending.target) || settings.model !== pending.model)
        throw new Error(vi.chat.errors.ai_provider_changed)
      await window.nexgraph.ai.grantConsent(projectId, pending.target)
      if (isCurrent(id)) void run(pending.question, pending.target, pending.context, pending.attachments)
    } catch (e) {
      if (isCurrent(id)) setError(errorMessage(e))
    } finally {
      finish(id)
    }
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  const highlight = async (citations: Citation[]) => {
    const seen = new Set<string>()
    const ids: string[] = []
    for (const c of citations.filter((x) => x.valid)) {
      try {
        const { node } = await window.nexgraph.graph.locate(projectId, c.file, c.start)
        if (!seen.has(node.id)) { seen.add(node.id); ids.push(node.id) }
      } catch { /* trích dẫn không định vị được thì bỏ qua */ }
    }
    if (ids.length < 2) return onHighlight([], [], vi.chat.highlightNone)
    try {
      const r = await window.nexgraph.graph.paths(projectId, ids.slice(0, 10))
      const linked = r.unconnected.length === 0
      onHighlight(r.nodes, linked ? r.edges : [], linked ? null : vi.path.noLink)
    } catch (e) {
      onHighlight([], [], e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e))
    }
  }

  const decide = (id: string, allow: boolean) => {
    if (!visible.current || modePending.current || modeRef.current !== 'edit' || turn.current?.mode !== 'edit') return
    const current = turn.current
    void (async () => {
      if (allow) await beforePrompt?.()
      if (!mounted.current || !visible.current || modePending.current || modeRef.current !== 'edit' || turn.current !== current || current?.cancelled) return
      await window.nexgraph.agent.approve(projectId, id, allow)
    })().catch((e) => {
      if (mounted.current) setError(errorMessage(e))
    })
  }
  const modeLocked = changingMode || checking || !!consent || work.pending || work.loading
  const composerLocked = !configured || !mode || busy || modeLocked || (mode === 'edit' && toolsUnavailable)
  const changeModel = async (key: string) => {
    if (busy || checking) return
    setChecking(true)
    try {
      const selected = models.find((model) => `${model.provider}\n${model.id}` === key)
      if (!selected) return
      await window.nexgraph.auth.selectModel(selected.provider, selected.id)
      applySettings(await window.nexgraph.ai.getSettings())
      await work.restore()
    } catch (e) { setError(errorMessage(e)) }
    finally { setChecking(false) }
  }
  const attachedFile = attachments.find((item) => item.kind === 'file')
  const attachEditor = () => {
    const item = getEditorContext?.()
    if (item) { setAttachments((current) => [...current.filter((attachment) => attachment.kind !== 'file'), { ...item }]); setFileContext(undefined) }
    else setFileContext(activeFile)
    input.current?.focus()
  }
  const stop = () => {
    const current = turn.current
    if (current) current.cancelled = true
    void window.nexgraph.agent.abort(projectId).catch((e) => { if (mounted.current) setError(errorMessage(e)) }).finally(() => {
      if (mounted.current && turn.current === current) end()
    })
  }

  const workLocked = busy || checking || work.pending || work.loading
  const sessionTitle = work.sessions.find((session) => session.id === work.sessionId)?.title
  const usage = workbenchUsage(work)
  const modeHint = mode === 'edit' ? work.execution.policy === 'auto' ? 'Tự động sửa mã trong phạm vi đã cấp quyền.' : vi.agent.editHint : mode === 'plan' ? 'Phân tích đồ thị và lập kế hoạch triển khai, chỉ đọc.' : vi.agent.askHint
  const menu: MenuItem[] = [
    { label: 'Kết nối AI', icon: 'plug', disabled: busy || checking, onSelect: () => setConnect(true) },
    ...(onConnectOpenCode ? [{ label: vi.chat.connectOpenCode, icon: 'plug' as const, onSelect: onConnectOpenCode }] : []),
    { label: 'Quyền & giới hạn', icon: 'shield', onSelect: () => setView('settings') },
    // Chuyển bên làm khung dựng lại từ đầu, nên khoá khi đang có lượt chạy để không huỷ lượt đó.
    ...(onToggleDock ? [{ label: dock === 'left' ? 'Chuyển khung chat sang phải' : 'Chuyển khung chat sang trái', icon: dock === 'left' ? 'panelRight' as const : 'panelLeft' as const, disabled: busy || checking, onSelect: onToggleDock }] : []),
    { label: vi.chat.settings, icon: 'sliders', onSelect: onOpenSettings }
  ]

  return (
    <aside id={id} className="chat agent-panel" data-dock={dock} aria-label={vi.chat.title} hidden={hidden}>
      <header className="agent-head">
        {view !== 'chat' && <button type="button" className="agent-icon-button" aria-label="Về cuộc trò chuyện" title="Về cuộc trò chuyện" onClick={() => setView('chat')}><Icon name="back" size={16} /></button>}
        <h2 title={view === 'chat' ? sessionTitle : undefined}>{view === 'history' ? 'Trò chuyện' : view === 'settings' ? 'Quyền & giới hạn' : sessionTitle ?? vi.chat.title}</h2>
        <div className="agent-actions">
          <button type="button" className="agent-icon-button" aria-label="Lịch sử" title="Lịch sử trò chuyện" aria-pressed={view === 'history'} disabled={workLocked}
            onClick={() => { setView(view === 'history' ? 'chat' : 'history'); void work.refresh().catch(() => {}) }}><Icon name="history" size={16} /></button>
          <button type="button" className="agent-icon-button" aria-label="Phiên mới" title="Phiên mới" disabled={workLocked} onClick={() => { void work.create(); setView('chat') }}><Icon name="plus" size={16} /></button>
          <MoreMenu items={menu} />
          {onClose && <button type="button" className="agent-icon-button" onClick={onClose} aria-label={vi.chat.close} title={vi.chat.close}><Icon name="close" size={15} /></button>}
        </div>
      </header>
      {view === 'history' && <WorkbenchHistory work={work} busy={busy || checking} onPicked={() => setView('chat')} />}
      {view === 'settings' && <div className="agent-settings-view"><WorkbenchSettings projectId={projectId} work={work} busy={busy || checking} mode={mode} runtime={cfg?.runtime} onSuggest={(suggestion) => { setText(suggestion); setView('chat'); input.current?.focus() }} /></div>}
      <div className="agent-thread" hidden={view !== 'chat'}>
        {toolsUnavailable && <p className="agent-notice">Model này không hỗ trợ gọi công cụ. Hãy đổi model để sửa mã và chạy kiểm thử.</p>}
        {error && <p role="alert" className="error">{error}</p>}
        <div className="msgs" ref={messages} onScroll={(event) => {
          const el = event.currentTarget
          followMessages.current = el.scrollHeight - el.clientHeight - el.scrollTop < 36
        }}>
          {cfg && msgs.length === 0 && !busy && (
            <div className="agent-welcome">
              {configured ? <>
                <span className="agent-folder-chip" title={projectName}><Icon name="folder" size={13} />{projectName}</span>
                <h3>{vi.chat.startTitle}</h3>
                <div className="agent-starters">
                  {vi.chat.starters.map((suggestion) => <button key={suggestion} type="button" disabled={modeLocked} onClick={() => {
                    setText(suggestion)
                    input.current?.focus()
                  }}><Icon name="spark" size={14} />{suggestion}</button>)}
                </div>
              </> : <>
                <span className="agent-welcome-icon"><Icon name="spark" size={22} /></span>
                <h3>{vi.chat.setupTitle}</h3>
                <p className="muted">{vi.chat.setupDescription}</p>
                <button type="button" className="primary" onClick={() => setConnect(true)}>Kết nối AI</button>
              </>}
            </div>
          )}
          {msgs.map((m, i) => m.role === 'user' ? (
            <div key={`user-${m.id}`} className="me">
              {m.content}
              {m.context && <span className="agent-sent-file mono" title={fileReference(m.context)}>{fileReference(m.context)}</span>}
            </div>
          ) : (
            <div key={`assistant-${m.id}`} className="ai">
              <CitationText text={m.content} citations={m.citations} onOpen={onOpenCode} />
              <div className="foot muted">
                {m.citations.length === 0 ? <span>{vi.chat.noCitations}</span>
                  : <span>{vi.chat.verified(m.citations.filter((c) => c.valid).length, m.citations.length)}</span>}
                {m.citations.some((c) => c.valid) && (
                  <button type="button" className="link" onClick={() => void highlight(m.citations)}>{vi.chat.highlight}</button>
                )}
                {m.tools.length > 0 && (
                  <button type="button" className="link" onClick={() => setOpenTools(openTools === m.id ? null : m.id)}>{vi.chat.tools(m.tools.length)}</button>
                )}
                {questionBefore(msgs, i) && <AnswerRating projectId={projectId} question={questionBefore(msgs, i)} answer={m.content} citations={m.citations} />}
              </div>
              {openTools === m.id && (
                <ul className="tool-list mono">
                  {m.tools.map((t, k) => <li key={`${m.id}-${k}`}>{t}</li>)}
                </ul>
              )}
            </div>
          ))}
          {busy && draft && <div className="ai"><CitationText text={draft} citations={[]} onOpen={onOpenCode} /></div>}
          {busy && <div className="ai agent-thinking muted" role="status"><span className="agent-spinner" aria-hidden="true" />{tool ? vi.chat.usingTool(tool) : vi.chat.thinking}</div>}
        </div>
        <div className="agent-workbench-status"><WorkbenchStatus projectId={projectId} work={work} busy={busy || checking} onInspect={onInspect} /></div>
        {approvals.length > 0 && (
          <div className="approvals">
            {approvals.map((a) => <ApprovalCard key={a.id} request={a} disabled={changingMode} onDecide={(allow) => decide(a.id, allow)} onInspect={(request) => onInspect?.({ id: request.id, title: `Đề xuất · ${request.path}`, file: request.path, before: request.before, after: request.after })} />)}
          </div>
        )}
        <div className="compose">
          <div className="agent-composer">
            {(attachments.length > 0 || fileContext) && <div className="agent-attachments">
              {attachments.map((item, index) => <div className="agent-attachment" key={`${item.kind}-${index}`}><span className="mono" title={contextLabel(item)}>{contextLabel(item)}</span><button type="button" className="agent-icon-button" disabled={busy || checking} aria-label={`Gỡ ${contextLabel(item)}`} onClick={() => setAttachments((current) => current.filter((_, at) => at !== index))}><Icon name="close" size={11} /></button></div>)}
              {fileContext && <div className="agent-attachment">
                <span className="mono" title={fileReference(fileContext)}>{fileReference(fileContext)}</span>
                <button type="button" className="agent-icon-button" disabled={composerLocked} aria-label={vi.chat.removeFile} onClick={() => setFileContext(undefined)}><Icon name="close" size={11} /></button>
              </div>}
            </div>}
            <textarea ref={input} value={text} aria-label={vi.chat.message} placeholder={vi.chat.placeholder} rows={3} disabled={busy || modeLocked} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
            <div className="agent-composer-actions">
              <button type="button" className="agent-round" aria-label={vi.chat.attachFile} disabled={composerLocked || !activeFile || (!getEditorContext && fileReference(activeFile) === (fileContext && fileReference(fileContext)))}
                title={activeFile ? `${vi.chat.attachFile}: ${fileReference(activeFile)}` : vi.chat.noActiveFile} onClick={attachEditor}><Icon name="plus" size={17} /></button>
              {graphContext && <button type="button" className="agent-chip" disabled={composerLocked || attachments.some((item) => item.kind === graphContext.kind && contextLabel(item) === contextLabel(graphContext))} title={`Đính kèm ${contextLabel(graphContext)}`} aria-label="Đính kèm đồ thị" onClick={() => setAttachments((current) => [...current, { ...graphContext }])}><Icon name="graph" size={14} />Đồ thị</button>}
              {availableModels.length > 0 && configured ? <select className="agent-model-select" aria-label="Mô hình AI" value={`${cfg?.provider}\n${cfg?.model}`} disabled={busy || modeLocked} onChange={(event) => void changeModel(event.target.value)}>
                {!availableModels.some((model) => model.provider === cfg?.provider && model.id === cfg?.model) && <option value={`${cfg?.provider}\n${cfg?.model}`}>{cfg?.model === 'auto' ? 'Tự động' : cfg?.model}</option>}
                {availableModels.map((model) => <option key={`${model.provider}/${model.id}`} value={`${model.provider}\n${model.id}`}>{model.id === 'auto' ? 'Tự động' : model.label}</option>)}
              </select> : <span className="agent-model" title={configured ? `${connectionLabel(cfg)} · ${cfg?.model}` : undefined}>{configured ? cfg?.model === 'auto' ? 'Tự động' : cfg?.model : 'Chưa chọn model'}</span>}
              {busy
                ? <button type="button" className="agent-send" aria-label={vi.chat.stop} title={vi.chat.stop} onClick={stop}><span className="agent-stop-square" /></button>
                : <button type="button" className="agent-send" aria-label={vi.chat.send} title={vi.chat.send} disabled={(text.trim() !== '/login' && composerLocked) || !text.trim()} onClick={() => void submit()}><Icon name="send" size={15} /></button>}
            </div>
          </div>
          <div className="agent-composer-foot">
            <span className="mode" role="group" aria-label={vi.agent.modeTitle} title={mode ? modeHint : undefined}>
              <button type="button" disabled={modeLocked} aria-pressed={mode === 'ask'} onClick={() => void pickMode('ask')}>{vi.agent.ask}</button>
              <button type="button" disabled={modeLocked || busy} aria-pressed={mode === 'plan'} onClick={() => void pickMode('plan')}>Kế hoạch</button>
              <button type="button" disabled={modeLocked || busy || toolsUnavailable} aria-pressed={mode === 'edit'} onClick={() => void pickMode('edit')}>{vi.agent.edit}</button>
            </span>
            {configured && <span className="agent-connection-label" data-runtime={cfg?.runtime} title={connectionLabel(cfg)}><Icon name="plug" size={11} />{connectionLabel(cfg)}</span>}
            {usage && <span className="agent-usage" title="Token tích lũy của phiên; chi phí ước tính khi nhà cung cấp có bảng giá">{usage}</span>}
          </div>
          {mode && <p className="mode-description">{modeHint}</p>}
        </div>
      </div>
      {attachedFile?.kind === 'file' && attachedFile.dirty && <span className="sr-only">Ngữ cảnh gồm bản nháp chưa lưu.</span>}
      {connect && !hidden && <ConnectionDialog projectId={projectId} initialProvider={cfg?.runtime === 'antigravity-cli' || cfg?.provider === 'google' ? 'gemini' : cfg?.provider?.startsWith('openai') ? 'openai' : cfg?.provider === 'ollama-local' ? 'local' : cfg?.provider ? 'other' : undefined} initialMethod={cfg?.provider === 'google' ? 'api_key' : undefined} onClose={() => setConnect(false)} onConnected={() => {
        setConnect(false)
        void Promise.all([window.nexgraph.ai.getSettings(), window.nexgraph.auth.models()]).then(async ([settings, available]) => { if (!mounted.current) return; applySettings(settings); setModels(available); await work.restore() }).catch((e) => setError(errorMessage(e)))
      }} />}
      {consent && !hidden && (
        <ConsentDialog project={projectName} target={consent.target} model={consent.model}
          onCancel={() => setConsent(null)}
          onOk={() => void confirmConsent(consent)} />
      )}
    </aside>
  )
}
