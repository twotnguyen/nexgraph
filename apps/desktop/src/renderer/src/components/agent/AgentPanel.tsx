import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { AgentEvent, AgentMode, ApprovalRequest } from '@shared/agent-types'
import type { AiSettings, Citation, GraphEdge, GraphNode } from '@shared/graph-types'
import { vi } from '../../strings'
import { ApprovalCard } from './ApprovalCard'
import { CitationText } from '../chat/CitationText'
import { ConsentDialog } from '../chat/ConsentDialog'

interface Props {
  projectId: string
  hidden?: boolean
  onOpenCode: (file: string, line: number, lineEnd?: number) => void
  onHighlight: (nodes: GraphNode[], edges: GraphEdge[], notice: string | null) => void
  onOpenSettings: () => void
}

type Msg = { id: number; role: 'user'; content: string } | { id: number; role: 'assistant'; content: string; citations: Citation[]; tools: string[] }

export function AgentPanel({ projectId, hidden, onOpenCode, onHighlight, onOpenSettings }: Props) {
  const [cfg, setCfg] = useState<AiSettings | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [tool, setTool] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [consent, setConsent] = useState<string | null>(null) // câu hỏi đang chờ đồng ý
  const [openTools, setOpenTools] = useState<number | null>(null)
  const [draft, setDraft] = useState('') // chữ đang chảy về của lượt hiện tại
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([])
  const [mode, setMode] = useState<AgentMode>('ask')
  const turn = useRef<{ id: number; q: string; tools: string[] } | null>(null) // lượt đang chạy; kết thúc bằng sự kiện done/error
  const turnSeq = useRef(0)
  const failedTurns = useRef(new Set<number>())
  const editWarned = useRef(false) // lần đầu sang Sửa phải cảnh báo sandbox
  const mounted = useRef(true)

  const end = () => {
    turn.current = null
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
    setError(message)
    end()
  }

  useEffect(() => {
    let alive = true
    mounted.current = true
    window.nexgraph.ai.getSettings().then((s) => alive && setCfg(s)).catch(() => {})
    window.nexgraph.agent.getMode(projectId).then((m) => {
      if (!alive) return
      if (m === 'edit') editWarned.current = true // phiên đã ở Sửa từ trước thì không hỏi lại
      setMode(m)
    }).catch(() => {})
    const off = window.nexgraph.agent.onEvent((pid, e) => {
      const t = turn.current
      if (!mounted.current || pid !== projectId) return
      if (e.type === 'approval') {
        setApprovals((cur) => (cur.some((a) => a.id === e.request.id) ? cur : [...cur, e.request]))
        return
      }
      if (e.type === 'approval_closed') {
        setApprovals((cur) => cur.filter((a) => a.id !== e.id)) // id lạ không có gì để gỡ
        return
      }
      if (!t) return
      if (e.type === 'write_conflict') {
        setError(e.message)
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
      if (turn.current) void window.nexgraph.agent.abort(projectId)
      turn.current = null
      off()
    }
  }, [projectId])

  const configured = !!cfg && cfg.baseUrl !== '' && cfg.model !== ''

  const pickMode = (m: AgentMode) => {
    if (m === mode) return
    if (m === 'edit' && !editWarned.current) {
      if (!window.confirm(vi.agent.editWarn)) return
      editWarned.current = true
    }
    setMode(m)
    void window.nexgraph.agent.setMode(projectId, m).catch(() => {})
  }

  const run = async (question: string) => {
    const id = ++turnSeq.current
    turn.current = { id, q: question, tools: [] }
    setMsgs((cur) => [...cur, { id, role: 'user', content: question }])
    setText('')
    setError(null)
    setBusy(true)
    setTool(null)
    setDraft('')
    try {
      await window.nexgraph.agent.prompt(projectId, question)
    } catch (e) {
      if (!mounted.current || turn.current?.q !== question) return
      const code = e && typeof e === 'object' && 'code' in e ? String(e.code) : undefined
      fail(question, (code && vi.chat.errors[code]) || (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e)))
    }
  }

  const submit = async () => {
    const q = text.trim()
    if (!q || busy) return
    if (q === '/login') {
      setText('')
      onOpenSettings()
      return
    }
    if (!(await window.nexgraph.ai.hasConsent(projectId))) return setConsent(q)
    void run(q)
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
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

  const decide = (id: string, allow: boolean) => void window.nexgraph.agent.approve(projectId, id, allow).catch(() => {})

  return (
    <aside className="chat" aria-label={vi.chat.title} hidden={hidden}>
      <header>
        <b>{vi.chat.title}</b>
        <span className="mode" role="group" aria-label={vi.agent.modeTitle}>
          <button type="button" aria-pressed={mode === 'ask'} onClick={() => pickMode('ask')}>{vi.agent.ask}</button>
          <button type="button" aria-pressed={mode === 'edit'} onClick={() => pickMode('edit')}>{vi.agent.edit}</button>
        </span>
      </header>
      {cfg && !configured ? (
        <div className="chat-empty">
          <p className="muted">{vi.chat.notConfigured}</p>
          <button type="button" className="primary" onClick={onOpenSettings}>{vi.chat.openSettings}</button>
        </div>
      ) : (
        <>
          <div className="msgs">
            {msgs.map((m) => m.role === 'user' ? (
              <div key={m.id} className="me">{m.content}</div>
            ) : (
              <div key={m.id} className="ai">
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
              {approvals.map((a) => <ApprovalCard key={a.id} request={a} onDecide={(allow) => decide(a.id, allow)} />)}
            </div>
          )}
          {error && <p role="alert" className="error">{error}</p>}
          <div className="compose">
            <textarea value={text} placeholder={vi.chat.placeholder} rows={2} disabled={!cfg || busy} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
            <div className="row">
              <small className="muted">{vi.chat.hint}</small>
              {busy
                ? <button type="button" onClick={() => void window.nexgraph.agent.abort(projectId)}>{vi.chat.stop}</button>
                : <button type="button" className="primary" onClick={() => void submit()}>{vi.chat.send}</button>}
            </div>
          </div>
        </>
      )}
      {consent && cfg && (
        <ConsentDialog host={safeHost(cfg.baseUrl)} model={cfg.model}
          onCancel={() => setConsent(null)}
          onOk={() => { const q = consent; setConsent(null); void window.nexgraph.ai.grantConsent(projectId).then(() => run(q)) }} />
      )}
    </aside>
  )
}

function safeHost(baseUrl: string): string {
  try { return new URL(baseUrl).host } catch { return baseUrl }
}
