import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FileContent, GitBlameLine, LspDocumentSymbol } from '@shared/api'
import type { AgentContextItem } from '@shared/agent-types'
import { vi, tr } from '../../strings'
import { msg, msgText, type Message } from '../../state/messages'
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
import { registerFileSaver } from '../../state/fileSaveRegistry'
import { listBookmarks, nextBookmark, subscribeBookmarks, toggleBookmark } from '../../state/bookmarks'
import './editor-tab.css'
import { largerSymbolAt, smallestSymbolAt } from '../../state/syntaxSelection'
import { useActiveEditor } from '../../state/activeEditor'
import { useDocumentSymbols } from './EditorPanels'
import { Picker } from '../layout/Picker'

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
  /** Sau khi Lưu thành: WorkspaceScreen mở path mới và đóng thẻ cũ. */
  onSavedAs?: (from: string, to: string) => void
  /** Khoá chỉ đọc do người dùng bật từ thẻ tệp; không đổi nội dung trên đĩa. */
  locked?: boolean
}

type OpenFile = { editor: EditorHandle; base: FileContent }
type Conflict = { disk: FileContent | null; detail?: string }
type EditorFormat = { language: string; eol: FileContent['eol']; bom: boolean }

const LANGUAGE_NAMES: Record<string, string> = {
  typescript: 'TypeScript', javascript: 'JavaScript',
  python: 'Python', dart: 'Dart', csharp: 'C#', json: 'JSON', yaml: 'YAML',
  markdown: 'Markdown', html: 'HTML', css: 'CSS'
}
const FUNCTION_KINDS = new Set([6, 8, 9])
const EOL_OPTIONS = [{ id: '\n', name: 'LF' }, { id: '\r\n', name: 'CRLF' }] as const
const languageOptions = () => [{ id: 'plaintext', name: tr('Văn bản thuần') }, ...Object.entries(LANGUAGE_NAMES).map(([id, name]) => ({ id, name }))]

const symbolLabel = (symbol: LspDocumentSymbol): string =>
  FUNCTION_KINDS.has(symbol.kind) && !symbol.name.endsWith('()') ? `${symbol.name}()` : symbol.name

/** Ký hiệu chứa con trỏ cùng các ký hiệu bao ngoài, theo thứ tự từ gốc tới lá. */
function symbolTrail(symbols: readonly LspDocumentSymbol[], line: number, column: number): LspDocumentSymbol[] {
  const position = { line: line - 1, character: column - 1 }
  const leaf = smallestSymbolAt(symbols, position)
  if (!leaf) return []
  const trail = [leaf]
  let parent = largerSymbolAt(symbols, leaf, position)
  while (parent) {
    trail.unshift(parent)
    parent = largerSymbolAt(symbols, parent, position)
  }
  return trail
}

function explain(e: { code?: string; message?: string }): Message {
  if (e?.code === 'file_not_found') return msg('Tệp không còn tồn tại')
  if (e?.code === 'outside_project') return msg('Tệp nằm ngoài thư mục project')
  return msg(e?.message ?? 'Không đọc được tệp')
}

/** "Tác giả, 3 ngày trước • tóm tắt" như inline blame của Wu; `summary` false thì bỏ phần tóm tắt commit. */
export function blameText(line: GitBlameLine, now = Date.now(), summary = true): string {
  if (line.uncommitted) return tr('Bạn • Chưa commit')
  const days = Math.floor((now / 1000 - line.time) / 86_400)
  const ago = days < 1 ? tr('hôm nay') : days < 30 ? tr('{days} ngày trước', { days }) : days < 365 ? tr('{months} tháng trước', { months: Math.floor(days / 30) }) : tr('{years} năm trước', { years: Math.floor(days / 365) })
  return `${line.author}, ${ago}${summary ? ` • ${line.summary}` : ''}`
}

