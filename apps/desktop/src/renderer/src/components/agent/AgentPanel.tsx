import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { consentTargetForSettings, sameConsentTarget, type AiConsentTarget, type AgentMode, type ApprovalRequest, type AgentContextItem, type FileApprovalRequest, type ModelInfo } from '@shared/agent-types'
import type { AiSettings, Citation, GraphEdge, GraphNode } from '@shared/graph-types'
import { vi } from '../../strings'
import { Icon } from '../common/icons'
import { PopoverMenu, type MenuItem } from '../common/PopoverMenu'
import { FileTypeIcon } from '../common/FileTypeIcon'
import { rankFiles } from '../layout/FileFinder'
import { runCommand } from '../../state/commands'
import { completionToken, filterSlashCommands, imageError, removeQueued, replaceQueued, takeQueued } from './composer'
import { ApprovalCard } from './ApprovalCard'
import { CitationText } from '../chat/CitationText'
import { ConsentDialog } from '../chat/ConsentDialog'
import { ConnectionDialog } from './ConnectionDialog'
import { useAgentWorkbench, type AgentInspection } from './useAgentWorkbench'
import { WorkbenchHistory, WorkbenchSettings, WorkbenchStatus, workbenchUsage } from './WorkbenchControls'
import { AnswerRating } from './AnswerRating'
import './agent-panel.css'
import { matchProfile, useAgentProfiles, type AgentProfile } from '../../state/agentProfiles'
import { ContextRing } from './ContextRing'
import { SavedPrompts } from './SavedPrompts'
import { announceAgent } from '../../state/agentNotify'

interface Props {
  id?: string
  projectId: string
  projectName?: string
  hidden?: boolean
  activeFile?: FileContext
  getEditorContext?: () => AgentContextItem | null
  graphContext?: AgentContextItem
  beforePrompt?: () => Promise<void>
  onInspect?: (inspection: AgentInspection) => void
  onClose?: () => void
  onConnectOpenCode?: () => void
  onOpenCode: (file: string, line: number, lineEnd?: number) => void
  onHighlight: (nodes: GraphNode[], edges: GraphEdge[], notice: string | null) => void
  onOpenSettings: () => void
  /** Khung đang nằm bên nào; có thì menu ⋯ hiện mục chuyển sang bên kia. */
  dock?: 'left' | 'right'
  onToggleDock?: () => void
}

type FileContext = { file: string; line: number; lineEnd?: number }
type Msg = { id: number | string; role: 'user'; content: string; context?: FileContext } | { id: number | string; role: 'assistant'; content: string; citations: Citation[]; tools: string[] }
type ImageAttachment = { id: number; name: string; mimeType: string; dataUrl: string }
type ComposerDraft = { text: string; context?: FileContext; attachments: AgentContextItem[]; images: ImageAttachment[] }
type QueuedPrompt = ComposerDraft & { id: number; target: AiConsentTarget; model: string; sessionId: string | null }
type PendingConsent = { question: string; target: AiConsentTarget; model: string; context?: FileContext; attachments?: AgentContextItem[]; images?: ImageAttachment[]; queued?: QueuedPrompt }

const NO_CITATIONS: Citation[] = []

const slashCommands = [
  { name: 'new', detail: 'Tạo phiên mới' },
  { name: 'model', detail: 'Chọn model' },
  { name: 'resume', detail: 'Mở lịch sử trò chuyện' },
  { name: 'clear', detail: 'Bắt đầu phiên mới' },
  { name: 'stop', detail: 'Dừng trợ lý' },
  { name: 'login', detail: 'Kết nối AI' },
  { name: 'settings', detail: 'Mở cài đặt' },
  { name: 'files', detail: 'Mở cây tệp' },
  { name: 'terminal', detail: 'Mở terminal' },
  { name: 'diff', detail: 'Mở thay đổi' },
  { name: 'saved', detail: 'Tin nhắn đã lưu' }
]

/** Câu hỏi của lượt mà câu trả lời thứ `i` thuộc về. */
function questionBefore(msgs: Msg[], i: number): string {
  for (let j = i - 1; j >= 0; j--) if (msgs[j].role === 'user') return msgs[j].content
  return ''
}

function fileReference(context: FileContext): string {
  const { file, line, lineEnd } = context
  if (lineEnd && lineEnd > line) return `${file}:${line}-${lineEnd}`
  return line > 1 ? `${file}:${line}` : file
}

function targetOf(settings: AiSettings): AiConsentTarget | null {
  return consentTargetForSettings(settings)
}

function connectionLabel(settings: AiSettings | null): string {
  return settings?.runtime === 'antigravity-cli' ? `${settings.model === 'auto' || settings.model.toLowerCase().startsWith('gemini') ? 'Gemini' : 'Antigravity'} · Tài khoản Google` : settings?.provider === 'google' ? 'Gemini · API key'
    : settings?.provider === 'ollama-local' ? 'Ollama · Trên máy' : settings?.provider === 'openai' ? 'ChatGPT / OpenAI'
      : settings?.provider === 'openai-codex' ? 'Codex · ChatGPT' : settings?.provider === 'anthropic' ? 'Claude · API key'
        : settings?.provider === 'openrouter' ? 'OpenRouter · API key' : settings?.provider ?? 'Chưa có kết nối'
}

function errorCode(e: unknown): string {
  return e && typeof e === 'object' && 'code' in e ? String(e.code) : ''
}

function errorMessage(e: unknown): string {
  return vi.chat.errors[errorCode(e)] || (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e))
}

function isFileApproval(value: unknown): value is FileApprovalRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<FileApprovalRequest>
  return (request.tool === 'edit' || request.tool === 'write')
    && typeof request.id === 'string' && request.id.trim() !== ''
    && typeof request.path === 'string' && request.path.trim() !== ''
    && typeof request.before === 'string' && typeof request.after === 'string'
}

function isApproval(value: unknown): value is ApprovalRequest {
  if (isFileApproval(value)) return true
  const request = value as Partial<Extract<ApprovalRequest, { tool: 'command' }>> | null
  return !!request && request.tool === 'command' && typeof request.id === 'string' && !!request.id
    && typeof request.executable === 'string' && Array.isArray(request.args) && request.args.every((arg) => typeof arg === 'string')
    && typeof request.cwd === 'string' && Number.isFinite(request.timeoutMs)
}

const contextLabel = (item: AgentContextItem): string => item.kind === 'file'
  ? `${item.file}${item.start ? `:${item.start}${item.end && item.end !== item.start ? `-${item.end}` : ''}` : ''}${item.dirty ? ' · bản nháp' : ''}`
  : item.label ?? (item.kind === 'node' ? item.nodeId : item.kind === 'flow' ? `Luồng ${item.flowId}` : item.blockId)

export function AgentPanel(props: Props) {
  return <ProjectAgentPanel key={props.projectId} {...props} />
}

