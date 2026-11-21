import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileContent, GitBlameLine } from '@shared/api'
import type { AgentContextItem } from '@shared/agent-types'
import { vi, tr } from '../../strings'
import { createEditor, languageFor, type EditorHandle } from './monaco'
import { createAutoSave } from './autoSave'
import { Icon } from '../common/icons'
import { FileTypeIcon } from '../common/FileTypeIcon'
import { StatusBarItems } from '../EngineStatusBar'
import { EditorDebug } from '../debug/EditorDebug'
import { getEditorPrefs, observeEditorPrefs, useBlame, useEditorPrefs, useVimMode } from '../../state/editorPrefs'
import { toggleBreakpoint, useDebugState } from '../../state/debugState'
import { leaveSession, useCollab } from '../../state/collab'
import { setActiveEditor } from '../../state/activeEditor'
import { useDiagnostics } from '../../state/diagnostics'
import { runCommand, useCommand } from '../../state/commands'
import { listBookmarks, nextBookmark, subscribeBookmarks, toggleBookmark } from '../../state/bookmarks'
import './editor-tab.css'

export type EditorContextGetter = () => Extract<AgentContextItem, { kind: 'file' }> | null

interface Props {
  projectId: string
  file: string
  line: number
  column?: number
  lineEnd?: number
  /** Đổi mỗi lần mở tệp từ nơi khác: mở lại cùng dòng sau khi đã cuộn đi vẫn cuộn về. */
  revealRequest?: number
  onClose: () => void
  onDirtyChange: (file: string, dirty: boolean) => void
  onContextReady?: (file: string, getter: EditorContextGetter | null) => void
  /** Thẻ đang hiện; thẻ ẩn vẫn gắn kết để giữ nội dung, con trỏ và undo, và không nhận Ctrl+S. */
  active?: boolean
  /** Mở tệp này ở khung phải (chia đôi, cùng bộ đệm). */
  onSplit?: () => void
  /** F12 / ⌘-click sang tệp khác trong dự án. */
  onOpenFile?: (file: string, line: number, column?: number) => void
  /** Chuyển SVG từ mã nguồn sang xem ảnh. */
  onViewImage?: () => void
  /** Chuyển CSV/TSV từ mã nguồn sang xem bảng. */
  onViewTable?: () => void
  onReadOnlyChange?: (file: string, readOnly: boolean) => void
  onLoadError?: (file: string, error: string | null) => void
}

type OpenFile = { editor: EditorHandle; base: FileContent }
type Conflict = { disk: FileContent | null; detail?: string }
type EditorFormat = { language: string; eol: FileContent['eol']; bom: boolean }

const LANGUAGE_NAMES: Record<string, string> = {
  typescript: 'TypeScript', javascript: 'JavaScript',
  python: 'Python', dart: 'Dart', csharp: 'C#', json: 'JSON', yaml: 'YAML',
  markdown: 'Markdown', html: 'HTML', css: 'CSS'
}

function explain(e: { code?: string; message?: string }): string {
  if (e?.code === 'file_not_found') return vi.editor.missing
  if (e?.code === 'outside_project') return vi.editor.outside
  return e?.message ?? vi.editor.failed
}

/** "Tác giả, 3 ngày trước • tóm tắt" như inline blame của Wu; `summary` false thì bỏ phần tóm tắt commit. */
export function blameText(line: GitBlameLine, now = Date.now(), summary = true): string {
  if (line.uncommitted) return tr('Bạn • Chưa commit')
  const days = Math.floor((now / 1000 - line.time) / 86_400)
  const ago = days < 1 ? tr('hôm nay') : days < 30 ? tr('{days} ngày trước', { days }) : days < 365 ? tr('{months} tháng trước', { months: Math.floor(days / 30) }) : tr('{years} năm trước', { years: Math.floor(days / 365) })
  return `${line.author}, ${ago}${summary ? ` • ${line.summary}` : ''}`
}

