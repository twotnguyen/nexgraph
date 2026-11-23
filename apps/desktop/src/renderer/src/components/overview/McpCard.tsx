import { useEffect, useState } from 'react'
import type { ProjectSummary } from '@shared/graph-types'
import { vi } from '../../strings'
import { errorMsg } from '../../state/errorText'
import { msgText, type Message } from '../../state/messages'

export function McpCard({ project }: { project: ProjectSummary }) {
  const [copied, setCopied] = useState(false)
  const [http, setHttp] = useState<{ url: string; key: string } | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Message | null>(null)

  useEffect(() => {
    let alive = true
    // Đang chạy từ trước: start trả lại đúng phiên cũ (cùng URL, cùng key).
    window.nexgraph.mcp.httpStatus(project.project_id)
      .then((s) => (s ? window.nexgraph.mcp.startHttp(project.project_id) : null))
      .then((r) => alive && setHttp(r))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [project.project_id])

  const copyConfig = async () => {
    setError(null)
    try {
      const { stdio } = await window.nexgraph.mcp.config(project.project_id)
      await navigator.clipboard.writeText(stdio)
      setCopied(true)
    } catch (e) {
      setError(errorMsg(e))
    }
  }
  const toggleHttp = async () => {
    setBusy(true)
    setError(null)
    try {
      if (http) {
        await window.nexgraph.mcp.stopHttp(project.project_id)
        setHttp(null)
        setShowKey(false)
      } else {
        setHttp(await window.nexgraph.mcp.startHttp(project.project_id))
      }
    } catch (e) {
      setError(errorMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card mcp-card">
      <b>{vi.overview.mcpTitle}</b>
      <span className="muted">{vi.overview.mcpDesc}</span>
      <div className="row">
        <button type="button" onClick={() => void copyConfig()}>{vi.overview.mcpCopy}</button>
        {copied && <small className="ok">{vi.overview.copied}</small>}
      </div>
      <label className="row switch-row">
        <button type="button" role="switch" aria-checked={http !== null} aria-label={vi.overview.mcpHttp} disabled={busy}
          className={`switch${http ? ' on' : ''}`} onClick={() => void toggleHttp()}><span /></button>
        <span>{vi.overview.mcpHttp}</span>
      </label>
      {http && (
        <dl className="mcp-http">
          <dt>URL</dt>
          <dd className="mono">{http.url}</dd>
          <dt>X-API-Key</dt>
          <dd className="mono">
            {showKey ? http.key : '••••••••••••'}
            <button type="button" className="link" onClick={() => setShowKey((v) => !v)}>{showKey ? vi.overview.hideKey : vi.overview.showKey}</button>
            <button type="button" className="link" onClick={() => void navigator.clipboard.writeText(http.key)}>{vi.overview.copyKey}</button>
          </dd>
        </dl>
      )}
      {error && <p role="alert" className="error">{msgText(error)}</p>}
    </div>
  )
}
