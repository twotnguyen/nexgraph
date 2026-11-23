import { useEffect, useRef, useState } from 'react'
import type { ExportFormat, ExportScope } from '@shared/graph-types'
import { getLocale } from '../../state/locale'
import { vi } from '../../strings'
import { Icon } from '../common/icons'
import { errorMsg } from '../../state/errorText'
import { msgText, type Message } from '../../state/messages'

type Choice = ExportFormat | 'png' | 'neo4j' | 'falkordb'

const FILE_FORMATS: ExportFormat[] = ['html', 'callflow_html', 'obsidian', 'wiki', 'svg', 'graphml', 'cypher', 'json', 'markdown']
const CHOICES: Choice[] = [...FILE_FORMATS, 'png', 'neo4j', 'falkordb']
const DEFAULT_URI = { neo4j: 'bolt://localhost:7687', falkordb: 'redis://localhost:6379' }

type Done = { kind: 'files'; files: string[]; truncated: boolean } | { kind: 'push'; nodes: number; edges: number; truncated: boolean }

interface Props {
  projectId: string
  projectName: string
  scope: ExportScope
  /** Nhãn hiển thị của phạm vi cộng đồng (tên cộng đồng); thiếu thì dùng id `com:<n>`. */
  scopeLabel?: string
  /** Định dạng chọn sẵn khi mở (mặc định HTML). */
  initialFormat?: ExportFormat
  onClose: () => void
}

// Hai khung hình: React bỏ hộp thoại khỏi DOM rồi trình duyệt vẽ lại, sau đó mới chụp.
const nextFrame = () => new Promise<void>((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 16)))

/** Phần tử nhận focus được trong hộp thoại, cùng bộ chọn với ConnectionDialog. */
const FOCUSABLE = 'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]'

const scopeKeyOf = (scope: ExportScope): string => scope.kind === 'all' ? 'all' : `${scope.kind}:${scope.value}`


export function ExportDialog({ projectId, projectName, scope: initialScope, scopeLabel: initialScopeLabel, initialFormat = 'html', onClose }: Props) {
  const [choice, setChoice] = useState<Choice>(initialFormat)
  const [scope, setScope] = useState<ExportScope>(initialScope)
  const [busy, setBusy] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState<Message | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const [uri, setUri] = useState(DEFAULT_URI.neo4j)
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const dialog = useRef<HTMLDivElement>(null)
  // `onClose` của chỗ dùng là arrow mới mỗi lần cha vẽ lại; giữ trong ref để effect focus chỉ chạy một lần.
  const close = useRef(onClose)
  close.current = onClose

  // Nhãn phạm vi lấy từ prop; state phải theo khi prop đổi, nếu không hộp thoại mở lại cho cộng đồng
  // khác vẫn xuất cộng đồng cũ (review #63, Important 2). So theo khoá chứ không theo identity object
  // (ProjectOverviewScreen truyền object mới mỗi lần vẽ).
  const scopeKey = scopeKeyOf(initialScope)
  useEffect(() => {
    setScope(initialScope)
    setDone(null)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ đồng bộ khi phạm vi đổi
  }, [scopeKey])

  // Modal đúng nghĩa: đưa focus vào trong, giữ Tab trong hộp thoại, Escape đóng và trả focus về nút đã mở.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusables = (): HTMLElement[] => Array.from(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    dialog.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close.current()
        return
      }
      if (e.key !== 'Tab') return
      const controls = focusables()
      if (controls.length === 0) {
        e.preventDefault()
        return
      }
      const first = controls[0]
      const last = controls[controls.length - 1]
      // Focus lạc ra sau lưng (ca QA #63) thì kéo về đầu hộp thoại thay vì đi tiếp ra bảng cộng đồng.
      if (!dialog.current?.contains(document.activeElement)) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (previous?.isConnected) previous.focus()
    }
  }, [])

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
      setError(errorMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const exportFiles = () =>
    run(async () => {
      const dir = await window.nexgraph.exporter.pickDir(projectId)
      if (!dir) return null
      // Tệp HTML callflow do engine sinh theo ngôn ngữ UI đang dùng.
      const r = await window.nexgraph.exporter.run(projectId, choice as ExportFormat, scope, getLocale())
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
        const path = await window.nexgraph.exporter.png(projectId, rect)
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
    : initialScope.kind === 'community' ? vi.export.scopeCommunity(initialScopeLabel ?? initialScope.value) : null

  if (capturing) return null
  return (
    <div className="modal-backdrop">
      <div ref={dialog} role="dialog" aria-modal="true" aria-label={vi.export.title(projectName)} className="modal export-dialog">
        <header>
          <b>{vi.export.title(projectName)}</b>
          <button type="button" aria-label={vi.export.close} onClick={onClose}><Icon name="close" size={14} /></button>
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

        {error && <p role="alert" className="error">{msgText(error)}</p>}
        {done?.truncated && <p className="warn">{vi.export.truncated}</p>}
        {done?.kind === 'files' && (
          <div className="export-done">
            <p>{vi.export.saved}</p>
            <ul>{done.files.map((f) => <li key={f} className="mono">{f}</li>)}</ul>
            <button type="button" onClick={() => void window.nexgraph.exporter.reveal(projectId, done.files[0]).catch((e) => setError(errorMsg(e)))}>{vi.export.reveal}</button>
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
