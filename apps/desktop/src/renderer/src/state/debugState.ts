import { useSyncExternalStore } from 'react'
import type { DebugBreakpoint, DebugBreakpoints, DebugFrame, DebugScope, DebugVariable } from '@shared/api'
import { errorText } from './errorText'

export type DebugKind = 'node' | 'python'
export type DebugStatus = 'idle' | 'starting' | 'running' | 'stopped'
export type ScopeView = DebugScope & { vars: DebugVariable[] }
export type WatchView = { expression: string; value: string | null; variablesReference: number }

type State = {
  breakpoints: DebugBreakpoints
  at: { file: string; line: number } | null
  status: DebugStatus
  threadId: number
  frames: DebugFrame[]
  frameId: number | null
  scopes: ScopeView[]
  watches: WatchView[]
  output: string[]
  error: string | null
}
let state: State = { breakpoints: {}, at: null, status: 'idle', threadId: 0, frames: [], frameId: null, scopes: [], watches: [], output: [], error: null }
const listeners = new Set<() => void>()
const patch = (next: Partial<State>) => { state = { ...state, ...next }; for (const l of listeners) l() }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useDebugState = (): State => useSyncExternalStore(subscribe, () => state)
const api = () => window.nexgraph?.debug
let project: string | null = null
let generation = 0
let frameRequest = 0
let starting: Promise<void> | null = null
let switching: Promise<void> | null = null
const storageKey = (id: string) => `nexgraph.debug.breakpoints.${id}`

function loadBreakpoints(id: string): DebugBreakpoints {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(storageKey(id)) ?? '{}')
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
    return Object.fromEntries(Object.entries(data).flatMap(([file, points]) => {
      if (!Array.isArray(points)) return []
      const valid = points.filter((point): point is DebugBreakpoint => point && typeof point === 'object' &&
        Number.isInteger(point.line) && point.line > 0 && typeof point.enabled === 'boolean' &&
        ['condition', 'hitCondition', 'logMessage'].every((key) => point[key] === undefined || typeof point[key] === 'string'))
      return valid.length ? [[file, valid.sort((a, b) => a.line - b.line)]] : []
    }))
  } catch { return {} }
}

export function setDebugProject(id: string): void {
  if (project === id) return
  project = id
  const current = ++generation
  ++frameRequest
  const mustStop = state.status !== 'idle' || !!starting || !!switching
  patch({ breakpoints: loadBreakpoints(id), watches: [], output: [], error: null, frames: [], scopes: [], frameId: null, at: null,
    status: mustStop ? 'starting' : 'idle' })
  if (mustStop) {
    const stop = switching ?? Promise.resolve(starting).catch(() => {}).then(() => api()?.stop())
    const pending = stop.then(() => {
      if (generation === current) patch({ status: 'idle' })
    }, (e: unknown) => {
      if (generation === current) patch({ status: 'idle', error: errorText(e) })
    })
    switching = pending
    void pending.finally(() => { if (switching === pending) switching = null })
  }
}

let opener: ((file: string, line: number) => void) | null = null
export const setDebugOpener = (open: typeof opener): void => { opener = open }

function changeBreakpoints(file: string, points: DebugBreakpoint[]): void {
  const breakpoints = { ...state.breakpoints, [file]: points }
  if (!points.length) delete breakpoints[file]
  patch({ breakpoints })
  if (project) {
    try { localStorage.setItem(storageKey(project), JSON.stringify(breakpoints)) }
    catch { patch({ error: 'Không lưu được điểm dừng cho dự án' }) }
  }
  if (state.status !== 'idle' && !switching) {
    const current = generation
    void api()?.setBreakpoints(file, points).catch((e: unknown) => { if (generation === current) patch({ error: errorText(e) }) })
  }
}

export function toggleBreakpoint(file: string, line: number): void {
  const points = state.breakpoints[file] ?? []
  changeBreakpoints(file, points.some((point) => point.line === line)
    ? points.filter((point) => point.line !== line)
    : [...points, { line, enabled: true }].sort((a, b) => a.line - b.line))
}

export function setBreakpoint(file: string, line: number, changes: Partial<Omit<DebugBreakpoint, 'line'>>): void {
  const points = state.breakpoints[file] ?? []
  const existing = points.find((point) => point.line === line) ?? { line, enabled: true }
  const point = { ...existing, ...changes, line }
  changeBreakpoints(file, [...points.filter((item) => item.line !== line), point].sort((a, b) => a.line - b.line))
}

export function clearAllBreakpoints(): void {
  for (const file of Object.keys(state.breakpoints)) changeBreakpoints(file, [])
}

async function refreshWatches(frameId: number, request: number): Promise<void> {
  const debug = api()
  if (!debug) return
  const evaluated = await Promise.all(state.watches.map(async (watch): Promise<WatchView> => {
    try {
      const result = await debug.evaluate(watch.expression, frameId, 'watch')
      return { ...watch, value: result.result, variablesReference: result.variablesReference }
    } catch (e) { return { ...watch, value: errorText(e), variablesReference: 0 } }
  }))
  if (frameRequest !== request || state.status !== 'stopped' || state.frameId !== frameId) return
  patch({ watches: state.watches.map((watch) => evaluated.find((item) => item.expression === watch.expression) ?? watch) })
}

