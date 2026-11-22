import { useSyncExternalStore } from 'react'
import type { DebugBreakpoint, DebugBreakpoints, DebugConfigInfo, DebugEvent, DebugFrame, DebugLoadedSource, DebugModule, DebugScope, DebugVariable, NexGraphApi } from '@shared/api'
import { errorText } from './errorText'
import { tr } from '../strings'

export type DebugKind = 'node' | 'python'
export type DebugStatus = 'idle' | 'starting' | 'running' | 'stopped'
export type ScopeView = DebugScope & { vars: DebugVariable[] }
export type WatchView = { expression: string; value: string | null; variablesReference: number }
/** Cấu hình trong .vscode/launch.json hoặc .zed/debug.json, theo (tệp, tên). */
export type ConfigRef = Pick<DebugConfigInfo, 'source' | 'name'>

/** Các mục có thể thu gọn trong bảng Gỡ lỗi; mỗi adapter/kind giữ một bản riêng. */
export type DebugLayoutSection = 'variables' | 'stack' | 'console' | 'breakpoints' | 'modules' | 'sources'
export type DebugLayout = Partial<Record<DebugLayoutSection, boolean>>
const DEBUG_LAYOUT_CHANGED = 'nexgraph:debug-layout'
const layoutKey = (kind: DebugKind) => `nexgraph.debug.layout.${kind}`
const EMPTY_LAYOUT: DebugLayout = {}
let layoutCache: { kind: DebugKind; raw: string | null; value: DebugLayout } | null = null
function readDebugLayout(kind: DebugKind): DebugLayout {
  let raw: string | null = null
  try { raw = localStorage.getItem(layoutKey(kind)) } catch { /* chỉ là tuỳ chọn */ }
  if (layoutCache?.kind === kind && layoutCache.raw === raw) return layoutCache.value
  let value: DebugLayout = {}
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) value = parsed as DebugLayout
  } catch { /* chỉ là tuỳ chọn */ }
  layoutCache = { kind, raw, value }
  return value
}
const subscribeLayout = (notify: () => void) => {
  window.addEventListener(DEBUG_LAYOUT_CHANGED, notify)
  return () => window.removeEventListener(DEBUG_LAYOUT_CHANGED, notify)
}
export const useDebugLayout = (kind: DebugKind): DebugLayout => useSyncExternalStore(subscribeLayout, () => readDebugLayout(kind), () => EMPTY_LAYOUT)
export function setDebugSectionCollapsed(kind: DebugKind, section: DebugLayoutSection, collapsed: boolean): void {
  const layout = { ...readDebugLayout(kind) }
  if (collapsed) layout[section] = true
  else delete layout[section]
  try { localStorage.setItem(layoutKey(kind), JSON.stringify(layout)) } catch { /* chỉ là tuỳ chọn */ }
  layoutCache = null
  window.dispatchEvent(new Event(DEBUG_LAYOUT_CHANGED))
}

