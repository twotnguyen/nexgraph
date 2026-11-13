import { useEffect, useState } from 'react'
import type { ExportFormat, ExportScope } from '@shared/graph-types'
import { vi } from '../../strings'

type Choice = ExportFormat | 'png' | 'neo4j' | 'falkordb'

const FILE_FORMATS: ExportFormat[] = ['html', 'callflow_html', 'obsidian', 'wiki', 'svg', 'graphml', 'cypher', 'json', 'markdown']
const CHOICES: Choice[] = [...FILE_FORMATS, 'png', 'neo4j', 'falkordb']
const DEFAULT_URI = { neo4j: 'bolt://localhost:7687', falkordb: 'redis://localhost:6379' }

type Done = { kind: 'files'; files: string[]; truncated: boolean } | { kind: 'push'; nodes: number; edges: number; truncated: boolean }

interface Props {
  projectId: string
  projectName: string
  scope: ExportScope
  /** Định dạng chọn sẵn khi mở (mặc định HTML). */
  initialFormat?: ExportFormat
  onClose: () => void
}

// Hai khung hình: React bỏ hộp thoại khỏi DOM rồi trình duyệt vẽ lại, sau đó mới chụp.
const nextFrame = () => new Promise<void>((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 16)))

const errMessage = (e: unknown): string => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e))

export function ExportDialog({ projectId, projectName, scope: initialScope, initialFormat = 'html', onClose }: Props) {
  const [choice, setChoice] = useState<Choice>(initialFormat)
  const [scope, setScope] = useState<ExportScope>(initialScope)
  const [busy, setBusy] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const [uri, setUri] = useState(DEFAULT_URI.neo4j)
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const pick = (c: Choice) => {
    setChoice(c)
    setDone(null)
    setError(null)
    if (c === 'neo4j' || c === 'falkordb') setUri(DEFAULT_URI[c])
  }

  const run = async (work: () => Promise<Done | null>) => {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      setDone(await work())
    } catch (e) {
      setError(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const exportFiles = () =>
    run(async () => {
      const dir = await window.nexgraph.exporter.pickDir()
      if (!dir) return null
      const r = await window.nexgraph.exporter.run(projectId, choice as ExportFormat, scope, dir)
      return { kind: 'files', ...r }
    })
  const savePng = () =>
    run(async () => {
      setCapturing(true)
      try {
        await nextFrame()
        await nextFrame()
        const r = document.querySelector('.canvas-wrap')?.getBoundingClientRect()
        const rect = r ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : undefined
        const path = await window.nexgraph.exporter.png(rect)
        return path ? { kind: 'files', files: [path], truncated: false } : null
      } finally {
        setCapturing(false)
      }
    })
  const push = () =>
    run(async () => {
      const target = choice as 'neo4j' | 'falkordb'
      const r = await window.nexgraph.exporter.push(projectId, {
        target, uri, ...(user ? { user } : {}), ...(password ? { password } : {}), scope
      })
      return { kind: 'push', ...r }
    })

  const isPush = choice === 'neo4j' || choice === 'falkordb'
  const scopeLabel = initialScope.kind === 'node' ? vi.export.scopeNode(initialScope.value)
    : initialScope.kind === 'community' ? vi.export.scopeCommunity(initialScope.value) : null

  if (capturing) return null
  return (
    <div className="modal-backdrop">
      <div role="dialog" aria-modal="true" aria-label={vi.export.title(projectName)} className="modal export-dialog">
        <header>
          <b>{vi.export.title(projectName)}</b>
          <button type="button" aria-label={vi.export.close} onClick={onClose}>×</button>
        </header>

        {scopeLabel && choice !== 'png' && (
          <fieldset className="export-scope">
            <legend>{vi.export.scope}</legend>
            <label><input type="radio" name="scope" checked={scope.kind !== 'all'} onChange={() => setScope(initialScope)} /> {scopeLabel}</label>
            <label><input type="radio" name="scope" checked={scope.kind === 'all'} onChange={() => setScope({ kind: 'all' })} /> {vi.export.scopeAll}</label>
          </fieldset>
        )}

        <fieldset className="export-formats">
          <legend>{vi.export.format}</legend>
          {CHOICES.map((c) => (
            <label key={c} className={choice === c ? 'active' : undefined}>
              <input type="radio" name="format" value={c} aria-label={vi.export.formats[c][0]} checked={choice === c} onChange={() => pick(c)} />
              <span>
                <b>{vi.export.formats[c][0]}</b>
                <small className="muted">{vi.export.formats[c][1]}</small>
              </span>
            </label>
          ))}
        </fieldset>

        {isPush && (
          <div className="export-push">
            <label>{vi.export.uri}<input value={uri} onChange={(e) => setUri(e.target.value)} /></label>
            <label>{vi.export.user}<input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" /></label>
            <label>{vi.export.password}<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" /></label>
            <p className="muted">{vi.export.passwordHint}</p>
          </div>
        )}

        {error && <p role="alert" className="error">{error}</p>}
        {done?.truncated && <p className="warn">{vi.export.truncated}</p>}
        {done?.kind === 'files' && (
          <div className="export-done">
            <p>{vi.export.saved}</p>
            <ul>{done.files.map((f) => <li key={f} className="mono">{f}</li>)}</ul>
            <button type="button" onClick={() => void window.nexgraph.exporter.reveal(done.files[0])}>{vi.export.reveal}</button>
          </div>
        )}
        {done?.kind === 'push' && <p className="export-done">{vi.export.pushed(done.nodes, done.edges)}</p>}

        <footer>
          <button type="button" onClick={onClose}>{vi.export.close}</button>
          <button type="button" className="primary" disabled={busy || (isPush && !uri.trim())}
            onClick={() => void (isPush ? push() : choice === 'png' ? savePng() : exportFiles())}>
            {busy ? vi.export.running : isPush ? vi.export.push : choice === 'png' ? vi.export.png : vi.export.run}
          </button>
        </footer>
      </div>
    </div>
  )
}
