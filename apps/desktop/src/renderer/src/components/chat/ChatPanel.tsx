import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { AiSettings, ChatAnswer, GraphEdge, GraphNode } from '@shared/graph-types'
import { vi } from '../../strings'
import { CitationText } from './CitationText'
import { ConsentDialog } from './ConsentDialog'

interface Props {
  projectId: string
  onOpenCode: (file: string, line: number, lineEnd?: number) => void
  onHighlight: (nodes: GraphNode[], edges: GraphEdge[], notice: string | null) => void
  onOpenSettings: () => void
}

type Msg = { role: 'user'; content: string } | { role: 'assistant'; content: string; answer: ChatAnswer }

const errCode = (e: unknown): string | undefined => (e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : undefined)
const errMessage = (e: unknown): string => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e))

export function ChatPanel({ projectId, onOpenCode, onHighlight, onOpenSettings }: Props) {
  const [cfg, setCfg] = useState<AiSettings | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [tool, setTool] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [consent, setConsent] = useState<string | null>(null) // câu hỏi đang chờ đồng ý
  const [openTools, setOpenTools] = useState<number | null>(null)
  const chatId = useRef<string | null>(null)

  useEffect(() => {
    let alive = true
    window.nexgraph.ai.getSettings().then((s) => alive && setCfg(s)).catch(() => {})
    const off = window.nexgraph.ai.onEvent((e) => {
      if (e.chatId === chatId.current) setTool(e.name)
    })
    return () => { alive = false; off() }
  }, [])

  const configured = !!cfg && cfg.baseUrl !== '' && cfg.model !== ''

  const run = async (question: string) => {
    const id = crypto.randomUUID()
    chatId.current = id
    const history = msgs.map((m) => ({ role: m.role, content: m.content }))
    setMsgs((cur) => [...cur, { role: 'user', content: question }])
    setText('')
    setError(null)
    setBusy(true)
    setTool(null)
    try {
      const answer = await window.nexgraph.ai.send(projectId, id, [...history, { role: 'user', content: question }])
      setMsgs((cur) => [...cur, { role: 'assistant', content: answer.text, answer }])
    } catch (e) {
      setMsgs((cur) => cur.slice(0, -1))
      setText(question)
      const code = errCode(e)
      setError((code && vi.chat.errors[code]) || errMessage(e))
    } finally {
      setBusy(false)
      setTool(null)
      chatId.current = null
    }
  }

  const submit = async () => {
    const q = text.trim()
    if (!q || busy) return
    if (!(await window.nexgraph.ai.hasConsent(projectId))) return setConsent(q)
    void run(q)
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  const highlight = async (answer: ChatAnswer) => {
    const seen = new Set<string>()
    const ids: string[] = []
    for (const c of answer.citations.filter((x) => x.valid)) {
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
      onHighlight([], [], errMessage(e))
    }
  }

  return (
    <aside className="chat" aria-label={vi.chat.title}>
      <header>
        <b>{vi.chat.title}</b>
        <span className="muted mono"> {cfg?.model ? `${cfg.model} · ` : ''}{vi.chat.readOnly}</span>
      </header>
      {cfg && !configured ? (
        <div className="chat-empty">
          <p className="muted">{vi.chat.notConfigured}</p>
          <button type="button" className="primary" onClick={onOpenSettings}>{vi.chat.openSettings}</button>
        </div>
      ) : (
        <>
          <div className="msgs">
            {msgs.map((m, i) => m.role === 'user' ? (
              <div key={i} className="me">{m.content}</div>
            ) : (
              <div key={i} className="ai">
                <CitationText text={m.content} citations={m.answer.citations} onOpen={onOpenCode} />
                <div className="foot muted">
                  {m.answer.citations.length === 0 ? <span>{vi.chat.noCitations}</span>
                    : <span>{vi.chat.verified(m.answer.citations.filter((c) => c.valid).length, m.answer.citations.length)}</span>}
                  {m.answer.citations.some((c) => c.valid) && (
                    <button type="button" className="link" onClick={() => void highlight(m.answer)}>{vi.chat.highlight}</button>
                  )}
                  {m.answer.toolCalls.length > 0 && (
                    <button type="button" className="link" onClick={() => setOpenTools(openTools === i ? null : i)}>{vi.chat.tools(m.answer.toolCalls.length)}</button>
                  )}
                </div>
                {openTools === i && (
                  <ul className="tool-list mono">
                    {m.answer.toolCalls.map((t, k) => <li key={k}>{t.name} {t.args}</li>)}
                  </ul>
                )}
              </div>
            ))}
            {busy && <div className="ai muted" role="status">{tool ? vi.chat.usingTool(tool) : vi.chat.thinking}</div>}
          </div>
          {error && <p role="alert" className="error">{error}</p>}
          <div className="compose">
            <textarea value={text} placeholder={vi.chat.placeholder} rows={2} disabled={!cfg} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
            <div className="row">
              <small className="muted">{vi.chat.hint}</small>
              {busy
                ? <button type="button" onClick={() => chatId.current && void window.nexgraph.ai.cancel(chatId.current)}>{vi.chat.stop}</button>
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
