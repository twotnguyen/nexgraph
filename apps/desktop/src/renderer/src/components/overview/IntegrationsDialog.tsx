import { useEffect, useState } from 'react'
import type { AgentId, IntegrationPlan } from '@shared/integration-types'
import type { ProjectSummary } from '@shared/graph-types'
import { vi } from '../../strings'

// Bốn agent JSON dùng nhãn có sẵn; Codex và hai mục skill dùng nhãn mới (strings.ts: vi.integration).
const AGENTS: { id: AgentId; label: string }[] = [
  { id: 'claude', label: vi.integrate.agents.claude },
  { id: 'cursor', label: vi.integrate.agents.cursor },
  { id: 'vscode', label: vi.integrate.agents.vscode },
  { id: 'opencode', label: vi.integrate.agents.opencode },
  { id: 'codex', label: vi.integration.codex },
  { id: 'skill-claude', label: vi.integration.skillClaude },
  { id: 'agents-md', label: vi.integration.skillAgentsMd }
]
const errMessage = (e: unknown): string => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e))

export function IntegrationsDialog({ project, onClose, initialAgent = 'claude' }: {
  project: ProjectSummary
  onClose: () => void
  initialAgent?: AgentId
}) {
  const [agent, setAgent] = useState<AgentId>(initialAgent)
  const [plan, setPlan] = useState<IntegrationPlan | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setPlan(null)
    setDone(null)
    setCopied(false)
    setError(null)
    window.nexgraph.mcp.plan(agent, project.project_id).then((p) => alive && setPlan(p)).catch((e) => alive && setError(errMessage(e)))
    return () => { alive = false }
  }, [agent, project.project_id])

  const write = async () => {
    setError(null)
    try {
      const p = await window.nexgraph.mcp.apply(agent, project.project_id)
      setDone(vi.integrate.written(p.path))
      setPlan(p.status === 'up_to_date' || p.status === 'invalid' ? p : { ...p, status: 'up_to_date' })
    } catch (e) {
      setError(errMessage(e))
    }
  }
  const copy = async () => {
    if (!plan) return
    await navigator.clipboard.writeText(plan.snippet)
    setCopied(true)
  }

  const invalidMessage = agent === 'codex' ? vi.integration.codexExisting : agent === 'skill-claude' ? vi.integration.skillExisting : vi.integrate.invalid
  return (
    <div className="modal-backdrop">
      <div role="dialog" aria-label={vi.integrate.title} className="modal">
        <header><h2>{vi.integrate.title}</h2><button type="button" aria-label={vi.integrate.close} onClick={onClose}>×</button></header>
        <div role="radiogroup" aria-label={vi.integrate.agentLabel} className="segmented">
          {AGENTS.map((a) => (
            <label key={a.id}>
              <input type="radio" name="agent" checked={agent === a.id} onChange={() => setAgent(a.id)} />
              <span>{a.label}</span>
            </label>
          ))}
        </div>
        {plan && (
          <>
            <p><b>{vi.integrate.willWrite}</b> <span className="mono">{plan.path}</span></p>
            <p className="muted">{plan.status === 'new' ? vi.integrate.fresh : vi.integrate.existing}</p>
            {plan.status === 'invalid' ? <p role="alert" className="error">{invalidMessage}</p> : <pre className="mono">{plan.after}</pre>}
            {plan.status === 'up_to_date' && <p className="muted">{vi.integrate.upToDate}</p>}
          </>
        )}
        {agent === 'codex' && <p className="muted small">{vi.integration.codexTrusted}</p>}
        {agent === 'opencode' && <p className="muted small">{vi.chat.openCodeHint}</p>}
        {done && <p role="status">{done}</p>}
        {error && <p role="alert" className="error">{error}</p>}
        <p className="muted small">{vi.integrate.note}</p>
        <div className="row">
          {plan && plan.status !== 'invalid' && (
            <button type="button" className="primary" disabled={plan.status === 'up_to_date'} onClick={() => void write()}>
              {plan.status === 'update' ? vi.integrate.update : vi.integrate.write}
            </button>
          )}
          <button type="button" disabled={!plan} onClick={() => void copy()}>{copied ? vi.integrate.copied : vi.integrate.copy}</button>
        </div>
      </div>
    </div>
  )
}
