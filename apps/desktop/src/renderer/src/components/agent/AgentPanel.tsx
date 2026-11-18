import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { sameConsentTarget, type AiConsentTarget, type AgentMode, type ApprovalRequest } from '@shared/agent-types'
import type { AiSettings, Citation, GraphEdge, GraphNode } from '@shared/graph-types'
import { vi } from '../../strings'
import { Icon } from '../common/icons'
import { ApprovalCard } from './ApprovalCard'
import { CitationText } from '../chat/CitationText'
import { ConsentDialog } from '../chat/ConsentDialog'
import './agent-panel.css'

interface Props {
  id?: string
  projectId: string
  projectName?: string
  hidden?: boolean
  activeFile?: FileContext
  onClose?: () => void
  onConnectOpenCode?: () => void
  onOpenCode: (file: string, line: number, lineEnd?: number) => void
  onHighlight: (nodes: GraphNode[], edges: GraphEdge[], notice: string | null) => void
  onOpenSettings: () => void
}

type FileContext = { file: string; line: number; lineEnd?: number }
type Msg = { id: number; role: 'user'; content: string; context?: FileContext } | { id: number; role: 'assistant'; content: string; citations: Citation[]; tools: string[] }
type PendingConsent = { question: string; target: AiConsentTarget; model: string; context?: FileContext }

function fileReference(context: FileContext): string {
  const { file, line, lineEnd } = context
  if (lineEnd && lineEnd > line) return `${file}:${line}-${lineEnd}`
  return line > 1 ? `${file}:${line}` : file
}

function targetOf(settings: AiSettings): AiConsentTarget | null {
  return settings.provider && settings.baseUrl && settings.model ? { provider: settings.provider, baseUrl: settings.baseUrl } : null
}

function errorCode(e: unknown): string {
  return e && typeof e === 'object' && 'code' in e ? String(e.code) : ''
}

function errorMessage(e: unknown): string {
  return vi.chat.errors[errorCode(e)] || (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e))
}

function isFileApproval(value: unknown): value is ApprovalRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<ApprovalRequest>
  return (request.tool === 'edit' || request.tool === 'write')
    && typeof request.id === 'string' && request.id.trim() !== ''
    && typeof request.path === 'string' && request.path.trim() !== ''
    && typeof request.before === 'string' && typeof request.after === 'string'
}

export function AgentPanel(props: Props) {
  return <ProjectAgentPanel key={props.projectId} {...props} />
}

