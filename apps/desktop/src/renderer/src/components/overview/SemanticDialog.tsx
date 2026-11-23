import { useEffect, useState } from 'react'
import type { Job, ProjectAiSettings, SemanticEstimate, SemanticResult, SemanticTarget } from '@shared/graph-types'
import { waitJob } from '../../state/waitJob'
import { vi } from '../../strings'

const errMessage = (e: unknown): string => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e))
const num = (n: number) => n.toLocaleString('vi-VN')
const SHOWN_FILES = 50
const TITLE: Partial<Record<SemanticTarget, string>> = { labels: vi.semantic.labelsTitle, pr_triage: vi.semantic.triageTitle }
const CONSENT: Partial<Record<SemanticTarget, string>> = { labels: vi.semantic.consentLabels, pr_triage: vi.semantic.consentTriage }

interface Props {
  projectId: string
  /** Cố định target (nút "Đặt tên cụm bằng AI", "Xếp hạng bằng AI" ở tab PR); bỏ trống thì cho chọn docs/deep/images/dedup. */
  target?: SemanticTarget
  onClose: () => void
  onSettings?: (s: ProjectAiSettings) => void
}

/** Bật AI theo dự án (mặc định tắt), xem ước tính (tệp, khối, token) rồi mới chạy: đây là hộp thoại đồng ý của W9. */
export function SemanticDialog({ projectId, target: fixed, onClose, onSettings }: Props) {
  const [settings, setSettings] = useState<ProjectAiSettings | null>(null)
  const [transport, setTransport] = useState<'app' | 'direct'>('app')
  const [consent, setConsent] = useState(false)
  const [target, setTarget] = useState<SemanticTarget>(fixed ?? 'docs')
  const [estimate, setEstimate] = useState<SemanticEstimate | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [result, setResult] = useState<SemanticResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [noCache, setNoCache] = useState(false)

  const apply = (s: ProjectAiSettings) => { setSettings(s); onSettings?.(s) }
  useEffect(() => {
    window.nexgraph.semantic.getSettings(projectId).then(apply, (e) => setError(errMessage(e)))
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!settings?.enabled) return
    let live = true
    setEstimate(null)
    setError(null)
    window.nexgraph.semantic.estimate(projectId, target, noCache).then((e) => live && setEstimate(e), (e) => live && setError(errMessage(e)))
    return () => { live = false }
  }, [projectId, target, settings?.enabled, settings?.model, noCache])

  const act = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try { await fn() } catch (e) { setError(vi.semantic.failed(errMessage(e))) } finally { setBusy(false) }
  }
  const enable = () => act(async () => apply(await window.nexgraph.semantic.setSettings(projectId, { enabled: true, transport, model: null })))
  const agreeNewModel = () => act(async () => apply(await window.nexgraph.semantic.setSettings(projectId,
    { enabled: true, transport: settings?.transport ?? 'app', model: null })))
  const disable = () => act(async () => apply(await window.nexgraph.semantic.setSettings(projectId, { enabled: false, transport: null, model: null })))
  const run = () => act(async () => {
    setResult(null)
    const { jobId } = await window.nexgraph.semantic.start(projectId, target, undefined, noCache)
    try {
      const done = await waitJob(jobId, setJob, 500)
      setResult(done.result as unknown as SemanticResult)
    } finally {
      setJob(null)
    }
  })
  const cancel = () => { if (job) void window.nexgraph.semantic.cancel(job.job_id).catch(() => {}) }

  const local = target === 'dedup'
  const empty = estimate !== null && estimate.chunks === 0 && !local
  // Hiện và đối chiếu model sẽ dùng thật (main điền lúc ước tính), không phải model đã lưu lúc bật AI.
  const model = estimate?.model ?? null
  const changed = !local && estimate !== null && model !== null && settings?.model !== model
  return (
    <div className="modal-backdrop">
      <div role="dialog" aria-modal="true" aria-label={(fixed && TITLE[fixed]) || vi.semantic.title} className="modal">
        <h2>{(fixed && TITLE[fixed]) || vi.semantic.title}</h2>
        {settings && !fixed && (
          <fieldset>
            <legend>{vi.semantic.targetLabel}</legend>
            {(['docs', 'deep', 'images', 'dedup'] as const).map((t) => (
              <label key={t}><input type="radio" name="target" checked={target === t} disabled={busy} onChange={() => setTarget(t)} /> {vi.semantic.targets[t]}</label>
            ))}
          </fieldset>
        )}
        {/* `dedup` chạy trên máy, không gửi gì: không đòi bật AI, chọn model hay đồng ý. */}
        {settings && !settings.enabled && !local && (
          <>
            <p>{vi.semantic.enableIntro}</p>
            <label><input type="radio" name="transport" checked={transport === 'app'} onChange={() => setTransport('app')} /> {vi.semantic.transportApp}</label>
            <label><input type="radio" name="transport" checked={transport === 'direct'} onChange={() => setTransport('direct')} /> {vi.semantic.transportDirect}</label>
            <label><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> {(fixed && CONSENT[fixed]) || vi.semantic.consent}</label>
          </>
        )}
        {local && <p className="muted">{vi.semantic.sends[target]}</p>}
        {settings?.enabled && (
          <>
            {estimate && !local && (model ? <p className="muted">{vi.semantic.provider(model)}</p> : <p className="inline-message warning">{vi.semantic.noModel}</p>)}
            {changed && <p role="alert" className="inline-message warning">{vi.semantic.modelChanged(settings.model ?? '—', model)}
              {' '}<button type="button" disabled={busy} onClick={() => void agreeNewModel()}>{vi.semantic.agreeNewModel}</button></p>}
            {!local && <p className="muted">{vi.semantic.sends[target]}</p>}
            {!local && <label><input type="checkbox" checked={noCache} disabled={busy} onChange={(e) => setNoCache(e.target.checked)} /> {vi.semantic.noCache}</label>}
            {!estimate && !error && <p className="muted">{vi.semantic.estimating}</p>}
            {estimate && !local && (
              <div role="status">
                <p>{vi.semantic.estimate(estimate.files.length, estimate.chunks, estimate.cached_chunks)}</p>
                <p>{vi.semantic.tokens(num(estimate.input_tokens), num(estimate.output_tokens))}</p>
                {estimate.files.length > 0 && (
                  <details>
                    <summary>{vi.semantic.filesLabel}</summary>
                    <ul className="mono">{estimate.files.slice(0, SHOWN_FILES).map((f) => <li key={f}>{f}</li>)}</ul>
                    {estimate.files.length > SHOWN_FILES && <p className="muted">{vi.semantic.more(estimate.files.length - SHOWN_FILES)}</p>}
                  </details>
                )}
              </div>
            )}
            {empty && <p className="inline-message">{vi.semantic.noFiles}</p>}
          </>
        )}
        {job && <p role="status">{job.state === 'waiting_llm' ? vi.semantic.waiting : vi.semantic.running(job.files_done, job.files_total)}</p>}
        {result && (
          <div role="status" className="inline-message">
            {result.target === 'pr_triage' ? (result.triage?.length
              ? <ol>{result.triage.map((t) => <li key={t.number}>{vi.semantic.triageItem(t.number, t.priority, t.action)}</li>)}</ol>
              : <p>{vi.semantic.triageEmpty}</p>)
            : <p>{result.target === 'labels' ? vi.semantic.labelsDone(Object.keys(result.labels).length)
              : result.target === 'dedup' ? vi.semantic.merged(result.merged) : vi.semantic.done(result.nodes_added, result.edges_added)}</p>}
            {result.chunks.failed > 0 && <p>{vi.semantic.failedChunks(result.chunks.failed)}</p>}
            {(result.usage.input_tokens > 0 || result.usage.output_tokens > 0) &&
              <p className="muted">{vi.semantic.cost(num(result.usage.input_tokens), num(result.usage.output_tokens))}</p>}
          </div>
        )}
        {error && <p role="alert" className="inline-message error">{error}</p>}
        <footer>
          {settings?.enabled && !job && <button type="button" className="link" disabled={busy} onClick={() => void disable()}>{vi.semantic.disable}</button>}
          {job ? <button type="button" onClick={cancel}>{vi.semantic.cancel}</button>
            : <button type="button" onClick={onClose}>{vi.semantic.close}</button>}
          {settings && !settings.enabled && !local && <button type="button" className="primary" disabled={!consent || busy} onClick={() => void enable()}>{vi.semantic.enable}</button>}
          {settings && !settings.enabled && local && <button type="button" className="primary" disabled={busy} onClick={() => void run()}>{vi.semantic.runLocal}</button>}
          {/* `dedup` chạy trên máy kể cả khi AI đang bật: nhãn phải nói đúng là chạy cục bộ, không đòi đồng ý gửi đi. */}
          {settings?.enabled && !job && <button type="button" className="primary" disabled={busy || !estimate || empty || changed || (!local && !model)} onClick={() => void run()}>{local ? vi.semantic.runLocal : vi.semantic.run}</button>}
        </footer>
      </div>
    </div>
  )
}
