import { useEffect, useState } from 'react'
import { AGENT_IDS, type AgentId, type IntegrationPlan } from '@nexgraph/contracts/integration-types'
import type { ProjectSummary } from '@nexgraph/contracts/graph-types'
import { vi } from '../../i18n/strings'
import { errorMsg } from '../../shared/lib/errorText'
import { msg, msgText, type Message } from '../../shared/lib/messages'
import { Icon } from '../../shared/ui/icons'

const STRICT_AGENTS: AgentId[] = ['claude', 'codebuddy'] // nền tảng có hook PreToolUse
const errMsg = (e: unknown): Message => errorMsg(e)
const WRITES = new Set<IntegrationPlan['status']>(['new', 'add', 'update', 'remove', 'delete'])

function invalidMessage(p: IntegrationPlan, removing: boolean): string {
  if (removing) return vi.integration.removeInvalid
  if (p.part === 'skill') return vi.integration.skillExisting
  return p.path.endsWith('.toml') ? vi.integration.codexExisting : vi.integrate.invalid
}

function statusLabel(p: IntegrationPlan, removing: boolean): string {
  if (removing) return vi.integration.removeStatus[p.status] ?? ''
  if (p.status === 'up_to_date') return vi.integrate.upToDate
  return p.status === 'new' ? vi.integrate.fresh : p.status === 'invalid' ? '' : vi.integrate.existing
}

export function IntegrationsDialog({ project, onClose, initialAgent = 'claude' }: {
  project: ProjectSummary
  onClose: () => void
  initialAgent?: AgentId
}) {
  const [agent, setAgent] = useState<AgentId>(initialAgent)
  const [strict, setStrict] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [plans, setPlans] = useState<IntegrationPlan[] | null>(null)
  const [done, setDone] = useState<Message[] | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [error, setError] = useState<Message | null>(null)
  const hasStrict = STRICT_AGENTS.includes(agent)
  const opts = hasStrict ? { strict } : undefined

  useEffect(() => {
    let alive = true
    setPlans(null)
    setCopied(null)
    setError(null)
    const pending = removing ? window.nexgraph.mcp.planRemove(agent, project.project_id)
      : window.nexgraph.mcp.plan(agent, project.project_id, hasStrict ? { strict } : undefined)
    pending.then((p) => alive && setPlans(p)).catch((e) => alive && setError(errMsg(e)))
    return () => { alive = false }
  }, [agent, project.project_id, removing, strict, hasStrict])

  const pick = (next: AgentId) => { setAgent(next); setRemoving(false); setDone(null) }
  const run = async () => {
    setError(null)
    try {
      const p = removing ? await window.nexgraph.mcp.remove(agent, project.project_id) : await window.nexgraph.mcp.apply(agent, project.project_id, opts)
      const written = p.filter((x) => WRITES.has(x.status))
      setDone(removing ? [msg('Đã gỡ NexGraph khỏi các tệp trên')] : written.map((x) => msg('Đã ghi {path}', { path: x.path })))
      // Sau khi ghi/gỡ, mọi phần không invalid đều đã khớp đĩa.
      setPlans(p.map((x) => (WRITES.has(x.status) ? { ...x, status: 'up_to_date' } : x)))
    } catch (e) {
      setError(errMsg(e))
    }
  }
  const copy = async (p: IntegrationPlan) => {
    await navigator.clipboard.writeText(p.snippet)
    setCopied(p.path + p.part)
  }

  const pendingWrites = plans?.filter((p) => WRITES.has(p.status)) ?? []
  const updating = !removing && pendingWrites.length > 0 && pendingWrites.every((p) => p.status === 'update')
  return (
    <div className="modal-backdrop">
      <div role="dialog" aria-label={vi.integrate.title} className="modal">
        <header><h2>{vi.integrate.title}</h2><button type="button" aria-label={vi.integrate.close} onClick={onClose}><Icon name="close" size={14} /></button></header>
        <label className="row">
          <span>{vi.integrate.agentLabel}</span>
          <select aria-label={vi.integrate.agentLabel} value={agent} onChange={(e) => pick(e.target.value as AgentId)}>
            {AGENT_IDS.map((id) => <option key={id} value={id}>{vi.integrate.agents[id]}</option>)}
          </select>
        </label>
        {hasStrict && !removing && (
          <label className="row small">
            <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
            <span>{vi.integration.strict}</span>
          </label>
        )}
        {removing && <p><b>{vi.integration.willRemove}</b></p>}
        {plans?.map((p) => (
          <section key={p.part + p.path} aria-label={vi.integration.parts[p.part]}>
            <h3>{vi.integration.parts[p.part]}</h3>
            <p>{!removing && <b>{vi.integrate.willWrite} </b>}<span className="mono">{p.path}</span></p>
            {statusLabel(p, removing) && <p className="muted">{statusLabel(p, removing)}</p>}
            {p.status === 'invalid' ? (
              <>
                <p role="alert" className="error">{invalidMessage(p, removing)}</p>
                <button type="button" onClick={() => void copy(p)}>{copied === p.path + p.part ? vi.integrate.copied : vi.integration.copyPart}</button>
              </>
            ) : (p.status === 'remove' || (!removing && p.status !== 'up_to_date')) && <pre className="mono">{p.after}</pre>}
          </section>
        ))}
        {agent === 'codex' && <p className="muted small">{vi.integration.codexTrusted}</p>}
        {agent === 'opencode' && <p className="muted small">{vi.chat.openCodeHint}</p>}
        {done && <p role="status">{done.map(msgText).join(' · ')}</p>}
        {error && <p role="alert" className="error">{msgText(error)}</p>}
        <p className="muted small">{removing ? vi.integration.sharedNote : vi.integrate.note}</p>
        <div className="row">
          <button type="button" className="primary" disabled={!plans || pendingWrites.length === 0} onClick={() => void run()}>
            {removing ? vi.integration.confirmRemove : updating ? vi.integrate.update : vi.integrate.writeAll}
          </button>
          <button type="button" onClick={() => { setRemoving(!removing); setDone(null) }}>{removing ? vi.integration.back : vi.integration.remove}</button>
        </div>
      </div>
    </div>
  )
}
