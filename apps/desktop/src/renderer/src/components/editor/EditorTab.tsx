import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileContent } from '@shared/api'
import type { AgentContextItem } from '@shared/agent-types'
import { vi } from '../../strings'
import { createEditor, languageFor, type EditorHandle } from './monaco'
import { Icon } from '../common/icons'
import './editor-tab.css'

export type EditorContextGetter = () => Extract<AgentContextItem, { kind: 'file' }> | null

interface Props {
  projectId: string
  file: string
  line: number
  lineEnd?: number
  onClose: () => void
  onDirtyChange: (file: string, dirty: boolean) => void
  onContextReady?: (file: string, getter: EditorContextGetter | null) => void
  /** Thẻ đang hiện; thẻ ẩn vẫn gắn kết để giữ nội dung, con trỏ và undo, và không nhận Ctrl+S. */
  active?: boolean
}

type OpenFile = { editor: EditorHandle; base: FileContent }
type Conflict = { disk: FileContent | null; detail?: string }
type EditorFormat = { language: string; eol: FileContent['eol']; bom: boolean }

const LANGUAGE_NAMES: Record<string, string> = {
  plaintext: 'Văn bản thuần', typescript: 'TypeScript', javascript: 'JavaScript',
  python: 'Python', dart: 'Dart', csharp: 'C#', json: 'JSON', yaml: 'YAML',
  markdown: 'Markdown', html: 'HTML', css: 'CSS'
}

function explain(e: { code?: string; message?: string }): string {
  if (e?.code === 'file_not_found') return vi.editor.missing
  if (e?.code === 'outside_project') return vi.editor.outside
  return e?.message ?? vi.editor.failed
}