type State = {
  breakpoints: DebugBreakpoints
  at: { file: string; line: number } | null
  status: DebugStatus
  threadId: number
  frames: DebugFrame[]
  frameId: number | null
  scopes: ScopeView[]
  modules: DebugModule[]
  loadedSources: DebugLoadedSource[]
  moduleError: string | null
  sourceError: string | null
  watches: WatchView[]
  output: string[]
  error: string | null
  /** Cấu hình đang chọn; null = chạy tệp đang mở như trước. */
  config: ConfigRef | null
}
let state: State = { breakpoints: {}, at: null, status: 'idle', threadId: 0, frames: [], frameId: null, scopes: [], modules: [], loadedSources: [], moduleError: null, sourceError: null, watches: [], output: [], error: null, config: null }
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
  patch({ breakpoints: loadBreakpoints(id), watches: [], output: [], error: null, frames: [], scopes: [], modules: [], loadedSources: [], moduleError: null, sourceError: null, frameId: null, at: null, config: null,
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
    catch { patch({ error: tr('Không lưu được điểm dừng cho dự án') }) }
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


async function refreshInventory(current: number): Promise<void> {
  const debug = api()
  if (!debug) return
  if (generation === current) patch({ moduleError: null, sourceError: null })
  const [modules, loadedSources] = await Promise.all([
    debug.modules?.().catch((e: unknown) => { if (generation === current) patch({ modules: [], moduleError: errorText(e) }); return [] }) ?? [],
    debug.loadedSources?.().catch((e: unknown) => { if (generation === current) patch({ loadedSources: [], sourceError: errorText(e) }); return [] }) ?? []
  ])
  if (generation === current) patch({ modules, loadedSources })
}
const NOTICE_TEMPLATES: Record<string, string> = {
  'debug.modules_failed': 'Không lấy được modules: {detail}',
  'debug.sources_failed': 'Không lấy được nguồn đã tải: {detail}'
}
const noticeText = (event: Extract<DebugEvent, { type: 'notice' }>): string =>
  tr(event.code ? NOTICE_TEMPLATES[event.code] ?? event.code : event.text ?? '', { detail: event.detail ?? '' })
let listening = false
function listen() {
  const debug = api()
  if (listening || !debug) return
  listening = true
  debug.onEvent((event) => {
    if (switching) return
    if (event.type === 'output') return patch({ output: [...state.output.slice(-500), event.text] })
    if (event.type === 'notice') {
      const message = noticeText(event)
      if (event.target === 'modules') patch({ modules: [], moduleError: message })
      else patch({ loadedSources: [], sourceError: message })
      return
    }
    const request = ++frameRequest
    if (event.state === 'stopped') {
      patch({ status: 'stopped', threadId: event.threadId ?? 0, frames: [], scopes: [], frameId: null })
      void refreshInventory(generation)
      void debug.stackTrace(event.threadId ?? 0).then((frames) => {
        if (request !== frameRequest || state.status !== 'stopped') return
        patch({ frames })
        const top = frames.find((f) => f.file) ?? frames[0]
        if (top) void selectFrame(top)
      }).catch((e: unknown) => { if (request === frameRequest) patch({ error: errorText(e) }) })
      return
    }
    patch({ status: event.state === 'terminated' ? 'idle' : event.state, frames: [], scopes: [], modules: [], loadedSources: [], moduleError: null, sourceError: null, frameId: null, at: null,
      watches: state.watches.map((watch) => ({ ...watch, value: null, variablesReference: 0 })) })
  })
}

type Launch = (debug: NonNullable<NexGraphApi['debug']>, breakpoints: DebugBreakpoints) => Promise<void>

async function begin(projectId: string, launch: Launch): Promise<void> {
  if (project !== projectId) setDebugProject(projectId)
  const debug = api()
  if (!debug || state.status !== 'idle' || switching) return
  listen()
  const current = generation
  patch({ error: null, output: [], status: 'starting' })
  const initial = state.breakpoints
  const task = launch(debug, initial)
  starting = task
  try {
    await task
    if (generation === current) void refreshInventory(current)
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

export const selectDebugConfig = (config: ConfigRef | null): void => patch({ config })

/** F5 và nút ▶: cấu hình đã chọn nếu có, không thì tệp đang mở (cần `kind` và `file`). */
export function startDebugging(projectId: string, kind: DebugKind | null, file: string | null): Promise<void> {
  if (project !== projectId) setDebugProject(projectId)
  const config = state.config
  if (config) return begin(projectId, (debug, breakpoints) => debug.startConfig(projectId, config, file, breakpoints))
  if (kind && file) return begin(projectId, (debug, breakpoints) => debug.start(projectId, kind, file, breakpoints))
  return Promise.resolve()
}

export const attachDebugging = (projectId: string, kind: DebugKind, host: string, port: number): Promise<void> =>
  begin(projectId, (debug, breakpoints) => debug.attach(projectId, kind, host, port, breakpoints))

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