export function addWatch(expression: string): void {
  expression = expression.trim()
  if (!expression || state.watches.some((watch) => watch.expression === expression)) return
  patch({ watches: [...state.watches, { expression, value: null, variablesReference: 0 }] })
  if (state.status === 'stopped' && state.frameId !== null) void refreshWatches(state.frameId, frameRequest)
}
export const removeWatch = (expression: string): void => patch({ watches: state.watches.filter((watch) => watch.expression !== expression) })

export async function selectFrame(frame: DebugFrame): Promise<void> {
  const debug = api()
  if (!debug || state.status !== 'stopped') return
  const request = ++frameRequest
  patch({ frameId: frame.id, at: frame.file ? { file: frame.file, line: frame.line } : null, scopes: [] })
  if (frame.file) opener?.(frame.file, frame.line)
  void refreshWatches(frame.id, request)
  try {
    const scopes = await debug.scopes(frame.id)
    const views = await Promise.all(scopes.map(async (s) => ({ ...s, vars: s.expensive ? [] : await debug.variables(s.variablesReference).catch(() => []) })))
    if (request === frameRequest && state.status === 'stopped') patch({ scopes: views })
  } catch (e) { if (request === frameRequest) patch({ error: errorText(e) }) }
}

let listening = false
function listen() {
  const debug = api()
  if (listening || !debug) return
  listening = true
  debug.onEvent((event) => {
    if (switching) return
    if (event.type === 'output') return patch({ output: [...state.output.slice(-500), event.text] })
    const request = ++frameRequest
    if (event.state === 'stopped') {
      patch({ status: 'stopped', threadId: event.threadId ?? 0, frames: [], scopes: [], frameId: null })
      void debug.stackTrace(event.threadId ?? 0).then((frames) => {
        if (request !== frameRequest || state.status !== 'stopped') return
        patch({ frames })
        const top = frames.find((f) => f.file) ?? frames[0]
        if (top) void selectFrame(top)
      }).catch((e: unknown) => { if (request === frameRequest) patch({ error: errorText(e) }) })
      return
    }
    patch({ status: event.state === 'terminated' ? 'idle' : event.state, frames: [], scopes: [], frameId: null, at: null,
      watches: state.watches.map((watch) => ({ ...watch, value: null, variablesReference: 0 })) })
  })
}

export async function startDebugging(projectId: string, kind: DebugKind, file: string): Promise<void> {
  if (project !== projectId) setDebugProject(projectId)
  const debug = api()
  if (!debug || state.status !== 'idle' || switching) return
  listen()
  const current = generation
  patch({ error: null, output: [], status: 'starting' })
  const initial = state.breakpoints
  const task = debug.start(projectId, kind, file, initial)
  starting = task
  try {
    await task
    if (generation === current) {
      for (const path of new Set([...Object.keys(initial), ...Object.keys(state.breakpoints)])) {
        if (generation !== current) break
        if (initial[path] !== state.breakpoints[path]) {
          try { await debug.setBreakpoints(path, state.breakpoints[path] ?? []) }
          catch (e) { if (generation === current) patch({ error: errorText(e) }) }
        }
      }
    }
  } catch (e) { if (generation === current) patch({ error: errorText(e), status: 'idle' }) }
  finally { if (starting === task) starting = null }
}

export function debugStep(action: 'continue' | 'next' | 'stepIn' | 'stepOut'): void {
  if (state.status !== 'stopped') return
  void api()?.step(action, state.threadId).catch((e: unknown) => patch({ error: errorText(e) }))
}
export function pauseDebugging(): void {
  if (state.status === 'running') void api()?.pause().catch((e: unknown) => patch({ error: errorText(e) }))
}
export function restartDebugging(): void {
  if (state.status !== 'running' && state.status !== 'stopped') return
  const current = generation
  const debug = api()
  if (!debug) return
  const initial = state.breakpoints
  const task = debug.restart()
  starting = task
  void task.then(async () => {
    if (generation !== current) return
    for (const path of new Set([...Object.keys(initial), ...Object.keys(state.breakpoints)])) {
      if (generation !== current) break
      if (initial[path] !== state.breakpoints[path]) await debug.setBreakpoints(path, state.breakpoints[path] ?? [])
    }
  }).catch((e: unknown) => { if (generation === current) patch({ error: errorText(e) }) })
    .finally(() => { if (starting === task) starting = null })
}
export function evaluateConsole(expression: string): void {
  const debug = api()
  if (!debug || state.status !== 'stopped' || state.frameId === null || !expression.trim()) return
  const frameId = state.frameId
  const current = generation
  patch({ output: [...state.output.slice(-500), `> ${expression}\n`] })
  void debug.evaluate(expression, frameId, 'repl').then((result) => {
    if (generation === current) patch({ output: [...state.output.slice(-500), `< ${result.result}\n`] })
  }, (e: unknown) => {
    if (generation === current) patch({ output: [...state.output.slice(-500), `${errorText(e)}\n`] })
  })
}
export const stopDebugging = (): void => void api()?.stop().catch((e: unknown) => patch({ error: errorText(e) }))
export const setDebugError = (error: string | null): void => patch({ error })