/** Thẻ soạn thảo một tệp: nạp, sửa, lưu (Ctrl/Cmd+S) và xử lý tệp đổi trên đĩa. */
export function EditorTab({ projectId, file, line, lineEnd, onClose, onDirtyChange, onContextReady, active = true }: Props) {
  const host = useRef<HTMLDivElement | null>(null)
  const editor = useRef<EditorHandle | null>(null)
  const actions = useRef<{ save: () => void; reload: () => void; keepMine: () => void } | null>(null)
  const dirty = useRef(false)
  const contextCallback = useRef(onContextReady)
  contextCallback.current = onContextReady
  const [readOnly, setReadOnly] = useState<FileContent['reason'] | boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [reloading, setReloading] = useState(false)
  const [ready, setReady] = useState(false)
  const [format, setFormat] = useState<EditorFormat | null>(null)
  const [modified, setModified] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [loadAttempt, setLoadAttempt] = useState(0)

  const setDirty = useCallback((d: boolean) => {
    if (dirty.current === d) return
    dirty.current = d
    setModified(d)
    onDirtyChange(file, d)
  }, [file, onDirtyChange])

  useEffect(() => {
    const fs = window.nexgraph.fs
    let alive = true
    let open: OpenFile | null = null
    let diskConflict: Conflict | null = null
    let writing: string | undefined
    let pendingSave: string | undefined
    let pendingReload: string | undefined
    let pendingCheck = false
    let busy = false
    let isReloading = false
    const language = languageFor(file)
    const updateFormat = ({ eol, bom, reason }: FileContent) => {
      setFormat(reason ? null : { language: LANGUAGE_NAMES[language] ?? language, eol, bom })
    }

    setReady(false)
    contextCallback.current?.(file, null)
    setFormat(null)
    setSaveState('idle')
    setError(null)
    setReadOnly(false)
    setConflict(null)
    setReloading(false)

    const updateDirty = () => {
      if (!open) return
      const text = open.editor.getValue()
      setDirty(text !== open.base.text || (writing !== undefined && text !== writing)
        || (pendingSave !== undefined && text !== pendingSave))
    }

    const updateConflict = (next: Conflict | null) => {
      diskConflict = next
      if (next) pendingSave = undefined
      setConflict(next)
      updateDirty()
    }

    const adopt = (current: OpenFile, disk: FileContent) => {
      pendingSave = undefined
      current.base = disk
      current.editor.setValue(disk.text)
      current.editor.setReadOnly(disk.readOnly)
      setReadOnly(disk.readOnly ? (disk.reason ?? true) : false)
      updateFormat(disk)
      setError(null)
      updateConflict(null)
    }

    const readDisk = async (current: OpenFile, reloadBuffer?: string) => {
      try {
        const latest = await fs.read(projectId, file)
        if (!alive) return
        if (reloadBuffer !== undefined) {
          // Người dùng có thể gõ thêm trong lúc chờ đọc đĩa.
          if (current.editor.getValue() === reloadBuffer) adopt(current, latest)
          else updateConflict({ disk: latest })
        } else if (diskConflict || latest.version !== current.base.version) {
          if (diskConflict || dirty.current) updateConflict({ disk: latest })
          else adopt(current, latest)
        }
      } catch (e) {
        if (!alive) return
        const err = e as { code?: string; message?: string }
        if (err?.code === 'file_not_found') updateConflict({ disk: null, detail: vi.editor.deletedOnDisk })
        else if (diskConflict) updateConflict({ disk: null, detail: explain(err) })
      }
    }

    const write = async (current: OpenFile, text: string) => {
      const b = current.base
      if (diskConflict || b.readOnly || b.text === text) {
        updateDirty()
        return
      }
      writing = text
      setSaveState('saving')
      try {
        const revision = await fs.write(projectId, file, text, { eol: b.eol, bom: b.bom, expectedVersion: b.version })
        if (!alive) return
        current.base = { ...b, ...revision, text }
        setError(null)
        setSaveState('saved')
      } catch (e) {
        if (!alive) return
        setSaveState('idle')
        pendingSave = undefined
        if ((e as { code?: string })?.code === 'conflict') {
          setError(null)
          updateConflict({ disk: null })
          await readDisk(current)
        } else setError(vi.editor.saveFailed)
      } finally {
        writing = undefined
        if (alive) updateDirty()
      }
    }

    // Chỉ một yêu cầu IPC thao tác tệp chạy mỗi lúc. Ctrl+S đang chờ giữ nội dung tại thời điểm bấm.
    const flush = async () => {
      if (busy || !open) return
      const current = open
      busy = true
      try {
        while (alive) {
          if (pendingReload !== undefined) {
            const buffer = pendingReload
            pendingReload = undefined
            pendingCheck = false
            await readDisk(current, buffer)
            isReloading = false
            if (alive) setReloading(false)
          } else if (pendingSave !== undefined) {
            const text = pendingSave
            pendingSave = undefined
            await write(current, text)
          } else if (pendingCheck) {
            pendingCheck = false
            await readDisk(current)
          } else break
        }
      } finally {
        busy = false
      }
    }

    actions.current = {
      save: () => {
        if (!open || open.base.readOnly || diskConflict) return
        const text = open.editor.getValue()
        pendingSave = text === open.base.text && writing === undefined ? undefined : text
        updateDirty()
        if (pendingSave !== undefined) void flush()
      },
      reload: () => {
        if (!open || !diskConflict || isReloading) return
        pendingReload = open.editor.getValue()
        isReloading = true
        setReloading(true)
        void flush()
      },
      keepMine: () => {
        const disk = diskConflict?.disk
        if (!open || !disk || disk.readOnly || isReloading) return
        // Chỉ chấp nhận phiên bản đĩa đã quan sát. Lần lưu kế tiếp vẫn kiểm lại phiên bản đó.
        open.base = disk
        updateFormat(disk)
        setError(null)
        updateConflict(null)
      }
    }

    const off = window.nexgraph.index.onEvent((event) => {
      if (event.type === 'changes_updated' && event.project_id === projectId) {
        pendingCheck = true
        void flush()
      }
    })
    fs.read(projectId, file).then((c) => {
      if (!alive || !host.current) return
      const ed = createEditor(host.current, { value: c.text, language, readOnly: c.readOnly })
      open = { editor: ed, base: c }
      editor.current = ed
      ed.onChange(updateDirty)
      ed.revealLines(line, lineEnd)
      setReadOnly(c.readOnly ? (c.reason ?? true) : false)
      updateFormat(c)
      setReady(true)
      contextCallback.current?.(file, () => {
        if (!alive || !open || open.base.readOnly) return null
        const selection = open.editor.getSelection?.()
        const text = selection?.text ?? open.editor.getValue()
        return { kind: 'file', file, text, start: selection?.start ?? 1,
          end: selection?.end ?? text.split('\n').length,
          version: open.base.version, dirty: dirty.current }
      })
      void flush()
    }).catch((e) => alive && setError(explain(e)))
    return () => {
      alive = false
      off()
      actions.current = null
      contextCallback.current?.(file, null)
      editor.current?.dispose()
      editor.current = null
      setDirty(false)
    }
    // line/lineEnd chỉ dùng cho lần mở; đổi dòng được xử lý ở hiệu ứng dưới.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, file, loadAttempt])

  useEffect(() => {
    if (ready) editor.current?.revealLines(line, lineEnd)
  }, [ready, line, lineEnd])

  // Nghe cả tài liệu để Ctrl+S hoạt động khi tiêu điểm vừa rời khỏi Monaco; chỉ thẻ đang hiện xử lý.
  const activeRef = useRef(active)
  activeRef.current = active
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (activeRef.current && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (!e.repeat) actions.current?.save()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const readOnlyNote = readOnly === 'too_large' ? vi.editor.readOnlyTooLarge : readOnly === 'not_text' ? vi.editor.readOnlyNotText : readOnly ? vi.editor.readOnly : null
  const saveLabel = saveState === 'saving' ? 'Đang lưu…' : modified ? 'Chưa lưu' : saveState === 'saved' ? 'Đã lưu' : null
  const parts = file.split('/')
  const visiblePath = parts.length > 4 ? ['…', ...parts.slice(-4)] : parts

  return (
    <div className="code-viewer editor-tab" style={active ? undefined : { display: 'none' }}>
      <header className="code-head">
        <ol className="editor-path mono" aria-label={`Đường dẫn tệp ${file}`} title={file}>
          {visiblePath.map((segment, index) => (
            <li key={index} aria-current={index === visiblePath.length - 1 ? 'true' : undefined}>
              {index > 0 && <Icon name="chevron" size={12} />}
              <span>{segment}</span>
            </li>
          ))}
        </ol>
        <span className="ws-editor-actions">
          {saveLabel && <span role="status" className="ws-save-state" data-state={saveState}>{saveLabel}</span>}
          <button type="button" disabled={!ready || !!readOnly || !modified || !!conflict} onClick={() => actions.current?.save()}
            title="Lưu (Ctrl/Cmd+S)">Lưu</button>
          <button type="button" onClick={onClose}>{vi.editor.close}</button>
        </span>
      </header>
      {!ready && !error && <p role="status" className="ws-editor-loading muted">Đang mở tệp…</p>}
      {error && <div className="ws-editor-error">
        <p role="alert" className="error">{error}</p>
        {!ready && <button type="button" onClick={() => setLoadAttempt((n) => n + 1)}>Thử lại</button>}
      </div>}
      {readOnlyNote && <p role="status" className="stale-banner">{readOnlyNote}</p>}
      {conflict && (
        <p role="alert" className="stale-banner">
          {conflict.detail ?? vi.editor.changedOnDisk}{' '}
          {vi.editor.reloadDiscards}{' '}
          <button type="button" disabled={reloading} onClick={() => actions.current?.reload()}>{vi.editor.reload}</button>{' '}
          {conflict.disk && !conflict.disk.readOnly && (
            <button type="button" disabled={reloading} onClick={() => actions.current?.keepMine()}>{vi.editor.keepMine}</button>
          )}
        </p>
      )}
      <div ref={host} className="editor-host" />
      {format && (
        <footer className="editor-format" aria-label="Định dạng tệp">
          <span>{format.language}</span>
          <span>{format.eol === '\r\n' ? 'CRLF' : 'LF'}</span>
          <span>{format.bom ? 'UTF-8 BOM' : 'UTF-8'}</span>
        </footer>
      )}
    </div>
  )
}
