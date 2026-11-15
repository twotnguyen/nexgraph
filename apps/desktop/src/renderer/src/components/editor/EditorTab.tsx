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

function explain(e: { code?: string; message?: string }): string {
  if (e?.code === 'file_not_found') return vi.editor.missing
  if (e?.code === 'outside_project') return vi.editor.outside
  return e?.message ?? vi.editor.failed
}

/** Thẻ soạn thảo một tệp: nạp, sửa, lưu (Ctrl/Cmd+S) và xử lý tệp đổi trên đĩa. */
export function EditorTab({ projectId, file, line, lineEnd, onClose, onDirtyChange, active = true }: Props) {
  const host = useRef<HTMLDivElement | null>(null)
  const editor = useRef<EditorHandle | null>(null)
  // base: bản đang coi là "đã lưu" — nội dung + metadata (mtime/eol/bom) của đĩa tương ứng.
  const base = useRef<{ text: string; mtimeMs: number; eol: FileContent['eol']; bom: boolean } | null>(null)
  const dirty = useRef(false)
  const [readOnly, setReadOnly] = useState<FileContent['reason'] | boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [disk, setDisk] = useState<FileContent | null>(null) // có giá trị = đang xung đột với bản trên đĩa
  const [ready, setReady] = useState(false)

  const setDirty = useCallback((d: boolean) => {
    if (dirty.current === d) return
    dirty.current = d
    onDirtyChange(file, d)
  }, [file, onDirtyChange])

  useEffect(() => {
    let alive = true
    window.nexgraph.fs.read(projectId, file).then((c) => {
      if (!alive || !host.current) return
      base.current = { text: c.text, mtimeMs: c.mtimeMs, eol: c.eol, bom: c.bom }
      const ed = createEditor(host.current, { value: c.text, language: languageFor(file), readOnly: c.readOnly })
      editor.current = ed
      ed.onChange(() => setDirty(ed.getValue() !== base.current?.text))
      ed.revealLines(line, lineEnd)
      setReadOnly(c.readOnly ? (c.reason ?? true) : false)
      setReady(true)
    }).catch((e) => alive && setError(explain(e)))
    return () => {
      alive = false
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

  const adopt = (c: FileContent): void => {
    base.current = { text: c.text, mtimeMs: c.mtimeMs, eol: c.eol, bom: c.bom }
    editor.current?.setValue(c.text)
    editor.current?.setReadOnly(c.readOnly)
    setReadOnly(c.readOnly ? (c.reason ?? true) : false)
    setDirty(false)
    setDisk(null)
  }

  // Tín hiệu "dự án có thay đổi" của bộ theo dõi: đọc lại tệp và so mtime. Đang lưu thì bỏ qua rồi kiểm lại một lần sau khi lưu xong.
  const saving = useRef(false)
  const skipped = useRef(false)
  const checkDisk = useCallback(() => {
    if (saving.current) {
      skipped.current = true
      return
    }
    window.nexgraph.fs.read(projectId, file).then((c) => {
      if (saving.current || !base.current || c.mtimeMs === base.current.mtimeMs) return
      if (dirty.current) setDisk(c)
      else adopt(c)
    }).catch((e) => {
      if ((e as { code?: string })?.code === 'file_not_found') setError(vi.editor.deletedOnDisk) // giữ nguyên nội dung đang có
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, file])
  useEffect(() => {
    const off = window.nexgraph.index.onEvent((e) => {
      if (e.type === 'changes_updated' && e.project_id === projectId) checkDisk()
    })
    return off
  }, [projectId, checkDisk])

  const save = async (): Promise<void> => {
    const ed = editor.current
    const b = base.current
    if (!ed || !b || readOnly) return
    const text = ed.getValue()
    saving.current = true
    try {
      const r = await window.nexgraph.fs.write(projectId, file, text, { eol: b.eol, bom: b.bom, expectedMtimeMs: b.mtimeMs })
      base.current = { ...b, text, mtimeMs: r.mtimeMs }
      setError(null)
      setDirty(ed.getValue() !== text)
    } catch (e) {
      if ((e as { code?: string })?.code !== 'conflict') return setError(vi.editor.saveFailed)
      try {
        setDisk(await window.nexgraph.fs.read(projectId, file))
      } catch (e2) {
        setError(explain(e2 as { code?: string }))
      }
    } finally {
      saving.current = false
      if (skipped.current) {
        skipped.current = false
        checkDisk()
      }
    }
  }

  // Chỉ thẻ đang hiện được gắn kết, nên nghe cả tài liệu: Ctrl+S vẫn hoạt động khi tiêu điểm vừa rời khỏi thanh xung đột.
  const activeRef = useRef(active)
  activeRef.current = active
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (activeRef.current && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveRef.current()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const keepMine = (): void => {
    if (base.current && disk) {
      // Baseline trở thành bản đĩa (nội dung + metadata) nên dirty so với đĩa; buffer/undo giữ nguyên.
      base.current = { text: disk.text, mtimeMs: disk.mtimeMs, eol: disk.eol, bom: disk.bom }
      setDirty(editor.current ? editor.current.getValue() !== disk.text : false)
    }
    setDisk(null)
  }

  const readOnlyNote = readOnly === 'too_large' ? vi.editor.readOnlyTooLarge : readOnly === 'not_text' ? vi.editor.readOnlyNotText : readOnly ? vi.editor.readOnly : null
  return (
    <div className="code-viewer editor-tab" style={active ? undefined : { display: 'none' }}>
      <header className="code-head">
        <span className="mono">{file}</span>
        <button type="button" onClick={onClose}>{vi.editor.close}</button>
      </header>
      {error && <p role="alert" className="error">{error}</p>}
      {readOnlyNote && <p role="status" className="stale-banner">{readOnlyNote}</p>}
      {disk && (
        <p role="alert" className="stale-banner">
          {vi.editor.changedOnDisk}{' '}
          <button type="button" onClick={() => adopt(disk)}>{vi.editor.reload}</button>{' '}
          <button type="button" onClick={keepMine}>{vi.editor.keepMine}</button>
        </p>
      )}
      <div ref={host} className="editor-host" />
    </div>
  )
}