/** Thẻ soạn thảo một tệp: nạp, sửa, lưu (Ctrl/Cmd+S) và xử lý tệp đổi trên đĩa. */
export function EditorTab({ projectId, file, line, column, lineEnd, revealRequest, onClose, onDirtyChange, onContextReady, active = true, onSplit, onOpenFile, onViewImage, onViewTable, onReadOnlyChange, onLoadError }: Props) {
  const host = useRef<HTMLDivElement | null>(null)
  const editor = useRef<EditorHandle | null>(null)
  const actions = useRef<{ save: () => void; reload: () => void; keepMine: () => void; blur: () => void } | null>(null)
  const dirty = useRef(false)
  const contextCallback = useRef(onContextReady)
  contextCallback.current = onContextReady
  const openFileRef = useRef(onOpenFile)
  openFileRef.current = onOpenFile
  const readOnlyCallback = useRef(onReadOnlyChange)
  readOnlyCallback.current = onReadOnlyChange
  const loadErrorCallback = useRef(onLoadError)
  loadErrorCallback.current = onLoadError
  const [readOnly, setReadOnly] = useState<FileContent['reason'] | boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [reloading, setReloading] = useState(false)
  const [ready, setReady] = useState(false)
  const [format, setFormat] = useState<EditorFormat | null>(null)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [modified, setModified] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const vim = useVimMode()
  const [vimNode, setVimNode] = useState<HTMLElement | null>(null)
  const blameOn = useBlame()
  const { blameDelay, blameSummary } = useEditorPrefs()
  const [blame, setBlameLines] = useState<Map<number, GitBlameLine> | null>(null)
  const diagnostics = useDiagnostics(projectId)
  const problems = Object.values(diagnostics).flat()
  const errorCount = problems.filter((item) => (item.severity ?? 1) === 1).length
  const warningCount = problems.filter((item) => item.severity === 2).length

  const [bookmarkLines, setBookmarkLines] = useState<number[]>([])
  useEffect(() => {
    const sync = () => setBookmarkLines(listBookmarks(projectId).filter((item) => item.file === file).map((item) => item.line))
    sync()
    return subscribeBookmarks(sync)
  }, [projectId, file])
  useEffect(() => { if (ready) editor.current?.setBookmarks?.(bookmarkLines) }, [ready, bookmarkLines])

  const toggleAtCursor = useCallback(() => {
    if (!active) return
    const at = editor.current?.getPosition?.()?.line ?? cursor.line
    toggleBookmark(projectId, file, Math.max(1, at))
  }, [active, cursor.line, projectId, file])
  const stepBookmark = useCallback((direction: 1 | -1) => {
    const at = editor.current?.getPosition?.()?.line ?? cursor.line
    const target = nextBookmark(listBookmarks(projectId), file, at, direction)
    if (!target) return
    if (target.file !== file) openFileRef.current?.(target.file, target.line, 1)
    else if (editor.current?.revealPosition) editor.current.revealPosition(target.line, 1)
    else editor.current?.revealLines(target.line, target.line)
  }, [cursor.line, projectId, file])
  useCommand('editor.toggle_bookmark', toggleAtCursor, active && ready)
  useCommand('editor.next_bookmark', () => stepBookmark(1), active && ready)
  useCommand('editor.previous_bookmark', () => stepBookmark(-1), active && ready)

  const setDirty = useCallback((d: boolean) => {
    if (dirty.current === d) return
    dirty.current = d
    setModified(d)
    onDirtyChange(file, d)
  }, [file, onDirtyChange])

  useEffect(() => {
    const fs = window.nexgraph.fs
    let alive = true
    let lspTimer: ReturnType<typeof setTimeout> | undefined
    let open: OpenFile | null = null
    let diskConflict: Conflict | null = null
    let writing: string | undefined
    let pendingSave: string | undefined
    let pendingReload: string | undefined
    let pendingCheck = false
    let busy = false
    let isReloading = false
    let formatting: Promise<void> | null = null
    let saveGeneration = 0
    const language = languageFor(file)
    const updateFormat = ({ eol, bom, reason }: FileContent) => {
      setFormat(reason ? null : { language: language === 'plaintext' ? tr('Văn bản thuần') : LANGUAGE_NAMES[language] ?? language, eol, bom })
    }

    setReady(false)
    contextCallback.current?.(file, null)
    setFormat(null)
    setSaveState('idle')
    setError(null)
    loadErrorCallback.current?.(file, null)
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
      readOnlyCallback.current?.(file, disk.readOnly)
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
        const current = open
        if (!current || current.base.readOnly || diskConflict || isReloading) return
        const generation = ++saveGeneration
        const queueSave = () => {
          if (!alive || generation !== saveGeneration || open !== current || current.base.readOnly || diskConflict || isReloading) return
          const text = current.editor.getValue()
          pendingSave = text === current.base.text && writing === undefined ? undefined : text
          updateDirty()
          if (pendingSave !== undefined) void flush()
        }
        if (!formatting && getEditorPrefs().formatOnSave && current.editor.formatDocument) {
          pendingSave = undefined
          formatting = Promise.resolve().then(async () => {
            try { await current.editor.formatDocument?.() } catch { /* không có formatter vẫn lưu */ }
          }).finally(() => { formatting = null })
        }
        if (formatting) void formatting.then(queueSave)
        else queueSave()
      },
      reload: () => {
        if (!open || !diskConflict || isReloading) return
        saveGeneration++
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
      },
      blur: () => autoSave.blur()
    }
    const autoSave = createAutoSave(() => actions.current?.save(),
      () => !!(alive && open && dirty.current && !open.base.readOnly && !diskConflict && !isReloading), getEditorPrefs)
    let { autoSave: autoSaveMode, autoSaveDelay } = getEditorPrefs()
    const offPrefs = observeEditorPrefs(() => {
      const next = getEditorPrefs()
      if (next.autoSave === autoSaveMode && next.autoSaveDelay === autoSaveDelay) return
      autoSaveMode = next.autoSave
      autoSaveDelay = next.autoSaveDelay
      autoSave.change()
    })
    const onFocusOut = (event: FocusEvent) => {
      const from = event.target
      if (!(from instanceof Element)) return
      const mirror = from.closest('[data-mirror-file]')
      const pane = host.current?.contains(from) ? host.current : mirror?.getAttribute('data-mirror-file') === file ? mirror : null
      if (pane && !(event.relatedTarget instanceof Node && pane.contains(event.relatedTarget))) autoSave.blur()
    }
    document.addEventListener('focusout', onFocusOut)

    const off = window.nexgraph.index.onEvent((event) => {
      if (event.type === 'changes_updated' && event.project_id === projectId) {
        pendingCheck = true
        void flush()
      }
    })
    fs.read(projectId, file).then((c) => {
      if (!alive || !host.current) return
      const ed = createEditor(host.current, { value: c.text, language, readOnly: c.readOnly, path: file, projectId, onOpenFile: (target, at, col) => openFileRef.current?.(target, at, col) })
      readOnlyCallback.current?.(file, c.readOnly)
      void window.nexgraph.lsp?.open(projectId, file, c.text).catch(() => {})
      open = { editor: ed, base: c }
      editor.current = ed
      ed.onChange(() => {
        updateDirty()
        autoSave.change()
        clearTimeout(lspTimer)
        lspTimer = setTimeout(() => { if (alive) void window.nexgraph.lsp?.open(projectId, file, ed.getValue()).catch(() => {}) }, 180)
      })
      ed.onCursor?.((line, column) => setCursor({ line, column }))
      ed.onGutterClick?.((at) => toggleBreakpoint(file, at))
      if (column !== undefined && ed.revealPosition) ed.revealPosition(line, column)
      else ed.revealLines(line, lineEnd)
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
    }).catch((e) => { if (alive) { const message = explain(e); setError(message); loadErrorCallback.current?.(file, message) } })
    return () => {
      alive = false
      clearTimeout(lspTimer)
      off()
      autoSave.dispose()
      offPrefs()
      document.removeEventListener('focusout', onFocusOut)
      actions.current = null
      contextCallback.current?.(file, null)
      editor.current?.dispose()
      void window.nexgraph.lsp?.close(projectId, file).catch(() => {})
      editor.current = null
      setDirty(false)
    }
    // line/lineEnd chỉ dùng cho lần mở; đổi dòng được xử lý ở hiệu ứng dưới.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, file, loadAttempt])

  useEffect(() => {
    if (ready) {
      if (column !== undefined && editor.current?.revealPosition) editor.current.revealPosition(line, column)
      else editor.current?.revealLines(line, lineEnd)
    }
  }, [ready, line, column, lineEnd, revealRequest])

  useEffect(() => {
    editor.current?.setVim?.(ready && vim ? vimNode : null)
  }, [ready, vim, vimNode])

  // Inline blame kiểu Wu: lấy lại sau mỗi lần lưu; chỉ hiện khi bộ đệm khớp đĩa để số dòng đúng.
  useEffect(() => {
    if (!ready || !blameOn || !window.nexgraph.git) return setBlameLines(null)
    let live = true
    window.nexgraph.git.blame(projectId, file)
      .then((lines) => { if (live) setBlameLines(new Map(lines.map((l) => [l.line, l]))) })
      .catch(() => { if (live) setBlameLines(null) })
    return () => { live = false }
  }, [ready, blameOn, projectId, file, saveState])
  useEffect(() => {
    const hit = blame && !modified ? blame.get(cursor.line) : undefined
    const show = () => editor.current?.setLineNote?.(cursor.line, hit ? blameText(hit, Date.now(), blameSummary) : null)
    if (!hit || !blameDelay) return show()
    // Có độ trễ: chú thích của dòng cũ biến mất ngay, dòng mới hiện sau khi con trỏ đứng yên đủ lâu.
    editor.current?.setLineNote?.(cursor.line, null)
    const timer = setTimeout(show, blameDelay)
    return () => clearTimeout(timer)
  }, [blame, cursor.line, modified, blameDelay, blameSummary])

  // Gỡ lỗi: chấm điểm dừng ở lề và dòng đang dừng của tệp này.
  const debug = useDebugState()
  const fileBreakpoints = debug.breakpoints[file]
  useEffect(() => { if (ready) editor.current?.setBreakpoints?.(fileBreakpoints ?? []) }, [ready, fileBreakpoints])
  useEffect(() => { if (ready) editor.current?.setExecLine?.(debug.at?.file === file ? debug.at.line : null) }, [ready, debug.at, file])

  // Cộng tác: thẻ đang hiện là tệp lệnh "Chia sẻ" dùng; đóng thẻ đang được chia sẻ thì dừng phiên.
  useEffect(() => {
    const handle = editor.current
    if (!ready || !active || !handle) return
    const entry = { file, handle, text: () => handle.getValue() }
    setActiveEditor(entry)
    return () => setActiveEditor(null)
  }, [ready, active, file])
  const collab = useCollab()
  const sharingThis = collab.role === 'host' && collab.file === file
  const sharingRef = useRef(sharingThis)
  sharingRef.current = sharingThis
  useEffect(() => () => { if (sharingRef.current) leaveSession() }, [])

  // Nghe cả tài liệu để Ctrl+S hoạt động khi tiêu điểm vừa rời khỏi Monaco. Tiêu điểm trong khung chia đôi thì lưu tệp của khung đó; không thì thẻ đang hiện.
  const activeRef = useRef(active)
  activeRef.current = active
  const wasActive = useRef(active)
  useEffect(() => {
    if (wasActive.current && !active) actions.current?.blur()
    wasActive.current = active
  }, [active])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return
      const mirror = document.activeElement?.closest('[data-mirror-file]')?.getAttribute('data-mirror-file')
      if (mirror ? mirror === file : activeRef.current) {
        e.preventDefault()
        if (!e.repeat) actions.current?.save()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [file])

  const readOnlyNote = readOnly === 'too_large' ? vi.editor.readOnlyTooLarge : readOnly === 'not_text' ? vi.editor.readOnlyNotText : readOnly ? vi.editor.readOnly : null
  const saveLabel = saveState === 'saving' ? tr('Đang lưu…') : modified ? tr('Chưa lưu') : saveState === 'saved' ? tr('Đã lưu') : null
  const parts = file.split('/')
  const visiblePath = parts.length > 4 ? ['…', ...parts.slice(-4)] : parts
  const bookmarkLine = editor.current?.getPosition?.()?.line ?? cursor.line
  const bookmarked = bookmarkLines.includes(bookmarkLine)

  return (
    <div className="code-viewer editor-tab" style={active ? undefined : { display: 'none' }}>
      <header className="code-head">
        <ol className="editor-path mono" aria-label={tr('Đường dẫn tệp {file}', { file })} title={file}>
          {visiblePath.map((segment, index) => (
            <li key={index} aria-current={index === visiblePath.length - 1 ? 'true' : undefined}>
              {index > 0 && <Icon name="chevron" size={12} />}
              {index === visiblePath.length - 1 && <FileTypeIcon name={file} size={14} />}
              <span>{segment}</span>
            </li>
          ))}
        </ol>
        <span className="ws-editor-actions">
          {onViewImage && <button type="button" onClick={onViewImage} title={tr('Xem ảnh SVG')}>{tr('Xem ảnh')}</button>}
          {onViewTable && <button type="button" disabled={!ready} onClick={onViewTable} title={tr('Xem CSV/TSV dạng bảng')}>{tr('Xem bảng')}</button>}
          {saveLabel && <span role="status" className="ws-save-state" data-state={saveState}>{saveLabel}</span>}
          <button type="button" className="ws-icon-button" disabled={!ready} aria-pressed={bookmarked}
            aria-label={bookmarked ? tr('Bỏ đánh dấu dòng') : tr('Đánh dấu dòng')}
            title={bookmarked ? tr('Bỏ đánh dấu dòng') : tr('Đánh dấu dòng')} onClick={toggleAtCursor}>
            <Icon name="bookmark" size={15} />
          </button>
          <button type="button" className="ws-icon-button" disabled={!ready || !!readOnly || !modified || !!conflict} onClick={() => actions.current?.save()}
            aria-label={tr('Lưu')} title={tr('Lưu (Ctrl/Cmd+S)')}><Icon name="save" size={15} /></button>
          {onSplit && <button type="button" className="ws-icon-button" disabled={!ready} aria-label={tr('Chia đôi sang phải')} title={tr('Chia đôi sang phải (⌘\)')} onClick={onSplit}><Icon name="panelRight" size={15} /></button>}
          <button type="button" className="ws-icon-button" aria-label={vi.editor.close} title={vi.editor.close} onClick={onClose}><Icon name="close" size={15} /></button>
        </span>
      </header>
      {!ready && !error && <p role="status" className="ws-editor-loading muted">{tr('Đang mở tệp…')}</p>}
      {error && <div className="ws-editor-error">
        <p role="alert" className="error">{error}</p>
        {!ready && <button type="button" onClick={() => setLoadAttempt((n) => n + 1)}>{tr('Thử lại')}</button>}
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
      <EditorDebug file={file} editor={ready ? editor.current : null} active={active} cursor={cursor.line} />
      {format && active && (
        <StatusBarItems>
          <button type="button" className="status-item" title={tr('{errors} lỗi, {warnings} cảnh báo', { errors: errorCount, warnings: warningCount })} onClick={() => runCommand('editor.diagnostics')}>{tr('Lỗi {errors} · Cảnh báo {warnings}', { errors: errorCount, warnings: warningCount })}</button>
          <span className="status-item" title={tr('Dòng {line}, cột {column}', { line: cursor.line, column: cursor.column })}>{cursor.line}:{cursor.column}</span>
          <span className="status-item" title={tr('Ngôn ngữ')}>{format.language}</span>
          <span className="status-item" title={tr('Kiểu xuống dòng')}>{format.eol === '\r\n' ? 'CRLF' : 'LF'}</span>
          <span className="status-item" title={tr('Bảng mã')}>{format.bom ? 'UTF-8 BOM' : 'UTF-8'}</span>
          {vim && <span className="status-item vim-status" title={tr('Chế độ Vim')} ref={setVimNode} />}
        </StatusBarItems>
      )}
    </div>
  )
}
