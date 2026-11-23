import { tr } from '../../strings'
import { retryNotice } from './retry'

import { useEffect, useRef, useState } from 'react'
import type { AgentContextUsage, AgentExecutionSettings, AgentRunLimits, AgentSessionInfo, AgentSessionSnapshot, AgentTask, AgentToolRun, AgentUsage } from '@shared/agent-types'

export type AgentInspection = { id: string; title: string; text?: string; before?: string; after?: string; file?: string }
const defaults: AgentRunLimits = { maxTurns: 30, maxDurationMs: 600_000, maxTokens: 120_000 }
const emptyUsage: AgentUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: null }
const messageOf = (e: unknown): string => e instanceof Error ? e.message : e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e)
const pinKeyPrefix = 'nexgraph.agent.pinned.'
const readPins = (projectId: string): string[] => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(pinKeyPrefix + projectId) ?? '[]')
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))] : []
  } catch { return [] }
}
const writePins = (projectId: string, ids: string[]): boolean => {
  try { localStorage.setItem(pinKeyPrefix + projectId, JSON.stringify(ids)); return true } catch { return false }
}

/** Telemetry and durable history are separate from the in-flight composer draft. */
export function useAgentWorkbench(projectId: string, onSnapshot: (snapshot: AgentSessionSnapshot) => void) {
  const alive = useRef(true)
  const activeProject = useRef(projectId)
  activeProject.current = projectId
  const readSeq = useRef(0)
  const mutationSeq = useRef(0)
  const loadingSeq = useRef(0)
  const loadingRef = useRef(true)
  const mutating = useRef(false)
  const receive = useRef(onSnapshot)
  receive.current = onSnapshot
  const [sessions, setSessions] = useState<AgentSessionInfo[]>([])
  const [pins, setPins] = useState(() => ({ projectId, ids: readPins(projectId) }))
  const pinnedIds = pins.projectId === projectId ? pins.ids : readPins(projectId)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [task, setTask] = useState<AgentTask | null>(null)
  const [tools, setTools] = useState<AgentToolRun[]>([])
  const [usage, setUsage] = useState<AgentUsage>(emptyUsage)
  const [context, setContext] = useState<AgentContextUsage | null>(null)
  const [execution, setExecution] = useState<AgentExecutionSettings>({ policy: 'review', allowCommands: false })
  const [limits, setLimits] = useState(defaults)
  const [notice, setNotice] = useState('')
  const [noticeDetail, setNoticeDetail] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [loading, setLoading] = useState(true)
  const apply = (snapshot: AgentSessionSnapshot) => {
    if (!alive.current) return
    setSessionId(snapshot.session?.id ?? null)
    setTask(snapshot.task)
    setTools(snapshot.messages.flatMap((m) => m.tools))
    setUsage(snapshot.usage)
    setContext(snapshot.context ?? null)
    setExecution(snapshot.execution)
    setLimits(snapshot.limits)
    receive.current(snapshot)
  }
  const refresh = async (restore = false) => {
    const seq = ++readSeq.current
    const current = () => alive.current && seq === readSeq.current
    try {
      const snapshot = await window.nexgraph.agent.snapshot(projectId)
      if (!current()) return
      if (restore) apply(snapshot)
      else { setSessionId(snapshot.session?.id ?? null); setTask(snapshot.task); setUsage(snapshot.usage); setContext(snapshot.context ?? null) }
      const list = await window.nexgraph.agent.listSessions(projectId)
      if (current()) setSessions(list)
    } catch (e) { if (current()) throw e }
  }
  const restore = async () => {
    const load = ++loadingSeq.current
    loadingRef.current = true
    setLoading(true)
    setSessions([]); setSessionId(null); setTask(null); setTools([]); setUsage(emptyUsage); setContext(null)
    try { await refresh(true) }
    finally {
      if (alive.current && load === loadingSeq.current) { loadingRef.current = false; setLoading(false) }
    }
  }
  useEffect(() => {
    alive.current = true
    const generation = ++mutationSeq.current
    mutating.current = false
    setPins({ projectId, ids: readPins(projectId) })
    setPending(false); setError('')
    void restore().catch((e) => { if (alive.current && generation === mutationSeq.current) setError(messageOf(e)) })
    const off = window.nexgraph.agent.onEvent((pid, event) => {
      if (pid !== projectId || !alive.current) return
      if (!mutating.current && ['session', 'task', 'tool_detail', 'usage', 'command_output'].includes(event.type)) readSeq.current++
      if (event.type === 'session') setSessionId(event.sessionId)
      if (event.type === 'task') { setTask(event.task); if (event.task.status === 'running' && event.task.turns === 0) { setTools([]); setNotice(''); setNoticeDetail('') } }
      if (event.type === 'tool_detail') setTools((current) => current.some((t) => t.id === event.tool.id)
        ? current.map((t) => t.id === event.tool.id ? event.tool : t) : [...current, event.tool])
      if (event.type === 'usage') setUsage(event.usage)
      if (event.type === 'context') setContext(event.context)
      if (event.type === 'retry') { setNotice(retryNotice(event)); setNoticeDetail(event.message) }
      if (event.type === 'compaction') { setNotice(event.active ? tr('Đang tóm tắt ngữ cảnh để tiếp tục…') : tr('Đã tóm tắt ngữ cảnh.')); setNoticeDetail('') }
      if (event.type === 'command_output') setTools((current) => current.map((t) => t.id === event.id ? { ...t, output: (t.output + event.delta).slice(-65_536) } : t))
      if (event.type === 'done' || event.type === 'error') void refresh().catch(() => {})
    })
    return () => { alive.current = false; readSeq.current++; mutationSeq.current++; loadingSeq.current++; off() }
  }, [projectId])
  const mutate = async <T,>(fn: () => Promise<T>, update?: (value: T) => void, onApplied?: () => void) => {
    if (mutating.current || loadingRef.current) return
    mutating.current = true
    const mutation = ++mutationSeq.current
    const seq = ++readSeq.current
    const current = () => alive.current && seq === readSeq.current && mutation === mutationSeq.current
    setPending(true); setError('')
    try {
      const value = await fn()
      if (!current()) return
      update?.(value)
      onApplied?.()
      const list = await window.nexgraph.agent.listSessions(projectId)
      if (current()) setSessions(list)
    } catch (e) { if (current()) setError(messageOf(e)) }
    finally {
      if (alive.current && mutation === mutationSeq.current) {
        mutating.current = false
        setPending(false)
      }
    }
  }
  return { sessions, pinnedIds, sessionId, task, tools, usage, context, execution, limits, notice, noticeDetail, error, pending, loading,
    invalidate: () => { readSeq.current++ },
    restore,
    refresh,
    create: () => mutate(() => window.nexgraph.agent.newSession(projectId), apply),
    switchTo: (id: string) => mutate(() => window.nexgraph.agent.switchSession(projectId, id), apply),
    fork: (id: string, onApplied?: () => void) => mutate(() => window.nexgraph.agent.forkSession(projectId, id), apply, onApplied),
    togglePin: (id: string) => {
      const next = pinnedIds.includes(id) ? pinnedIds.filter((pin) => pin !== id) : [...pinnedIds, id]
      setPins({ projectId, ids: next })
      setError(writePins(projectId, next) ? '' : tr('Không thể lưu danh sách đã ghim. Các thay đổi có thể không được lưu.'))
    },
    rename: (id: string, title: string) => mutate(() => window.nexgraph.agent.renameSession(projectId, id, title)),
    remove: (id: string) => mutate(async () => {
      const generation = mutationSeq.current
      await window.nexgraph.agent.deleteSession(projectId, id)
      const saved = readPins(projectId)
      if (saved.includes(id) && !writePins(projectId, saved.filter((pin) => pin !== id)) && alive.current && activeProject.current === projectId) setError(tr('Không thể lưu danh sách đã ghim. Các thay đổi có thể không được lưu.'))
      if (alive.current && activeProject.current === projectId)
        setPins((current) => ({ projectId, ids: (current.projectId === projectId ? current.ids : saved).filter((pin) => pin !== id) }))
      return alive.current && generation === mutationSeq.current ? window.nexgraph.agent.snapshot(projectId) : null
    }, (snapshot) => { if (snapshot) apply(snapshot) }),
    saveExecution: (value: AgentExecutionSettings) => mutate(() => window.nexgraph.agent.setExecution(projectId, value), () => setExecution(value)),
    saveLimits: (value: AgentRunLimits) => mutate(() => window.nexgraph.agent.setLimits(projectId, value), () => setLimits(value)),
    rollback: () => task ? mutate(async () => {
      const result = await window.nexgraph.agent.rollback(projectId, task.id)
      const checkpoints = await window.nexgraph.agent.checkpoints(projectId, task.id)
      return { result, remaining: checkpoints.filter((checkpoint) => !checkpoint.restored).map((checkpoint) => checkpoint.id) }
    }, ({ result, remaining }) => {
      const conflicts = result.conflicts.length ? tr(' Xung đột: {items}', { items: result.conflicts.map((c) => `${c.path}: ${c.reason}`).join('; ') }) : ''
      setNotice(tr('Đã khôi phục {count} tệp.{conflicts}', { count: result.restored.length, conflicts }))
      setTask({ ...task, checkpointIds: remaining })
    }) : Promise.resolve()
  }
}

export type AgentWorkbench = ReturnType<typeof useAgentWorkbench>