function ProjectAgentPanel({ id, projectId, projectName = projectId, hidden, activeFile, onClose, onConnectOpenCode, onOpenCode, onHighlight, onOpenSettings }: Props) {
  const [cfg, setCfg] = useState<AiSettings | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [fileContext, setFileContext] = useState<FileContext>()
  const [busy, setBusy] = useState(false)
  const [tool, setTool] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [consent, setConsent] = useState<PendingConsent | null>(null)
  const [checking, setChecking] = useState(false)
  const [openTools, setOpenTools] = useState<number | null>(null)
  const [draft, setDraft] = useState('') // chữ đang chảy về của lượt hiện tại
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([])
  const [mode, setMode] = useState<AgentMode | null>(null)
  const [changingMode, setChangingMode] = useState(true)
  const modeRef = useRef<AgentMode | null>(null)
  const modePending = useRef(true)
  const turn = useRef<{ id: number; q: string; context?: FileContext; tools: string[]; mode: AgentMode } | null>(null)
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

  useEffect(() => {
    if (hidden || !followMessages.current || !messages.current) return
    messages.current.scrollTop = messages.current.scrollHeight
  }, [hidden, msgs, draft, busy])

  const applySettings = (settings: AiSettings) => {
    const target = targetOf(settings)
    if (scope.current && !sameConsentTarget(scope.current, target)) {
      setMsgs([])
      setApprovals([])
      setOpenTools(null)
      failedTurns.current.clear()
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
        if (t?.mode !== 'edit' || modeRef.current !== 'edit' || modePending.current || !isFileApproval(request)) return
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

  const isCurrent = (id: number) => mounted.current && visible.current && operation.current === id
  const begin = () => {
    if (!visible.current || operation.current !== null || turn.current || modePending.current || !modeRef.current) return null
    const id = ++operationSeq.current
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
    if (m === modeRef.current || modePending.current || operation.current !== null || consent || !visible.current) return
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
      if (m === 'ask') setApprovals([])
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

  const run = async (question: string, target: AiConsentTarget, context?: FileContext) => {
    const mode = modeRef.current
    if (!mode) return
    const id = ++turnSeq.current
    turn.current = { id, q: question, context, tools: [], mode }
    followMessages.current = true
    setMsgs((cur) => [...cur, { id, role: 'user', content: question, context }])
    setText('')
    setFileContext(undefined)
    setError(null)
    setBusy(true)
    setTool(null)
    setDraft('')
    try {
      const prompt = context ? `${question}\n\n${vi.chat.filePrompt(fileReference(context))}` : question
      await window.nexgraph.agent.prompt(projectId, prompt, target)
    } catch (e) {
      if (!mounted.current || turn.current?.id !== id) return
      if (errorCode(e) === 'ai_provider_changed') {
        setMsgs((cur) => cur.filter((m) => m.id !== id))
        setText(question)
        setFileContext(context)
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
      onOpenSettings()
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
      else setConsent({ question: q, target, model: settings.model, context: fileContext })
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
      if (isCurrent(id)) void run(pending.question, pending.target, pending.context)
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
    void window.nexgraph.agent.approve(projectId, id, allow).catch((e) => {
      if (mounted.current) setError(errorMessage(e))
    })
  }
  const modeLocked = changingMode || checking || !!consent
  const composerLocked = !configured || !mode || busy || modeLocked

  return (
    <aside id={id} className="chat agent-panel" aria-label={vi.chat.title} hidden={hidden}>
      <header>
        <h2><Icon name="spark" size={17} />{vi.chat.title}</h2>
        <div className="agent-actions">
          {onConnectOpenCode && <button type="button" className="agent-connect" onClick={onConnectOpenCode} title={vi.chat.connectOpenCode} aria-label={vi.chat.connectOpenCode}><Icon name="plug" size={14} />OpenCode</button>}
          <button type="button" className="agent-icon-button" onClick={onOpenSettings} title={vi.chat.settings} aria-label={vi.chat.settings}><Icon name="sliders" size={16} /></button>
          {onClose && <button type="button" className="agent-icon-button" onClick={onClose} aria-label={vi.chat.close} title={vi.chat.close}><Icon name="close" size={16} /></button>}
        </div>
      </header>
      <div className="agent-toolbar">
        <span className="agent-model" title={configured ? `${cfg?.provider} · ${cfg?.model}` : undefined}>Pi{configured && ` · ${cfg?.model}`}</span>
        <span className="mode" role="group" aria-label={vi.agent.modeTitle}>
          <button type="button" disabled={modeLocked} aria-pressed={mode === 'ask'} onClick={() => void pickMode('ask')}>{vi.agent.ask}</button>
          <button type="button" disabled={modeLocked || busy} aria-pressed={mode === 'edit'} onClick={() => void pickMode('edit')}>{vi.agent.edit}</button>
        </span>
      </div>
      {mode && <p className="mode-description muted small">{mode === 'edit' ? vi.agent.editHint : vi.agent.askHint}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <div className="msgs" ref={messages} onScroll={(event) => {
        const el = event.currentTarget
        followMessages.current = el.scrollHeight - el.clientHeight - el.scrollTop < 36
      }}>
        {cfg && msgs.length === 0 && !busy && (
          <div className="agent-welcome">
            <span className="agent-welcome-icon"><Icon name="spark" size={22} /></span>
            <h3>{configured ? vi.chat.startTitle : vi.chat.setupTitle}</h3>
            {configured ? (
              <div className="agent-starters">
                {vi.chat.starters.map((suggestion) => <button key={suggestion} type="button" disabled={modeLocked} onClick={() => {
                  setText(suggestion)
                  input.current?.focus()
                }}>{suggestion}<Icon name="chevron" size={14} /></button>)}
              </div>
            ) : (
              <>
                <p className="muted">{vi.chat.setupDescription}</p>
                <button type="button" className="primary" onClick={onOpenSettings}>{vi.chat.openSettings}</button>
              </>
            )}
          </div>
        )}
        {msgs.map((m) => m.role === 'user' ? (
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
            </div>
            {openTools === m.id && (
              <ul className="tool-list mono">
                {m.tools.map((t, k) => <li key={`${m.id}-${k}`}>{t}</li>)}
              </ul>
            )}
          </div>
        ))}
        {busy && draft && <div className="ai">{draft}</div>}
        {busy && <div className="ai muted" role="status">{tool ? vi.chat.usingTool(tool) : vi.chat.thinking}</div>}
      </div>
      {approvals.length > 0 && (
        <div className="approvals">
          {approvals.map((a) => <ApprovalCard key={a.id} request={a} disabled={changingMode} onDecide={(allow) => decide(a.id, allow)} />)}
        </div>
      )}
      <div className="compose">
        <div className="agent-compose-input">
          {fileContext && <div className="agent-attachment">
            <span className="mono" title={fileReference(fileContext)}>{fileReference(fileContext)}</span>
            <button type="button" className="agent-icon-button" disabled={composerLocked} aria-label={vi.chat.removeFile} onClick={() => setFileContext(undefined)}><Icon name="close" size={14} /></button>
          </div>}
          <textarea ref={input} value={text} aria-label={vi.chat.message} placeholder={vi.chat.placeholder} rows={3} disabled={composerLocked} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
        </div>
        <div className="row">
          <button type="button" className="agent-attach" disabled={composerLocked || !activeFile || fileReference(activeFile) === (fileContext && fileReference(fileContext))}
            title={activeFile ? fileReference(activeFile) : vi.chat.noActiveFile} onClick={() => { setFileContext(activeFile); input.current?.focus() }}>
            <span aria-hidden="true">+</span>{vi.chat.attachFile}
          </button>
          {busy
            ? <button type="button" onClick={() => void window.nexgraph.agent.abort(projectId)}>{vi.chat.stop}</button>
            : <button type="button" className="primary" disabled={composerLocked || !text.trim()} onClick={() => void submit()}>{vi.chat.send}</button>}
        </div>
      </div>
      {consent && !hidden && (
        <ConsentDialog project={projectName} target={consent.target} model={consent.model}
          onCancel={() => setConsent(null)}
          onOk={() => void confirmConsent(consent)} />
      )}
    </aside>
  )
}
