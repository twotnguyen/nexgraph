import { useSyncExternalStore } from 'react'
import type { DebugBreakpoints, DebugFrame, DebugScope, DebugVariable } from '@shared/api'
import { errorText } from './errorText'

export type DebugKind = 'node' | 'python'
export type DebugStatus = 'idle' | 'starting' | 'running' | 'stopped'
export type ScopeView = DebugScope & { vars: DebugVariable[] }

/**
 * Trạng thái gỡ lỗi dùng chung (một phiên mỗi lúc): điểm dừng cho gutter editor, phiên đang chạy cho bảng Gỡ lỗi.
 * Giữ ngoài component để đóng bảng hay đổi màn không làm mất phiên, như Wu.
 */
type State = {
  breakpoints: DebugBreakpoints
  at: { file: string; line: number } | null
  status: DebugStatus
  threadId: number
  frames: DebugFrame[]
  frameId: number | null
  scopes: ScopeView[]
  output: string[]
  error: string | null
}
let state: State = { breakpoints: {}, at: null, status: 'idle', threadId: 0, frames: [], frameId: null, scopes: [], output: [], error: null }
const listeners = new Set<() => void>()
const patch = (next: Partial<State>) => { state = { ...state, ...next }; for (const l of listeners) l() }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useDebugState = (): State => useSyncExternalStore(subscribe, () => state)

const message = errorText
const api = () => window.nexgraph.debug

/** Mở tệp ở dòng đang dừng; không gian làm việc gán khi mở. */
let opener: ((file: string, line: number) => void) | null = null
export const setDebugOpener = (open: typeof opener): void => { opener = open }

/** Bật/tắt điểm dừng ở một dòng; báo cho phiên đang chạy. */
export function toggleBreakpoint(file: string, line: number): void {
  const current = state.breakpoints[file] ?? []
  const lines = current.includes(line) ? current.filter((l) => l !== line) : [...current, line].sort((a, b) => a - b)
  const breakpoints = { ...state.breakpoints }
  if (lines.length) breakpoints[file] = lines
  else delete breakpoints[file]
  patch({ breakpoints })
  if (state.status !== 'idle') void api()?.setBreakpoints(file, lines).catch(() => {})
}

export async function selectFrame(frame: DebugFrame): Promise<void> {
  const debug = api()
  if (!debug) return
  patch({ frameId: frame.id, at: frame.file ? { file: frame.file, line: frame.line } : state.at })
  if (frame.file) opener?.(frame.file, frame.line)
  const scopes = await debug.scopes(frame.id).catch(() => [])
  patch({ scopes: await Promise.all(scopes.map(async (s) => ({ ...s, vars: s.expensive ? [] : await debug.variables(s.variablesReference).catch(() => []) }))) })
}

let listening = false
function listen() {
  const debug = api()
  if (listening || !debug) return
  listening = true
  debug.onEvent((event) => {
    if (event.type === 'output') return patch({ output: [...state.output.slice(-500), event.text] })
    if (event.state === 'stopped') {
      patch({ status: 'stopped', threadId: event.threadId ?? 0 })
      void debug.stackTrace(event.threadId ?? 0).then((frames) => {
        patch({ frames })
        const top = frames.find((f) => f.file) ?? frames[0]
        if (top) void selectFrame(top)
      }).catch((e: unknown) => patch({ error: message(e) }))
      return
    }
    patch({ status: event.state === 'terminated' ? 'idle' : event.state, frames: [], scopes: [], frameId: null, at: null })
  })
}

export async function startDebugging(projectId: string, kind: DebugKind, file: string): Promise<void> {
  const debug = api()
  if (!debug || state.status !== 'idle') return
  listen()
  patch({ error: null, output: [], status: 'starting' })
  try {
    await debug.start(projectId, kind, file, state.breakpoints)
  } catch (e) {
    patch({ error: message(e), status: 'idle' })
  }
}

export function debugStep(action: 'continue' | 'next' | 'stepIn' | 'stepOut'): void {
  if (state.status !== 'stopped') return
  void api()?.step(action, state.threadId).catch((e: unknown) => patch({ error: message(e) }))
}
export const stopDebugging = (): void => void api()?.stop().catch(() => {})
export const setDebugError = (error: string | null): void => patch({ error })
