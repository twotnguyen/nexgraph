import { useEffect, useState } from 'react'
import type { SourceItem } from '@nexgraph/contracts/graph-types'
import { waitJob } from '../../shared/lib/waitJob'
import { vi } from '../../i18n/strings'
import { msg, msgText, type Message } from '../../shared/lib/messages'
import { errorMsg } from '../../shared/lib/errorText'

/** Danh sách nguồn tải từ URL của dự án (W6): thêm (job `ingest`, engine tự cập nhật đồ thị), xem, xoá. */
export function SourcesPanel({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<SourceItem[] | null>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Message | null>(null)

  const load = () => window.nexgraph.sources.list(projectId).then(setItems, (e) => setError(errorMsg(e)))
  useEffect(() => { void load() }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (action: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await action()
      await load()
    } catch (e) {
      setError(msg('Không tải được: {error}', { error: errorMsg(e) }))
    } finally {
      setBusy(false)
    }
  }
  const add = () => run(async () => {
    const { jobId } = await window.nexgraph.sources.add(projectId, url.trim())
    await waitJob(jobId)
    setUrl('')
  })

  return (
    <section className="workbench-panel" aria-labelledby="sources-heading" aria-busy={busy || items === null}>
      <header className="panel-title"><h2 id="sources-heading">{vi.sources.title}</h2></header>
      <p className="muted">{vi.sources.hint}</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void add() }}>
        <input aria-label={vi.sources.urlLabel} type="url" value={url} placeholder="https://" disabled={busy} onChange={(e) => setUrl(e.target.value)} />
        <button type="submit" className="primary" disabled={busy || !url.trim()}>{busy ? vi.sources.adding : vi.sources.add}</button>
      </form>
      {error && <p role="alert" className="inline-message error">{msgText(error)}</p>}
      {items?.length === 0 && <p className="muted">{vi.sources.empty}</p>}
      {items && items.length > 0 && (
        <ul className="recent">
          {items.map((s) => (
            <li key={s.name} className="row">
              <span className="recent-identity"><b className="mono">{s.name}</b>{s.url && <span className="muted mono" title={s.url}>{s.url}</span>}</span>
              <button type="button" className="icon-button" aria-label={vi.sources.remove(s.name)} title={vi.sources.remove(s.name)} disabled={busy}
                onClick={() => void run(() => window.nexgraph.sources.remove(projectId, s.name))}>×</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