/** Thẻ soạn thảo một tệp: nạp, sửa, lưu (Ctrl/Cmd+S) và xử lý tệp đổi trên đĩa. */
export function EditorTab({ projectId, file, line, column, lineEnd, revealRequest, onClose, onDirtyChange, onContextReady, active = true, onSplit, onOpenFile, onViewImage, onViewTable, onReadOnlyChange, onLoadError, onSavedAs, locked }: Props) {
  const host = useRef<HTMLDivElement | null>(null)
  const editor = useRef<EditorHandle | null>(null)
  const actions = useRef<{ save: () => Promise<boolean>; saveAs: (path: string) => Promise<boolean>; reload: () => void; keepMine: () => void; blur: () => void; eolChanged: () => void } | null>(null)
  const dirty = useRef(false)
  const contextCallback = useRef(onContextReady)
  contextCallback.current = onContextReady
  const openFileRef = useRef(onOpenFile)
  openFileRef.current = onOpenFile
  const readOnlyCallback = useRef(onReadOnlyChange)
  readOnlyCallback.current = onReadOnlyChange
  const loadErrorCallback = useRef(onLoadError)
  loadErrorCallback.current = onLoadError
  const savedAsCallback = useRef(onSavedAs)
  savedAsCallback.current = onSavedAs
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const lockedRef = useRef(locked === true)
  lockedRef.current = locked === true
  const [readOnly, setReadOnly] = useState<FileContent['reason'] | boolean>(false)
  const [error, setError] = useState<Message | null>(null)
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [reloading, setReloading] = useState(false)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    editor.current?.setReadOnly(locked === true || !!readOnly)
  }, [locked, readOnly, ready, file])
  const [format, setFormat] = useState<EditorFormat | null>(null)
  const formatRef = useRef<EditorFormat | null>(null)
  formatRef.current = format
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [selected, setSelected] = useState(0)
  const [modified, setModified] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const vim = useVimMode()
  const [vimNode, setVimNode] = useState<HTMLElement | null>(null)
  const blameOn = useBlame()
  const { blameDelay, blameSummary, breadcrumbs, tabSize } = useEditorPrefs()
  const [blame, setBlameLines] = useState<Map<number, GitBlameLine> | null>(null)
  const diagnostics = useDiagnostics(projectId)
  const [picker, setPicker] = useState<'eol' | 'language' | null>(null)
  const [notice, setNotice] = useState<{ text: string; seq: number } | null>(null)
  const showNotice = (text: string) => setNotice((prev) => ({ text, seq: (prev?.seq ?? 0) + 1 }))
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])
  const activeEditor = useActiveEditor()
  const symbols = useDocumentSymbols(projectId, activeEditor?.file === file ? activeEditor : null)
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
  useCommand('editor.select_line_ending', () => { if (active && ready) setPicker('eol') }, active && ready)
  useCommand('editor.select_language', () => { if (active && ready) setPicker('language') }, active && ready)

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
    let saveWaiters: { text: string; done: (ok: boolean) => void }[] = []
    const settleSave = (text: string | undefined, ok: boolean) => {
      const waiting = text === undefined ? saveWaiters.splice(0) : saveWaiters.filter((w) => w.text === text)
      if (text !== undefined) saveWaiters = saveWaiters.filter((w) => w.text !== text)
      for (const w of waiting) w.done(ok)
    }
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
      const eol = formatRef.current?.eol ?? open.base.eol
      setDirty(text !== open.base.text || eol !== open.base.eol || (writing !== undefined && text !== writing)
        || (pendingSave !== undefined && text !== pendingSave))
    }

    const updateConflict = (next: Conflict | null) => {
      diskConflict = next
      if (next) { pendingSave = undefined; settleSave(undefined, false) }
      setConflict(next)
      updateDirty()
    }

    const adopt = (current: OpenFile, disk: FileContent) => {
      pendingSave = undefined
      current.base = disk
      current.editor.setValue(disk.text)
      current.editor.setReadOnly(lockedRef.current || disk.readOnly)
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
        else if (diskConflict) updateConflict({ disk: null, detail: msgText(explain(err)) })
      }
    }

    const write = async (current: OpenFile, text: string) => {
      const b = current.base
      const eol = formatRef.current?.eol ?? b.eol
      if (diskConflict || b.readOnly || (b.text === text && eol === b.eol)) {
        updateDirty()
        settleSave(text, false)
        return
      }
      writing = text
      setSaveState('saving')
      try {
        const revision = await fs.write(projectId, file, text, { eol, bom: b.bom, expectedVersion: b.version })
        if (!alive) return
        current.base = { ...b, ...revision, text, eol }
        setError(null)
        setSaveState('saved')
        settleSave(text, true)
      } catch (e) {
        if (!alive) return
        setSaveState('idle')
        pendingSave = undefined
        if ((e as { code?: string })?.code === 'conflict') {
          setError(null)
          updateConflict({ disk: null })
          await readDisk(current)
        } else setError(msg('Không lưu được tệp'))
        settleSave(text, false)
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
        if (lockedRef.current) return Promise.resolve(false)
        const current = open
        if (!current || current.base.readOnly || diskConflict || isReloading) return Promise.resolve(false)
        const generation = ++saveGeneration
        let finish!: (ok: boolean) => void
        const result = new Promise<boolean>((resolve) => { finish = resolve })
        const queueSave = () => {
          if (!alive || lockedRef.current || generation !== saveGeneration || open !== current || current.base.readOnly || diskConflict || isReloading) { finish(false); return }
          const text = current.editor.getValue()
          const eol = formatRef.current?.eol ?? current.base.eol
          pendingSave = text === current.base.text && eol === current.base.eol && writing === undefined ? undefined : text
          updateDirty()
          if (pendingSave !== undefined) {
            saveWaiters.push({ text, done: finish })
            void flush()
          } else finish(true)
        }
        if (!formatting && getEditorPrefs().formatOnSave && current.editor.formatDocument) {
          pendingSave = undefined
          formatting = Promise.resolve().then(async () => {
            try { await current.editor.formatDocument?.() } catch { /* không có formatter vẫn lưu */ }
          }).finally(() => { formatting = null })
        }
        if (formatting) void formatting.then(queueSave)
        else queueSave()
        return result
      },
      saveAs: async (path: string) => {
        const current = open
        if (!current || !path || path === file) return false
        const text = current.editor.getValue()
        const eol = formatRef.current?.eol ?? current.base.eol
        const bom = current.base.bom
        let expectedVersion: string | null = null
        try {
          const disk = await fs.read(projectId, path)
          if (disk.readOnly) { if (alive) setError(msg('Tệp chỉ đọc nên không lưu được')); return false }
          if (!window.confirm(tr('Tệp {path} đã tồn tại. Ghi đè?', { path }))) return false
          expectedVersion = disk.version
        } catch (e) {
          if ((e as { code?: string })?.code !== 'file_not_found') {
            if (alive) setError(explain(e as { code?: string; message?: string }))
            return false
          }
        }
        try {
          await fs.write(projectId, path, text, { eol, bom, expectedVersion })
          if (!alive) return false
          savedAsCallback.current?.(file, path)
          return true
        } catch (e) {
          if (alive) setError((e as { code?: string })?.code === 'conflict' ? msg('Tệp đã thay đổi trong khi đổi tên. Hãy thử lại.') : msg('Không lưu được tệp'))
          return false
        }
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
      blur: () => autoSave.blur(),
      eolChanged: () => { updateDirty(); autoSave.change() }
    }
    const autoSave = createAutoSave(() => actions.current?.save(),
      () => !!(alive && open && !lockedRef.current && dirty.current && !open.base.readOnly && !diskConflict && !isReloading), getEditorPrefs)
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
    const offSaver = registerFileSaver(projectId, file, {
      save: () => actions.current?.save() ?? Promise.resolve(false),
      saveAs: async () => setSaveAsOpen(true)
    })
    fs.read(projectId, file).then((c) => {
      if (!alive || !host.current) return
      const ed = createEditor(host.current, { value: c.text, language, readOnly: lockedRef.current || c.readOnly, path: file, projectId, onOpenFile: (target, at, col) => openFileRef.current?.(target, at, col) })
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
      const refreshSelection = () => setSelected(ed.getSelection?.()?.text.length ?? 0)
      ed.onCursor?.((line, column) => setCursor({ line, column }))
      ed.onSelection?.(refreshSelection)
      ed.onGutterClick?.((at) => toggleBreakpoint(file, at))
      if (column !== undefined && ed.revealPosition) ed.revealPosition(line, column)
      else ed.revealLines(line, lineEnd)
      refreshSelection()
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
    }).catch((e) => { if (alive) { const message = explain(e); setError(message); loadErrorCallback.current?.(file, msgText(message)) } })
    return () => {
      alive = false
      clearTimeout(lspTimer)
      off()
      autoSave.dispose()
      offPrefs()
      document.removeEventListener('focusout', onFocusOut)
      actions.current = null
      offSaver()
      settleSave(undefined, false)
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
  const crumbPosition = editor.current?.getPosition?.() ?? cursor
  const trail = breadcrumbs && ready ? symbolTrail(symbols.symbols, crumbPosition.line, crumbPosition.column) : []

  return (
    <div className="code-viewer editor-tab" style={active ? undefined : { display: 'none' }}>
      <header className="code-head">
        {breadcrumbs && <ol className="editor-path mono" aria-label={tr('Đường dẫn tệp {file}', { file })} title={file}>
          {visiblePath.map((segment, index) => (
            <li key={`path-${index}`} aria-current={!trail.length && index === visiblePath.length - 1 ? 'true' : undefined}>
              {index > 0 && <Icon name="chevron" size={12} />}
              {index === visiblePath.length - 1 && <FileTypeIcon name={file} size={14} />}
              <span>{segment}</span>
            </li>
          ))}
          {trail.map((symbol, index) => (
            <li key={`symbol-${index}`} aria-current={index === trail.length - 1 ? 'true' : undefined}>
              <Icon name="chevron" size={12} />
              <span>{symbolLabel(symbol)}</span>
            </li>
          ))}
        </ol>}
        <span className="ws-editor-actions">
          {onViewImage && <button type="button" onClick={onViewImage} title={tr('Xem ảnh SVG')}>{tr('Xem ảnh')}</button>}
          {onViewTable && <button type="button" disabled={!ready} onClick={onViewTable} title={tr('Xem CSV/TSV dạng bảng')}>{tr('Xem bảng')}</button>}
          {saveLabel && <span role="status" className="ws-save-state" data-state={saveState}>{saveLabel}</span>}
          <button type="button" className="ws-icon-button" disabled={!ready} aria-pressed={bookmarked}
            aria-label={bookmarked ? tr('Bỏ đánh dấu dòng') : tr('Đánh dấu dòng')}
            title={bookmarked ? tr('Bỏ đánh dấu dòng') : tr('Đánh dấu dòng')} onClick={toggleAtCursor}>
            <Icon name="bookmark" size={15} />
          </button>
          <button type="button" className="ws-icon-button" disabled={!ready || locked === true || !!readOnly || !modified || !!conflict} onClick={() => actions.current?.save()}
            aria-label={tr('Lưu')} title={tr('Lưu (Ctrl/Cmd+S)')}><Icon name="save" size={15} /></button>
          {onSplit && <button type="button" className="ws-icon-button" disabled={!ready} aria-label={tr('Chia đôi sang phải')} title={tr('Chia đôi sang phải (⌘\\)')} onClick={onSplit}><Icon name="panelRight" size={15} /></button>}
          <button type="button" className="ws-icon-button" aria-label={vi.editor.close} title={vi.editor.close} onClick={onClose}><Icon name="close" size={15} /></button>
        </span>
      </header>
      {!ready && !error && <p role="status" className="ws-editor-loading muted">{tr('Đang mở tệp…')}</p>}
      {error && <div className="ws-editor-error">
        <p role="alert" className="error">{msgText(error)}</p>
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
      {notice && <p role="status" className="stale-banner">{notice.text}{' '}
        <button type="button" aria-label={tr('Đóng thông báo')} title={tr('Đóng thông báo')} onClick={() => setNotice(null)}>×</button>
      </p>}
      <div ref={host} className="editor-host" />
      <EditorDebug file={file} editor={ready ? editor.current : null} active={active} cursor={cursor.line} />
      {format && active && (
        <StatusBarItems>
          <button type="button" data-status-id="diagnostics" className="status-item" title={tr('{errors} lỗi, {warnings} cảnh báo', { errors: errorCount, warnings: warningCount })} onClick={() => runCommand('editor.diagnostics')}>{tr('Lỗi {errors} · Cảnh báo {warnings}', { errors: errorCount, warnings: warningCount })}</button>
          {problems.length > 0 && <button type="button" data-status-id="diagnosticsDetail" className="status-item" title={problems[0].message}>{problems[0].message}</button>}
          <button type="button" data-status-id="cursor" className="status-item" title={tr('Đi đến dòng')} onClick={() => runCommand('editor.goto_line')}>{cursor.line}:{cursor.column}</button>
          {selected > 0 && <button type="button" data-status-id="selection" className="status-item">{tr('Đã chọn {n}', { n: selected })}</button>}
          <button type="button" data-status-id="language" className="status-item" title={tr('Ngôn ngữ')} onClick={() => setPicker('language')}>{format.language}</button>
          <button type="button" data-status-id="eol" className="status-item" title={tr('Kiểu xuống dòng')} onClick={() => setPicker('eol')}>{format.eol === '\r\n' ? 'CRLF' : 'LF'}</button>
          <button type="button" data-status-id="encoding" className="status-item" title={tr('Bảng mã')} onClick={() => showNotice(tr('Không đổi được bảng mã: engine chỉ lưu UTF-8 và giữ nguyên BOM theo tệp trên đĩa.'))}>{format.bom ? 'UTF-8 BOM' : 'UTF-8'}</button>
          <button type="button" data-status-id="indentation" className="status-item">{tr('Thụt lề: {n}', { n: tabSize })}</button>
          {vim && <span data-status-id="vim" className="status-item vim-status" title={tr('Chế độ Vim')} ref={setVimNode} />}
        </StatusBarItems>
      )}
      {picker === 'eol' && <Picker label={tr('Kiểu xuống dòng')} placeholder={tr('Chọn kiểu xuống dòng')} items={EOL_OPTIONS}
        itemKey={(item) => item.id} itemText={(item) => item.name} initialKey={editor.current?.getEOL?.()}
        empty={tr('Không có tuỳ chọn')} onCancel={() => setPicker(null)}
        onPick={(item) => {
          editor.current?.setEOL?.(item.id)
          // Cập nhật ref ngay: Save/autoSave đọc EOL ở đây trước khi React kịp render lại.
          const next = format && { ...format, eol: item.id }
          formatRef.current = next
          setFormat(next)
          actions.current?.eolChanged()
          setPicker(null)
        }} renderItem={(item) => <span>{item.name}</span>} />}
      {picker === 'language' && <Picker label={tr('Ngôn ngữ')} placeholder={tr('Chọn ngôn ngữ…')} items={languageOptions()}
        itemKey={(item) => item.id} itemText={(item) => item.name} initialKey={editor.current?.getLanguage?.()}
        empty={tr('Không có ngôn ngữ')} onCancel={() => setPicker(null)}
        onPick={(item) => {
          editor.current?.setLanguage?.(item.id)
          setFormat((old) => old ? { ...old, language: item.name } : old)
          setPicker(null)
        }} renderItem={(item) => <span>{item.name}</span>} />}
      {saveAsOpen && createPortal(<Picker label={tr('Lưu thành…')} placeholder={tr('Đường dẫn tệp mới')} items={[] as string[]}
        itemKey={(item) => item} itemText={(item) => item}
        filter={(_items, query) => {
          const path = query.trim()
          return path && !/^(?:\/|[A-Za-z]:)/.test(path) && !/[\\\x00-\x1f]/.test(path)
            && path.split('/').every((part) => part && part !== '.' && part !== '..') ? [{ item: path, positions: [] }] : []
        }}
        empty={tr('Nhập đường dẫn tệp tương đối.')} onCancel={() => setSaveAsOpen(false)}
        onPick={(path) => { setSaveAsOpen(false); void actions.current?.saveAs(path) }}
        renderItem={(path) => <><Icon name="save" size={16} /><span>{tr('Lưu thành {path}', { path })}</span></>} />, document.body)}
    </div>
  )
}