function ProjectAgentPanel({ id, projectId, projectName = projectId, hidden, activeFile, getEditorContext, graphContext, beforePrompt, onInspect, onClose, onConnectOpenCode, onOpenCode, onHighlight, onOpenSettings, dock, onToggleDock }: Props) {
  const [view, setView] = useState<'chat' | 'history' | 'settings'>('chat')
  const [cfg, setCfg] = useState<AiSettings | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [fileContext, setFileContext] = useState<FileContext>()
  const [attachments, setAttachments] = useState<AgentContextItem[]>([])
  const [images, setImages] = useState<ImageAttachment[]>([])
  const [queue, setQueue] = useState<QueuedPrompt[]>([])
  const [editingQueue, setEditingQueue] = useState<{ id: number; draft: ComposerDraft } | null>(null)
  const [stopping, setStopping] = useState(false)
  const [stagingImages, setStagingImages] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [focused, setFocused] = useState(false)
  const [dismissedCompletion, setDismissedCompletion] = useState('')
  const [completionIndex, setCompletionIndex] = useState(0)
  const [projectFiles, setProjectFiles] = useState<string[] | null>(null)
  const [fileListError, setFileListError] = useState('')
  const [queueWake, setQueueWake] = useState(0)
  const [connect, setConnect] = useState(false)
  const [savedOpen, setSavedOpen] = useState(false)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [tool, setTool] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [consent, setConsent] = useState<PendingConsent | null>(null)
  const [checking, setChecking] = useState(false)
  const [openTools, setOpenTools] = useState<number | string | null>(null)
  const [draft, setDraft] = useState('') // chữ đang chảy về của lượt hiện tại
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([])
  const [mode, setMode] = useState<AgentMode | null>(null)
  const [changingMode, setChangingMode] = useState(true)
  // Hồ sơ trợ lý: tool đang bị tắt cho dự án (main giữ), để biết hồ sơ tự tạo nào đang dùng.
  const profiles = useAgentProfiles()
  const [disabledTools, setDisabledToolsState] = useState<string[]>([])
  useEffect(() => {
    let live = true
    window.nexgraph.agent.getDisabledTools?.(projectId).then((tools) => { if (live) setDisabledToolsState(tools) }).catch(() => {})
    return () => { live = false }
  }, [projectId])
  const modeRef = useRef<AgentMode | null>(null)
  const modePending = useRef(true)
  const turn = useRef<{ id: number; q: string; context?: FileContext; attachments: AgentContextItem[]; images: ImageAttachment[]; target: AiConsentTarget; model: string; sessionId: string | null; tools: string[]; mode: AgentMode; cancelled?: boolean; completed?: boolean } | null>(null)
  const turnSeq = useRef(0)
  const imageSeq = useRef(0)
  const queueSeq = useRef(0)
  const queueRef = useRef<QueuedPrompt[]>([])
  const queueReady = useRef(false)
  const activeRun = useRef<Promise<void> | null>(null)
  const composerRef = useRef<ComposerDraft>({ text: '', attachments: [], images: [] })
  composerRef.current = { text, context: fileContext, attachments, images }
  const failedTurns = useRef(new Set<number>())
  const editWarned = useRef(false) // lần đầu sang Sửa giải thích việc duyệt từng tệp
  const mounted = useRef(true)
  const projectGeneration = useRef(0)
  const visible = useRef(!hidden)
  visible.current = !hidden
  const alertTitle = useRef(projectName) // tên hội thoại cho thông báo hệ thống, cập nhật mỗi lần render
  const scope = useRef<AiConsentTarget | null>(null)
  const operation = useRef<number | null>(null)
  const operationSeq = useRef(0)
  const messages = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const modelSelect = useRef<HTMLSelectElement>(null)
  const followMessages = useRef(true)
  const work = useAgentWorkbench(projectId, (snapshot) => {
    if (turn.current || operation.current !== null) return
    setMsgs(snapshot.messages.map((message) => message.role === 'user'
      ? { id: message.id, role: 'user', content: message.text }
      : { id: message.id, role: 'assistant', content: message.text, citations: message.citations, tools: message.tools.map((tool) => tool.name) }))
    setApprovals([])
    setOpenTools(null)
    modeRef.current = snapshot.mode
    setMode(snapshot.mode)
    if (snapshot.mode === 'edit') editWarned.current = true
  })
  const sessionIdRef = useRef(work.sessionId)
  const activeTarget = targetOf(cfg ?? { baseUrl: '', model: '', hasKey: false })
  const sessionQueue = queue.filter((item) => item.sessionId === work.sessionId && sameConsentTarget(item.target, activeTarget))
  useEffect(() => { sessionIdRef.current = work.sessionId }, [work.sessionId])

  const setComposer = (value: ComposerDraft) => {
    composerRef.current = value
    setText(value.text)
    setFileContext(value.context)
    setAttachments(value.attachments)
    setImages(value.images)
    setCursor(value.text.length)
  }
  const updateQueue = (update: (current: QueuedPrompt[]) => QueuedPrompt[]) => {
    queueRef.current = update(queueRef.current)
    setQueue(queueRef.current)
  }
  const queuePrompt = (value: ComposerDraft, target: AiConsentTarget, model: string, sessionId: string | null): QueuedPrompt =>
    ({ ...value, id: ++queueSeq.current, target, model, sessionId })

  useEffect(() => {
    if (hidden || !followMessages.current || !messages.current) return
    messages.current.scrollTop = messages.current.scrollHeight
  }, [hidden, msgs, draft, busy])

  const applySettings = (settings: AiSettings) => {
    const target = targetOf(settings)
    if (scope.current && !sameConsentTarget(scope.current, target)) {
      if (editingQueue) { setComposer(editingQueue.draft); setEditingQueue(null) }
      queueReady.current = false
      work.invalidate()
      setMsgs([])
      setApprovals([])
      setOpenTools(null)
      failedTurns.current.clear()
      void work.restore().catch((e) => { if (mounted.current) setError(errorMessage(e)) })
    }
    scope.current = target
    setCfg(settings)
    return target
  }

  const end = () => {
    turn.current = null
    setApprovals([])
    setBusy(false)
    setTool(null)
    setDraft('')
  }
  const fail = (q: string, message: string) => {
    const current = turn.current
    const id = current?.id ?? ++turnSeq.current
    if (failedTurns.current.has(id)) return
    failedTurns.current.add(id)
    const continueQueue = !!current && sameConsentTarget(scope.current, current.target) && !!queueRef.current.some((item) => item.sessionId === current.sessionId && sameConsentTarget(item.target, current.target))
    if (current) current.completed = continueQueue
    setMsgs((cur) => [...cur, { id, role: 'assistant', content: message, citations: [], tools: [] }])
    if (current) {
      const failed = { text: q, context: current.context, attachments: current.attachments, images: current.images }
      const composing = composerRef.current
      if (continueQueue && !composing.text.trim() && !composing.context && !composing.attachments.length && !composing.images.length) setComposer(failed)
      else if (continueQueue || composing.text.trim() || composing.context || composing.attachments.length || composing.images.length)
        updateQueue((items) => [...items, queuePrompt(failed, current.target, current.model, current.sessionId)])
      else setComposer(failed)
    }
    setError(message)
    end()
  }

  useEffect(() => {
    projectGeneration.current++
    let alive = true
    let read = 0
    mounted.current = true
    const refresh = () => {
      if (operation.current !== null || turn.current) return
      const which = ++read
      const beforeSubmit = operationSeq.current
      const stillCurrent = () => alive && which === read && beforeSubmit === operationSeq.current && !turn.current
      void window.nexgraph.ai.getSettings().then((s) => {
        if (stillCurrent()) applySettings(s)
      }).catch((e) => {
        if (!stillCurrent()) return
        applySettings({ baseUrl: '', model: '', hasKey: false })
        setError(errorMessage(e))
      })
    }
    refresh()
    void window.nexgraph.auth.models().then((items) => { if (alive) setModels(items) }).catch(() => {})
    window.addEventListener('focus', refresh)
    window.nexgraph.agent.getMode(projectId).then((m) => {
      if (!alive) return
      if (m === 'edit') editWarned.current = true // phiên đã ở Sửa từ trước thì không hỏi lại
      modeRef.current = m
      setMode(m)
    }).catch(() => {
      if (alive) setError(vi.agent.modeFailed)
    }).finally(() => {
      if (!alive) return
      modePending.current = false
      setChangingMode(false)
    })
    const off = window.nexgraph.agent.onEvent((pid, e) => {
      const t = turn.current
      if (!mounted.current || pid !== projectId) return
      if (e.type === 'approval') {
        const { request } = e
        if (t?.mode !== 'edit' || modeRef.current !== 'edit' || modePending.current || !isApproval(request)) return
        setApprovals((cur) => (cur.some((a) => a.id === request.id) ? cur : [...cur, request]))
        announceAgent('approval', alertTitle.current)
        return
      }
      if (e.type === 'approval_closed') {
        setApprovals((cur) => cur.filter((a) => a.id !== e.id)) // id lạ không có gì để gỡ
        return
      }
      if (e.type === 'session' && t && t.sessionId === null) {
        t.sessionId = e.sessionId
        sessionIdRef.current = e.sessionId
        updateQueue((items) => items.map((item) => item.sessionId === null && sameConsentTarget(item.target, t.target) ? { ...item, sessionId: e.sessionId } : item))
        return
      }
      if (!t) return
      if (t.cancelled) {
        if (e.type === 'done' || e.type === 'error') end()
        return
      }
      if (e.type === 'write_conflict') {
        if (t.mode === 'edit') setError(e.message)
        return
      }
      if (e.type === 'tool' && e.status === 'start') {
        t.tools.push(e.name)
        setTool(e.name)
      } else if (e.type === 'text') setDraft((d) => d + e.delta)
      else if (e.type === 'done') {
        t.completed = true
        setMsgs((cur) => [...cur, { id: t.id, role: 'assistant', content: e.text, citations: e.citations, tools: t.tools }])
        end()
        announceAgent('done', alertTitle.current)
      } else if (e.type === 'error') {
        if (e.code !== 'ai_cancelled') announceAgent('error', alertTitle.current)
        fail(t.q, vi.chat.errors[e.code] || e.message)
      }
    })
    return () => {
      alive = false
      projectGeneration.current++
      mounted.current = false
      operation.current = null
      if (turn.current) void window.nexgraph.agent.abort(projectId)
      turn.current = null
      window.removeEventListener('focus', refresh)
      off()
    }
  }, [projectId])

  useEffect(() => {
    if (!hidden) return
    if (consent?.queued) updateQueue((items) => [consent.queued!, ...items])
    operation.current = null
    setConsent(null)
    setChecking(false)
  }, [hidden])

  const configured = !!cfg && !!targetOf(cfg)
  const availableModels = models.filter((model) => cfg?.runtime === 'antigravity-cli'
    ? model.runtime === 'antigravity-cli' || model.provider === 'google-antigravity' : model.provider === cfg?.provider && model.runtime !== 'antigravity-cli')
  const toolsUnavailable = models.find((model) => model.provider === cfg?.provider && model.id === cfg?.model)?.supportsTools === false

  const isCurrent = (id: number) => mounted.current && visible.current && operation.current === id
  const begin = () => {
    if (!visible.current || operation.current !== null || turn.current || activeRun.current || modePending.current || !modeRef.current || work.pending || work.loading || (modeRef.current === 'edit' && toolsUnavailable)) return null
    const id = ++operationSeq.current
    work.invalidate()
    operation.current = id
    setChecking(true)
    setError(null)
    return id
  }

  const finish = (id: number) => {
    if (!isCurrent(id)) return
    operation.current = null
    setChecking(false)
  }

  const pickMode = async (m: AgentMode) => {
    if (m === modeRef.current || modePending.current || operation.current !== null || consent || !visible.current || work.pending || work.loading) return
    if (m === 'edit' && turn.current) return
    if (m === 'edit' && !editWarned.current) {
      if (!window.confirm(vi.agent.editWarn)) return
      editWarned.current = true
    }
    modePending.current = true
    setChangingMode(true)
    setError(null)
    try {
      await window.nexgraph.agent.setMode(projectId, m)
      if (!mounted.current) return
      modeRef.current = m
      setMode(m)
      if (m !== 'edit') setApprovals([])
    } catch {
      if (!mounted.current) return
      modeRef.current = null
      setMode(null)
      setApprovals([])
      setError(vi.agent.modeFailed)
    } finally {
      modePending.current = false
      if (mounted.current) setChangingMode(false)
    }
  }

  const activeProfile = matchProfile(profiles, mode, disabledTools)
  const applyTools = async (tools: string[]) => {
    if (!window.nexgraph.agent.setDisabledTools || (tools.length === 0 && disabledTools.length === 0)) return
    await window.nexgraph.agent.setDisabledTools(projectId, tools)
    if (mounted.current) setDisabledToolsState(tools)
  }
  /** Ba chế độ là ba hồ sơ dựng sẵn (bật đủ tool của chế độ); hồ sơ tự tạo đổi chế độ và tắt bớt tool. */
  const pickProfile = async (profile: AgentProfile | null, m: AgentMode) => {
    try {
      await applyTools(profile?.disabledTools ?? [])
    } catch {
      setError(vi.agent.modeFailed)
      return
    }
    await pickMode(m)
  }

  const run = (value: ComposerDraft, target: AiConsentTarget, model: string, clearComposer: boolean) => {
    const mode = modeRef.current
    if (!mode) return
    const question = value.text.trim() || (value.images.length ? 'Hãy xem hình ảnh đính kèm.' : 'Hãy xem ngữ cảnh đính kèm.')
    const id = ++turnSeq.current
    const current = { id, q: question, context: value.context, attachments: value.attachments, images: value.images, target, model, sessionId: work.sessionId, tools: [] as string[], mode, cancelled: false, completed: false }
    turn.current = current
    followMessages.current = true
    setMsgs((cur) => [...cur, { id, role: 'user', content: question, context: value.context }])
    if (clearComposer) setComposer({ text: '', attachments: [], images: [] })
    setError(null)
    setBusy(true)
    setTool(null)
    setDraft('')
    const task = (async () => {
      try {
        await beforePrompt?.()
        if (!mounted.current || turn.current !== current || current.cancelled) return
        const prompt = value.context ? `${question}\n\n${vi.chat.filePrompt(fileReference(value.context))}` : question
        const imagePayload = value.images.map((image) => ({ mimeType: image.mimeType, data: image.dataUrl.slice(image.dataUrl.indexOf(',') + 1) }))
        if (value.attachments.length || imagePayload.length) await window.nexgraph.agent.prompt(projectId, prompt, target, {
          ...(value.attachments.length ? { context: value.attachments } : {}),
          ...(imagePayload.length ? { images: imagePayload } : {})
        })
        else await window.nexgraph.agent.prompt(projectId, prompt, target)
      } catch (e) {
        if (!mounted.current || turn.current !== current || current.cancelled) return
        if (errorCode(e) === 'ai_provider_changed') setMsgs((cur) => cur.filter((m) => m.id !== id))
        fail(question, errorMessage(e))
      }
    })()
    activeRun.current = task
    void task.finally(() => {
      if (activeRun.current !== task) return
      activeRun.current = null
      if (!mounted.current) return
      if (turn.current === current && current.cancelled) end()
      if (current.completed && !current.cancelled) queueReady.current = true
      setQueueWake((count) => count + 1)
    })
  }

  const sendDraft = async (value: ComposerDraft, queued?: QueuedPrompt) => {
    const id = begin()
    if (id === null) {
      if (queued) updateQueue((items) => [queued, ...items])
      return
    }
    try {
      const settings = await window.nexgraph.ai.getSettings()
      if (!isCurrent(id)) {
        if (queued && mounted.current) updateQueue((items) => [queued, ...items])
        return
      }
      const selected = targetOf(settings)
      if (queued && (!sameConsentTarget(selected, queued.target) || settings.model !== queued.model || queued.sessionId !== sessionIdRef.current))
        throw new Error('Phiên hoặc model đã thay đổi. Hãy kiểm tra tin trong hàng đợi trước khi gửi.')
      const target = applySettings(settings)
      if (!target) throw new Error(vi.chat.notConfigured)
      const allowed = await window.nexgraph.ai.hasConsent(projectId, target)
      if (!isCurrent(id)) {
        if (queued && mounted.current) updateQueue((items) => [queued, ...items])
        return
      }
      if (queued && queued.sessionId !== sessionIdRef.current) throw new Error('Phiên đã thay đổi. Hãy kiểm tra tin trong hàng đợi trước khi gửi.')
      if (allowed) run(value, target, settings.model, !queued)
      else setConsent({ question: value.text, target, model: settings.model, context: value.context, attachments: value.attachments, images: value.images, queued })
    } catch (e) {
      if (isCurrent(id)) {
        if (queued) updateQueue((items) => [queued, ...items])
        setError(errorMessage(e))
      }
    } finally {
      finish(id)
    }
  }

  const submit = async () => {
    const value = composerRef.current
    if (consent || operation.current !== null || !visible.current || stopping || stagingImages) return
    if (!value.text.trim() && !value.context && !value.attachments.length && !value.images.length) return
    if (editingQueue) {
      if (queueRef.current.some((item) => item.id === editingQueue.id)) updateQueue((items) => replaceQueued(items, editingQueue.id, { ...items.find((item) => item.id === editingQueue.id)!, ...value, id: editingQueue.id }))
      setComposer(editingQueue.draft)
      setEditingQueue(null)
      setQueueWake((count) => count + 1)
      return
    }
    const command = value.text.trim().match(/^\/([\w-]+)$/)?.[1]
    if (!value.attachments.length && !value.images.length && !value.context && command && slashCommands.some((item) => item.name === command)) {
      executeSlash(command)
      return
    }
    const selectedModel = models.find((model) => model.provider === cfg?.provider && model.id === cfg?.model)
    if (value.images.length && selectedModel?.supportsImages === false) { setError('Model hiện tại không nhận ảnh. Hãy đổi sang model hỗ trợ hình ảnh.'); return }
    if (value.images.some((image) => cfg?.runtime === 'antigravity-cli') && !window.confirm('Gemini có thể không nhận ảnh trong phiên bản CLI này. Nếu không hỗ trợ, lượt gửi sẽ báo lỗi rõ ràng. Tiếp tục?')) return
    if (busy || activeRun.current || queueRef.current.some((item) => item.sessionId === work.sessionId && sameConsentTarget(item.target, scope.current))) {
      const target = scope.current
      if (!target || !cfg?.model) { setError(vi.chat.notConfigured); return }
      updateQueue((items) => [...items, queuePrompt(value, target, cfg.model, turn.current?.sessionId ?? sessionIdRef.current)])
      setComposer({ text: '', attachments: [], images: [] })
      if (!busy && !activeRun.current) { queueReady.current = true; setQueueWake((count) => count + 1) }
      return
    }
    await sendDraft(value)
  }

  const confirmConsent = async (pending: PendingConsent) => {
    const id = begin()
    if (id === null) return
    setConsent(null)
    try {
      const settings = await window.nexgraph.ai.getSettings()
      if (!isCurrent(id)) { if (pending.queued && mounted.current) updateQueue((items) => [pending.queued!, ...items]); return }
      const current = applySettings(settings)
      if (pending.queued && pending.queued.sessionId !== sessionIdRef.current) throw new Error('Phiên đã thay đổi. Hãy kiểm tra lại tin trong hàng đợi.')
      if (!sameConsentTarget(current, pending.target) || settings.model !== pending.model)
        throw new Error(vi.chat.errors.ai_provider_changed)
      await window.nexgraph.ai.grantConsent(projectId, pending.target)
      if (pending.queued && pending.queued.sessionId !== sessionIdRef.current) throw new Error('Phiên đã thay đổi. Hãy kiểm tra lại tin trong hàng đợi.')
      if (isCurrent(id)) run({ text: pending.question, context: pending.context, attachments: pending.attachments ?? [], images: pending.images ?? [] }, pending.target, pending.model, !pending.queued)
      else if (pending.queued && mounted.current) updateQueue((items) => [pending.queued!, ...items])
    } catch (e) {
      if (isCurrent(id)) {
        if (pending.queued) updateQueue((items) => [pending.queued!, ...items])
        setError(errorMessage(e))
      }
    } finally {
      finish(id)
    }
  }

  useEffect(() => {
    if (!editingQueue) return
    const item = queueRef.current.find((entry) => entry.id === editingQueue.id)
    if (item && (item.sessionId !== work.sessionId || !sameConsentTarget(item.target, activeTarget))) {
      setComposer(editingQueue.draft)
      setEditingQueue(null)
    }
  }, [editingQueue, work.sessionId, cfg])
  useEffect(() => {
    if (!queueReady.current || busy || activeRun.current || operation.current !== null || checking || stopping || consent || hidden || work.pending || work.loading) return
    const next = takeQueued(queueRef.current.filter((item) => item.sessionId === work.sessionId && sameConsentTarget(item.target, scope.current)), editingQueue?.id)
    if (!next) { queueReady.current = false; return }
    queueReady.current = false
    updateQueue((items) => removeQueued(items, next.item.id))
    void sendDraft(next.item, next.item)
  }, [queue, queueWake, busy, checking, stopping, consent, hidden, work.pending, work.loading, work.sessionId, editingQueue])

  const highlight = async (citations: Citation[]) => {
    const seen = new Set<string>()
    const ids: string[] = []
    for (const c of citations.filter((x) => x.valid)) {
      try {
        const { node } = await window.nexgraph.graph.locate(projectId, c.file, c.start)
        if (!seen.has(node.id)) { seen.add(node.id); ids.push(node.id) }
      } catch { /* trích dẫn không định vị được thì bỏ qua */ }
    }
    if (ids.length < 2) return onHighlight([], [], vi.chat.highlightNone)
    try {
      const r = await window.nexgraph.graph.paths(projectId, ids.slice(0, 10))
      const linked = r.unconnected.length === 0
      onHighlight(r.nodes, linked ? r.edges : [], linked ? null : vi.path.noLink)
    } catch (e) {
      onHighlight([], [], e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e))
    }
  }

  const decide = (id: string, allow: boolean) => {
    if (!visible.current || modePending.current || modeRef.current !== 'edit' || turn.current?.mode !== 'edit') return
    const current = turn.current
    void (async () => {
      if (allow) await beforePrompt?.()
      if (!mounted.current || !visible.current || modePending.current || modeRef.current !== 'edit' || turn.current !== current || current?.cancelled) return
      await window.nexgraph.agent.approve(projectId, id, allow)
    })().catch((e) => {
      if (mounted.current) setError(errorMessage(e))
    })
  }
  const modeLocked = changingMode || checking || !!consent || work.pending || work.loading
  const composerLocked = !configured || !mode || modeLocked || stopping || (mode === 'edit' && toolsUnavailable)
  const changeModel = async (key: string) => {
    if (busy || checking) return
    setChecking(true)
    try {
      const selected = models.find((model) => `${model.provider}\n${model.id}` === key)
      if (!selected) return
      await window.nexgraph.auth.selectModel(selected.provider, selected.id)
      applySettings(await window.nexgraph.ai.getSettings())
      await work.restore()
    } catch (e) { setError(errorMessage(e)) }
    finally { setChecking(false) }
  }
  const attachedFile = attachments.find((item) => item.kind === 'file')
  const attachEditor = () => {
    const item = getEditorContext?.()
    if (item) { setAttachments((current) => [...current.filter((attachment) => attachment.kind !== 'file' || item.kind !== 'file' || attachment.file !== item.file), { ...item }]); setFileContext(undefined) }
    else setFileContext(activeFile)
    input.current?.focus()
  }
  const stop = () => {
    queueReady.current = false
    const current = turn.current
    const running = activeRun.current
    if (current) current.cancelled = true
    setStopping(true)
    void window.nexgraph.agent.abort(projectId).catch((e) => { if (mounted.current) setError(errorMessage(e)) }).finally(() => {
      if (!mounted.current) return
      if (turn.current === current) end()
      if (activeRun.current === running) activeRun.current = null
      setStopping(false)
    })
  }

  const sendNow = async (item: QueuedPrompt) => {
    updateQueue((items) => removeQueued(items, item.id))
    queueReady.current = false
    const current = turn.current
    const running = activeRun.current
    if (current) current.cancelled = true
    const generation = projectGeneration.current
    setStopping(true)
    try {
      if (current || running) await window.nexgraph.agent.abort(projectId)
      if (running) await running
      if (!mounted.current || generation !== projectGeneration.current) return
      if (activeRun.current === running) activeRun.current = null
      if (turn.current === current && current) end()
      if (item.sessionId === null && current?.sessionId) item = { ...item, sessionId: current.sessionId }
      if (!visible.current) { updateQueue((items) => [item, ...items]); return }
      await sendDraft(item, item)
    } catch (e) {
      if (mounted.current && generation === projectGeneration.current) { updateQueue((items) => [item, ...items]); setError(errorMessage(e)) }
    } finally {
      if (mounted.current && generation === projectGeneration.current) setStopping(false)
    }
  }

  const executeSlash = (name: string, erase = true) => {
    if (['new', 'clear', 'model', 'resume', 'login'].includes(name) && (busy || !!activeRun.current || checking || work.pending || work.loading)) {
      setError('Dừng trợ lý trước khi đổi phiên hoặc model.')
      return false
    }
    if (erase) setComposer({ ...composerRef.current, text: '' })
    setDismissedCompletion('')
    if (name === 'new' || name === 'clear') { void work.create(); setView('chat') }
    else if (name === 'resume') { setView('history'); void work.refresh().catch((e) => setError(errorMessage(e))) }
    else if (name === 'model') {
      if (!modelSelect.current) setError('Chưa có danh sách model. Hãy kết nối AI trước.')
      else { modelSelect.current.focus(); modelSelect.current.showPicker?.() }
    } else if (name === 'stop') stop()
    else if (name === 'login') setConnect(true)
    else if (name === 'settings') onOpenSettings()
    else if (name === 'files') runCommand('explorer.toggle')
    else if (name === 'terminal') runCommand('terminal.toggle')
    else if (name === 'diff') runCommand('changes.toggle')
    else if (name === 'saved') setSavedOpen(true)
    return true
  }

  /** Chèn tin đã lưu vào chỗ con trỏ của ô soạn (cuối chữ nếu chưa đặt con trỏ). */
  const insertSaved = (saved: string) => {
    const at = Math.min(cursor, text.length)
    setText(text.slice(0, at) + saved + text.slice(at))
    setCursor(at + saved.length)
    setDismissedCompletion('')
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(at + saved.length, at + saved.length) })
  }

  const token = focused ? completionToken(text, cursor) : null
  const tokenKey = token ? `${token.kind}:${token.start}:${token.query}` : ''
  const completion = token && tokenKey !== dismissedCompletion ? token : null
  useEffect(() => {
    if (completion?.kind !== 'mention' || projectFiles !== null || fileListError) return
    let live = true
    const load = window.nexgraph.fs.files
    if (!load) { setFileListError('Không liệt kê được tệp ở chế độ này.'); return }
    void load(projectId).then(({ files }) => { if (live) setProjectFiles(files) }).catch((e) => { if (live) setFileListError(errorMessage(e)) })
    return () => { live = false }
  }, [completion?.kind, projectFiles, fileListError, projectId])
  const commandRows = completion?.kind === 'command' ? filterSlashCommands(slashCommands, completion.query) : []
  const fileRows = completion?.kind === 'mention' ? rankFiles(projectFiles ?? [], completion.query).slice(0, 50).map((row) => row.item) : []
  const completionCount = completion?.kind === 'command' ? commandRows.length : fileRows.length
  const selectedCompletion = completionCount ? completionIndex % completionCount : 0

  const acceptCompletion = (index: number) => {
    if (!completion) return
    if (completion.kind === 'command') {
      const command = commandRows[index]
      if (!command || !executeSlash(command.name, false)) return
    } else {
      const file = fileRows[index]
      if (!file) return
      if (!attachments.some((item) => item.kind === 'file' && item.file === file)) {
        if (attachments.length >= 12) { setError('Mỗi lượt hỗ trợ tối đa 12 mục ngữ cảnh.'); return }
        setAttachments((current) => [...current, { kind: 'file', file }])
      }
    }
    const next = text.slice(0, completion.start) + text.slice(completion.end)
    setText(next)
    setCursor(completion.start)
    setDismissedCompletion('')
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(completion.start, completion.start) })
  }

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (completion) {
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && completionCount) {
        event.preventDefault()
        setCompletionIndex((selectedCompletion + (event.key === 'ArrowDown' ? 1 : completionCount - 1)) % completionCount)
        return
      }
      if (event.key === 'Escape') { event.preventDefault(); setDismissedCompletion(tokenKey); return }
      if ((event.key === 'Enter' || event.key === 'Tab') && completionCount && !event.shiftKey) {
        event.preventDefault(); acceptCompletion(selectedCompletion); return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() }
  }

  const addImages = async (files: File[]) => {
    if (stagingImages || !files.length) return
    const problems = files.map(imageError).filter((problem): problem is string => !!problem)
    if (problems.length) setError(problems.join(' '))
    const valid = files.filter((file) => !imageError(file))
    if (!valid.length) return
    setStagingImages(true)
    try {
      const added = await Promise.all(valid.map((file) => new Promise<ImageAttachment>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => typeof reader.result === 'string'
          ? resolve({ id: ++imageSeq.current, name: file.name || 'Ảnh', mimeType: file.type, dataUrl: reader.result }) : reject(new Error('Không đọc được ảnh.'))
        reader.onerror = () => reject(new Error(`Không đọc được ${file.name}.`))
        reader.onabort = () => reject(new Error(`Đã hủy đọc ${file.name}.`))
        reader.readAsDataURL(file)
      })))
      if (mounted.current) setImages((current) => [...current, ...added])
    } catch (e) { if (mounted.current) setError(errorMessage(e)) }
    finally { if (mounted.current) setStagingImages(false) }
  }

  const workLocked = busy || checking || work.pending || work.loading
  const sessionTitle = work.sessions.find((session) => session.id === work.sessionId)?.title
  alertTitle.current = sessionTitle ?? projectName
  const usage = workbenchUsage(work)
  const modeHint = mode === 'edit' ? work.execution.policy === 'auto' ? 'Tự động sửa mã trong phạm vi đã cấp quyền.' : vi.agent.editHint : mode === 'plan' ? 'Phân tích đồ thị và lập kế hoạch triển khai, chỉ đọc.' : vi.agent.askHint
  const menu: MenuItem[] = [
    { label: 'Kết nối AI', icon: 'plug', disabled: busy || checking, onSelect: () => setConnect(true) },
    ...(onConnectOpenCode ? [{ label: vi.chat.connectOpenCode, icon: 'plug' as const, onSelect: onConnectOpenCode }] : []),
    { label: 'Quyền & giới hạn', icon: 'shield', onSelect: () => setView('settings') },
    // Chuyển bên làm khung dựng lại từ đầu, nên khoá khi đang có lượt chạy để không huỷ lượt đó.
    ...(onToggleDock ? [{ label: dock === 'left' ? 'Chuyển khung chat sang phải' : 'Chuyển khung chat sang trái', icon: dock === 'left' ? 'panelRight' as const : 'panelLeft' as const, disabled: busy || checking, onSelect: onToggleDock }] : []),
    { label: vi.chat.settings, icon: 'sliders', onSelect: onOpenSettings }
  ]

  return (
    <aside id={id} className="chat agent-panel" data-dock={dock} aria-label={vi.chat.title} hidden={hidden}>
      <header className="agent-head">
        {view !== 'chat' && <button type="button" className="agent-icon-button" aria-label="Về cuộc trò chuyện" title="Về cuộc trò chuyện" onClick={() => setView('chat')}><Icon name="back" size={16} /></button>}
        <h2 title={view === 'chat' ? sessionTitle : undefined}>{view === 'history' ? 'Trò chuyện' : view === 'settings' ? 'Quyền & giới hạn' : sessionTitle ?? vi.chat.title}</h2>
        <div className="agent-actions">
          <button type="button" className="agent-icon-button" aria-label="Lịch sử" title="Lịch sử trò chuyện" aria-pressed={view === 'history'} disabled={workLocked}
            onClick={() => { setView(view === 'history' ? 'chat' : 'history'); void work.refresh().catch(() => {}) }}><Icon name="history" size={16} /></button>
          <button type="button" className="agent-icon-button" aria-label="Phiên mới" title="Phiên mới" disabled={workLocked} onClick={() => { void work.create(); setView('chat') }}><Icon name="plus" size={16} /></button>
          <PopoverMenu label="Thêm thao tác" buttonClass="agent-icon-button" trigger={<Icon name="more" size={16} />} items={menu} />
          {onClose && <button type="button" className="agent-icon-button" onClick={onClose} aria-label={vi.chat.close} title={vi.chat.close}><Icon name="close" size={15} /></button>}
        </div>
      </header>
      {view === 'history' && <WorkbenchHistory work={work} busy={busy || checking} onPicked={() => setView('chat')} />}
      {view === 'settings' && <div className="agent-settings-view"><WorkbenchSettings projectId={projectId} work={work} busy={busy || checking} mode={mode} runtime={cfg?.runtime} onSuggest={(suggestion) => { setText(suggestion); setView('chat'); input.current?.focus() }} /></div>}
      <div className="agent-thread" hidden={view !== 'chat'}>
        {toolsUnavailable && <p className="agent-notice">Model này không hỗ trợ gọi công cụ. Hãy đổi model để sửa mã và chạy kiểm thử.</p>}
        {error && <p role="alert" className="error">{error}</p>}
        <div className="msgs" ref={messages} onScroll={(event) => {
          const el = event.currentTarget
          followMessages.current = el.scrollHeight - el.clientHeight - el.scrollTop < 36
        }}>
          {cfg && msgs.length === 0 && !busy && (
            <div className="agent-welcome">
              {configured ? <>
                <span className="agent-folder-chip" title={projectName}><Icon name="folder" size={13} />{projectName}</span>
                <h3>{vi.chat.startTitle}</h3>
                <div className="agent-starters">
                  {vi.chat.starters.map((suggestion) => <button key={suggestion} type="button" disabled={modeLocked} onClick={() => {
                    setText(suggestion)
                    input.current?.focus()
                  }}><Icon name="spark" size={14} />{suggestion}</button>)}
                </div>
              </> : <>
                <span className="agent-welcome-icon"><Icon name="spark" size={22} /></span>
                <h3>{vi.chat.setupTitle}</h3>
                <p className="muted">{vi.chat.setupDescription}</p>
                <button type="button" className="primary" onClick={() => setConnect(true)}>Kết nối AI</button>
              </>}
            </div>
          )}
          {msgs.map((m, i) => m.role === 'user' ? (
            <div key={`user-${m.id}`} className="me">
              {m.content}
              {m.context && <span className="agent-sent-file mono" title={fileReference(m.context)}>{fileReference(m.context)}</span>}
            </div>
          ) : (
            <div key={`assistant-${m.id}`} className="ai">
              <CitationText text={m.content} citations={m.citations} onOpen={onOpenCode} />
              <div className="foot muted">
                {m.citations.length === 0 ? <span>{vi.chat.noCitations}</span>
                  : <span>{vi.chat.verified(m.citations.filter((c) => c.valid).length, m.citations.length)}</span>}
                {m.citations.some((c) => c.valid) && (
                  <button type="button" className="link" onClick={() => void highlight(m.citations)}>{vi.chat.highlight}</button>
                )}
                {m.tools.length > 0 && (
                  <button type="button" className="link" onClick={() => setOpenTools(openTools === m.id ? null : m.id)}>{vi.chat.tools(m.tools.length)}</button>
                )}
                {questionBefore(msgs, i) && <AnswerRating projectId={projectId} question={questionBefore(msgs, i)} answer={m.content} citations={m.citations} />}
              </div>
              {openTools === m.id && (
                <ul className="tool-list mono">
                  {m.tools.map((t, k) => <li key={`${m.id}-${k}`}>{t}</li>)}
                </ul>
              )}
            </div>
          ))}
          {busy && draft && <div className="ai"><CitationText text={draft} citations={NO_CITATIONS} onOpen={onOpenCode} /></div>}
          {busy && <div className="ai agent-thinking muted" role="status"><span className="agent-spinner" aria-hidden="true" />{tool ? vi.chat.usingTool(tool) : vi.chat.thinking}</div>}
        </div>
        <div className="agent-workbench-status"><WorkbenchStatus projectId={projectId} work={work} busy={busy || checking} onInspect={onInspect} /></div>
        {approvals.length > 0 && (
          <div className="approvals">
            {approvals.map((a) => <ApprovalCard key={a.id} request={a} disabled={changingMode} onDecide={(allow) => decide(a.id, allow)} onInspect={(request) => onInspect?.({ id: request.id, title: `Đề xuất · ${request.path}`, file: request.path, before: request.before, after: request.after })} />)}
          </div>
        )}
        <div className="compose">
          {sessionQueue.length > 0 && <div className="agent-queue" aria-label="Hàng đợi tin nhắn">
            {sessionQueue.map((item) => <div className="agent-queue-row" key={item.id}>
              {editingQueue?.id === item.id ? <>
                <span>Đang sửa trong ô soạn tin</span>
                <button type="button" disabled={stagingImages} onClick={() => void submit()}>Lưu</button>
                <button type="button" disabled={stagingImages} onClick={() => { setComposer(editingQueue.draft); setEditingQueue(null); setQueueWake((count) => count + 1) }}>Hủy</button>
              </> : <>
                {item.images[0] && <img src={item.images[0].dataUrl} alt="" />}
                <span title={item.text}>{item.text.trim() || (item.images.length ? 'Hình ảnh' : 'Ngữ cảnh đính kèm')}</span>
                <button type="button" className="agent-icon-button" aria-label="Gỡ tin khỏi hàng đợi" title="Gỡ" disabled={stopping || stagingImages || !!editingQueue} onClick={() => updateQueue((items) => removeQueued(items, item.id))}><Icon name="trash" size={13} /></button>
                <button type="button" className="agent-icon-button" aria-label="Sửa tin trong hàng đợi" title="Sửa" disabled={stopping || stagingImages} onClick={() => {
                  const draft = editingQueue?.draft ?? composerRef.current
                  setEditingQueue({ id: item.id, draft })
                  setComposer(item)
                  input.current?.focus()
                }}><Icon name="pencil" size={13} /></button>
                <button type="button" title="Dừng trợ lý và gửi ngay tin này" disabled={stopping || stagingImages || !!editingQueue || checking || work.pending || work.loading || !!consent} onClick={() => void sendNow(item)}>Gửi ngay</button>
              </>}
            </div>)}
          </div>}
          <div className="agent-composer" onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}
            onDrop={(event) => { if (event.dataTransfer.files.length) { event.preventDefault(); void addImages(Array.from(event.dataTransfer.files)) } }}>
            {completion && <div id="agent-completions" className="agent-completions" role="listbox" aria-label={completion.kind === 'command' ? 'Lệnh' : 'Tệp trong dự án'}>
              {completion.kind === 'command' ? commandRows.map((command, index) => <button type="button" role="option" aria-selected={index === selectedCompletion} id={`agent-completion-${index}`} key={command.name} onMouseDown={(event) => event.preventDefault()} onClick={() => acceptCompletion(index)}><b>/{command.name}</b><span>{command.detail}</span></button>)
                : fileRows.map((file, index) => <button type="button" role="option" aria-selected={index === selectedCompletion} id={`agent-completion-${index}`} key={file} onMouseDown={(event) => event.preventDefault()} onClick={() => acceptCompletion(index)}><FileTypeIcon name={file} /><b>{file.slice(file.lastIndexOf('/') + 1)}</b><span>{file.slice(0, file.lastIndexOf('/') + 1)}</span></button>)}
              {!completionCount && <div className="agent-completion-empty">{completion.kind === 'command' ? 'Không có lệnh khớp' : fileListError || (projectFiles ? 'Không có tệp khớp' : 'Đang liệt kê tệp…')}</div>}
            </div>}
            {(attachments.length > 0 || fileContext || images.length > 0 || stagingImages) && <div className="agent-attachments">
              {attachments.map((item, index) => <div className="agent-attachment" key={`${item.kind}-${index}`}><span className="mono" title={contextLabel(item)}>{item.kind === 'file' ? '@' : ''}{contextLabel(item)}</span><button type="button" className="agent-icon-button" disabled={checking || stopping} aria-label={`Gỡ ${contextLabel(item)}`} onClick={() => setAttachments((current) => current.filter((_, at) => at !== index))}><Icon name="close" size={11} /></button></div>)}
              {fileContext && <div className="agent-attachment">
                <span className="mono" title={fileReference(fileContext)}>{fileReference(fileContext)}</span>
                <button type="button" className="agent-icon-button" disabled={composerLocked} aria-label={vi.chat.removeFile} onClick={() => setFileContext(undefined)}><Icon name="close" size={11} /></button>
              </div>}
              {images.map((image) => <div className="agent-image" key={image.id}><img src={image.dataUrl} alt={image.name} /><button type="button" className="agent-icon-button" aria-label={`Gỡ ảnh ${image.name}`} title="Gỡ ảnh" onClick={() => setImages((current) => current.filter((item) => item.id !== image.id))}><Icon name="close" size={11} /></button></div>)}
              {stagingImages && <span className="agent-image-loading">Đang chuẩn bị ảnh…</span>}
            </div>}
            <textarea ref={input} value={text} aria-label={vi.chat.message} placeholder={vi.chat.placeholder} rows={3} disabled={modeLocked || stopping}
              aria-autocomplete="list" aria-expanded={!!completion} aria-controls={completion ? 'agent-completions' : undefined} aria-activedescendant={completionCount ? `agent-completion-${selectedCompletion}` : undefined}
              onFocus={(event) => { setFocused(true); setCursor(event.currentTarget.selectionStart) }} onBlur={() => setFocused(false)}
              onSelect={(event) => setCursor(event.currentTarget.selectionStart)} onChange={(event) => { setText(event.target.value); setCursor(event.target.selectionStart); setCompletionIndex(0); setDismissedCompletion('') }} onKeyDown={onKey}
              onPaste={(event) => { const files = Array.from(event.clipboardData.items).filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter((file): file is File => !!file); if (files.length) { event.preventDefault(); void addImages(files) } }} />
            <div className="agent-composer-actions">
              <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={(event) => { void addImages(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = '' }} />
              <button type="button" className="agent-round" aria-label="Đính kèm ảnh" title="Đính kèm ảnh" disabled={composerLocked || stagingImages} onClick={() => imageInput.current?.click()}><Icon name="plus" size={17} /></button>
              <button type="button" className="agent-round" aria-label={vi.chat.attachFile} disabled={composerLocked || !activeFile || (!getEditorContext && fileReference(activeFile) === (fileContext && fileReference(fileContext)))}
                title={activeFile ? `${vi.chat.attachFile}: ${fileReference(activeFile)}` : vi.chat.noActiveFile} onClick={attachEditor}><Icon name="folder" size={15} /></button>
              <SavedPrompts open={savedOpen} onOpenChange={setSavedOpen} composerText={text} onInsert={insertSaved} />
              {graphContext && <button type="button" className="agent-chip" disabled={composerLocked || attachments.some((item) => item.kind === graphContext.kind && contextLabel(item) === contextLabel(graphContext))} title={`Đính kèm ${contextLabel(graphContext)}`} aria-label="Đính kèm đồ thị" onClick={() => setAttachments((current) => [...current, { ...graphContext }])}><Icon name="graph" size={14} />Đồ thị</button>}
              {availableModels.length > 0 && configured ? <select ref={modelSelect} className="agent-model-select" aria-label="Mô hình AI" value={`${cfg?.provider}\n${cfg?.model}`} disabled={busy || modeLocked} onChange={(event) => void changeModel(event.target.value)}>
                {!availableModels.some((model) => model.provider === cfg?.provider && model.id === cfg?.model) && <option value={`${cfg?.provider}\n${cfg?.model}`}>{cfg?.model === 'auto' ? 'Tự động' : cfg?.model}</option>}
                {availableModels.map((model) => <option key={`${model.provider}/${model.id}`} value={`${model.provider}\n${model.id}`}>{model.id === 'auto' ? 'Tự động' : model.label}</option>)}
              </select> : <span className="agent-model" title={configured ? `${connectionLabel(cfg)} · ${cfg?.model}` : undefined}>{configured ? cfg?.model === 'auto' ? 'Tự động' : cfg?.model : 'Chưa chọn model'}</span>}
              {busy && !text.trim() && !attachments.length && !fileContext && !images.length && !editingQueue
                ? <button type="button" className="agent-send" aria-label={vi.chat.stop} title={vi.chat.stop} disabled={stopping} onClick={stop}><span className="agent-stop-square" /></button>
                : <button type="button" className="agent-send" aria-label={editingQueue ? 'Lưu vào hàng đợi' : busy ? 'Xếp hàng' : vi.chat.send} title={editingQueue ? 'Lưu vào hàng đợi' : busy ? 'Xếp hàng' : vi.chat.send} disabled={(text.trim() !== '/login' && composerLocked) || stagingImages || (!text.trim() && !attachments.length && !fileContext && !images.length)} onClick={() => void submit()}><Icon name="send" size={15} /></button>}
            </div>
          </div>
          <div className="agent-composer-foot">
            <span className="mode" role="group" aria-label={vi.agent.modeTitle} title={mode ? modeHint : undefined}>
              <button type="button" disabled={modeLocked || (busy && disabledTools.length > 0)} aria-pressed={mode === 'ask' && !activeProfile} onClick={() => void pickProfile(null, 'ask')}>{vi.agent.ask}</button>
              <button type="button" disabled={modeLocked || busy} aria-pressed={mode === 'plan' && !activeProfile} onClick={() => void pickProfile(null, 'plan')}>Kế hoạch</button>
              <button type="button" disabled={modeLocked || busy || toolsUnavailable} aria-pressed={mode === 'edit' && !activeProfile} onClick={() => void pickProfile(null, 'edit')}>{vi.agent.edit}</button>
              {profiles.map((profile) => (
                <button key={profile.id} type="button" disabled={modeLocked || busy || (profile.mode === 'edit' && toolsUnavailable)} aria-pressed={activeProfile?.id === profile.id}
                  title={`Hồ sơ tự tạo: ${profile.mode === 'edit' ? vi.agent.edit : profile.mode === 'plan' ? 'Kế hoạch' : vi.agent.ask}, tắt ${profile.disabledTools.length} tool`}
                  onClick={() => void pickProfile(profile, profile.mode)}>{profile.name}</button>
              ))}
            </span>
            {configured && <span className="agent-connection-label" data-runtime={cfg?.runtime} title={connectionLabel(cfg)}><Icon name="plug" size={11} />{connectionLabel(cfg)}</span>}
            {usage && <span className="agent-usage" title="Token tích lũy của phiên; chi phí ước tính khi nhà cung cấp có bảng giá">{usage}</span>}
            <ContextRing context={work.context} />
          </div>
          {mode && <p className="mode-description">{modeHint}</p>}
        </div>
      </div>
      {attachedFile?.kind === 'file' && attachedFile.dirty && <span className="sr-only">Ngữ cảnh gồm bản nháp chưa lưu.</span>}
      {connect && !hidden && <ConnectionDialog projectId={projectId} initialProvider={cfg?.runtime === 'antigravity-cli' || cfg?.provider === 'google' ? 'gemini' : cfg?.provider?.startsWith('openai') ? 'openai' : cfg?.provider === 'ollama-local' ? 'local' : cfg?.provider ? 'other' : undefined} initialMethod={cfg?.provider === 'google' ? 'api_key' : undefined} onClose={() => setConnect(false)} onConnected={() => {
        setConnect(false)
        void Promise.all([window.nexgraph.ai.getSettings(), window.nexgraph.auth.models()]).then(async ([settings, available]) => { if (!mounted.current) return; applySettings(settings); setModels(available); await work.restore() }).catch((e) => setError(errorMessage(e)))
      }} />}
      {consent && !hidden && (
        <ConsentDialog project={projectName} target={consent.target} model={consent.model}
          onCancel={() => { if (consent.queued) updateQueue((items) => [consent.queued!, ...items]); setConsent(null) }}
          onOk={() => void confirmConsent(consent)} />
      )}
    </aside>
  )
}
