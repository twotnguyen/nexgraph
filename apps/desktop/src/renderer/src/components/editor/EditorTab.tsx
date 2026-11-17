import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileContent } from '@shared/api'
import { vi } from '../../strings'
import { createEditor, languageFor, type EditorHandle } from './monaco'

interface Props {
  projectId: string
  file: string
  line: number
  lineEnd?: number
  onClose: () => void
  onDirtyChange: (file: string, dirty: boolean) => void
  /** Thẻ đang hiện; thẻ ẩn vẫn gắn kết để giữ nội dung, con trỏ và undo, và không nhận Ctrl+S. */
  active?: boolean
}

type OpenFile = { editor: EditorHandle; base: FileContent }
type Conflict = { disk: FileContent | null; detail?: string }

function explain(e: { code?: string; message?: string }): string {
  if (e?.code === 'file_not_found') return vi.editor.missing
  if (e?.code === 'outside_project') return vi.editor.outside
  return e?.message ?? vi.editor.failed
}

/** Thẻ soạn thảo một tệp: nạp, sửa, lưu (Ctrl/Cmd+S) và xử lý tệp đổi trên đĩa. */
export function EditorTab({ projectId, file, line, lineEnd, onClose, onDirtyChange, active = true }: Props) {
  const host = useRef<HTMLDivElement | null>(null)
  const editor = useRef<EditorHandle | null>(null)
  const actions = useRef<{ save: () => void; reload: () => void; keepMine: () => void } | null>(null)
  const dirty = useRef(false)
  const [readOnly, setReadOnly] = useState<FileContent['reason'] | boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [reloading, setReloading] = useState(false)
  const [ready, setReady] = useState(false)

  const setDirty = useCallback((d: boolean) => {
    if (dirty.current === d) return
    dirty.current = d
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

    setReady(false)
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
      try {
        const revision = await fs.write(projectId, file, text, { eol: b.eol, bom: b.bom, expectedVersion: b.version })
        if (!alive) return
        current.base = { ...b, ...revision, text }
        setError(null)
      } catch (e) {
        if (!alive) return
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
      const ed = createEditor(host.current, { value: c.text, language: languageFor(file), readOnly: c.readOnly })
      open = { editor: ed, base: c }
      editor.current = ed
      ed.onChange(updateDirty)
      ed.revealLines(line, lineEnd)
      setReadOnly(c.readOnly ? (c.reason ?? true) : false)
      setReady(true)
      void flush()
    }).catch((e) => alive && setError(explain(e)))
    return () => {
      alive = false
      off()
      actions.current = null
      editor.current?.dispose()
      editor.current = null
      setDirty(false)
    }
    // line/lineEnd chỉ dùng cho lần mở; đổi dòng được xử lý ở hiệu ứng dưới.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, file])

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
  return (
    <div className="code-viewer editor-tab" style={active ? undefined : { display: 'none' }}>
      <header className="code-head">
        <span className="mono">{file}</span>
        <button type="button" onClick={onClose}>{vi.editor.close}</button>
      </header>
      {error && <p role="alert" className="error">{error}</p>}
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
    </div>
  )
}
