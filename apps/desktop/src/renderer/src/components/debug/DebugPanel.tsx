import { tr } from '../../strings'
import { useEffect, useRef, useState } from 'react'
import type { DebugConfigInfo, DebugVariable } from '@nexgraph/contracts/api'
import { Icon } from '../common/icons'
import { addWatch, attachDebugging, clearAllBreakpoints, debugStep, evaluateConsole, pauseDebugging, removeWatch, restartDebugging, selectDebugConfig, selectFrame, setBreakpoint, setDebugError, startDebugging, stopDebugging, toggleBreakpoint, useDebugLayout, useDebugState, type ConfigRef, type DebugKind, type DebugLayoutSection } from '../../state/debugState'
import './debug-panel.css'
import { PaneStack, type PaneSection } from '../layout/PaneStack'
import { errorMsg } from '../../state/errorText'
import { msgText, type Message } from '../../state/messages'
import { BreakpointForm } from './BreakpointForm'

export const debugKindOf = (file: string | undefined): DebugKind | null => (!file ? null : /\.(m|c)?js$/.test(file) ? 'node' : /\.py$/.test(file) ? 'python' : null)
const ADAPTER_LABEL: Record<DebugKind, string> = { node: 'js-debug (Node.js)', python: 'debugpy (Python)' }
/** Mặc định khi để trống ô Attach: Node `--inspect` ở localhost:9229, `debugpy.listen` ở 127.0.0.1:5678 (như Wu và các adapter). */
const ATTACH_DEFAULT: Record<DebugKind, { host: string; port: number }> = { node: { host: 'localhost', port: 9229 }, python: { host: '127.0.0.1', port: 5678 } }
const configKey = (config: ConfigRef) => `${config.source}\n${config.name}`

/** Một biến; có con thì bấm để mở (đọc biến con theo variablesReference khi mở). */
function VariableRow({ variable, depth }: { variable: DebugVariable; depth: number }) {
  const [children, setChildren] = useState<DebugVariable[] | null>(null)
  const open = children !== null
  const toggle = async () => {
    if (open) return setChildren(null)
    setChildren(await window.nexgraph.debug!.variables(variable.variablesReference).catch(() => []))
  }
  return (
    <li>
      <button type="button" className="dbg-var" style={{ paddingLeft: 10 + depth * 12 }} disabled={!variable.variablesReference} aria-expanded={variable.variablesReference ? open : undefined} onClick={() => void toggle()}>
        <span className="dbg-twisty">{variable.variablesReference ? (open ? '▾' : '▸') : ''}</span>
        <span className="dbg-var-name">{variable.name}</span><span className="dbg-var-value" title={variable.value}>{variable.value}</span>
      </button>
      {open && <ul>{children.map((child) => <VariableRow key={child.name} variable={child} depth={depth + 1} />)}</ul>}
    </li>
  )
}

/**
 * Bảng Gỡ lỗi kiểu Wu: chạy tệp đang mở (Node hoặc Python), F5 chạy/tiếp, F10 bước qua, F11 bước vào, ⇧F11 bước ra, ⇧F5 dừng;
 * ngăn xếp gọi, biến theo phạm vi, danh sách điểm dừng và đầu ra. Phiên nằm ở state/debugState nên đóng bảng không mất phiên.
 */
export function DebugPanel({ projectId, target, onOpenFile }: { projectId: string; target?: string; onOpenFile: (file: string, line: number) => void }) {
  const api = window.nexgraph.debug
  const debug = useDebugState()
  const [installed, setInstalled] = useState<Record<DebugKind, boolean> | null>(null)
  const [installing, setInstalling] = useState(false)
  const [editing, setEditing] = useState<{ file: string; line: number } | null>(null)
  const [watch, setWatch] = useState('')
  const [expression, setExpression] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [draft, setDraft] = useState('')
  const [configs, setConfigs] = useState<DebugConfigInfo[] | null>(null)
  const [configError, setConfigError] = useState<Message | null>(null)
  const [attachKind, setAttachKind] = useState<DebugKind>('node')
  const [attachHost, setAttachHost] = useState('')
  const [attachPort, setAttachPort] = useState('')
  const loadConfigs = () => api?.configs(projectId).then((list) => { setConfigs(list); setConfigError(null) }, (e: unknown) => setConfigError(errorMsg(e)))
  const output = useRef<HTMLPreElement>(null)
  const kind = debugKindOf(target)
  const layout = useDebugLayout(kind ?? 'node')
  useEffect(() => { void api?.adapterStatus().then(setInstalled).catch(() => {}) }, [api])
  useEffect(() => { if (output.current) output.current.scrollTop = output.current.scrollHeight }, [debug.output, layout.collapsed.console])
  useEffect(() => { void loadConfigs() }, [api, projectId]) // eslint-disable-line react-hooks/exhaustive-deps
  // Cấu hình đã chọn không còn trong tệp (đổi tên, xoá): bỏ chọn để F5 không chạy cấu hình không tồn tại.
  useEffect(() => {
    const chosen = debug.config
    if (configs && chosen && !configs.some((item) => configKey(item) === configKey(chosen))) selectDebugConfig(null)
  }, [configs]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!api) return <p className="dbg-empty muted">{tr('Gỡ lỗi không dùng được ở chế độ này.')}</p>
  const { status } = debug
  const chosen = debug.config
  const list = configs ?? []
  const selected = chosen ? list.find((item) => configKey(item) === configKey(chosen)) : undefined
  const runKind = selected ? selected.kind : kind
  // Python attach nối thẳng vào adapter của tiến trình đích (debugpy.listen) nên không cần tải debugpy.
  const needsAdapter = runKind && installed && !installed[runKind] && !(runKind === 'python' && selected?.request === 'attach') ? runKind : null
  const nodeAttachBlocked = attachKind === 'node' && !!installed && !installed.node
  const install = async (adapter: DebugKind) => {
    setInstalling(true)
    setDebugError(null)
    try {
      await api.installAdapter(adapter)
      setInstalled(await api.adapterStatus())
    } catch (e) {
      setDebugError(errorMsg(e))
    } finally {
      setInstalling(false)
    }
  }
  const banner = (adapter: DebugKind) => (
    <div className="dbg-install">
      <span>{tr('Cần tải {adapter} (mã nguồn mở, MIT) về thư mục dữ liệu của app.', { adapter: ADAPTER_LABEL[adapter] })}</span>
      <button type="button" className="primary" disabled={installing} onClick={() => void install(adapter)}>{installing ? tr('Đang tải…') : tr('Tải về')}</button>
    </div>
  )
  // Mở tệp cấu hình (tạo .vscode/launch.json mẫu nếu dự án chưa có) rồi đọc lại danh sách.
  const openConfigFile = async () => {
    try {
      onOpenFile(await api.configFile(projectId), 1)
      void loadConfigs()
    } catch (e) { setConfigError(errorMsg(e)) }
  }
  const attach = () => void attachDebugging(projectId, attachKind, attachHost.trim() || ATTACH_DEFAULT[attachKind].host, Number(attachPort.trim() || ATTACH_DEFAULT[attachKind].port))
  const breakpoints = Object.entries(debug.breakpoints).sort(([a], [b]) => a.localeCompare(b)).flatMap(([file, points]) => points.map((point) => ({ file, ...point })))
  const sections: PaneSection<DebugLayoutSection>[] = [
    { id: 'stack', title: 'Ngăn xếp gọi', children: <>
      <ul className="dbg-list">{debug.frames.map((f) => (
        <li key={f.id}><button type="button" className="dbg-frame" aria-current={f.id === debug.frameId || undefined} onClick={() => void selectFrame(f)}>
          <span>{f.name}</span><span className="muted">{f.file ? `${f.file.split('/').pop()}:${f.line}` : tr('ngoài dự án')}</span>
        </button></li>
      ))}</ul>
    </> },
    { id: 'watches', title: 'Theo dõi', children: <>
      <ul className="dbg-list">{debug.watches.map((item) => (
        <li key={item.expression} className="dbg-watch">
          <span className="dbg-watch-value" title={item.value ?? ''}><b>{item.expression}</b>: {item.value ?? '—'}</span>
          <button type="button" className="dbg-remove" aria-label={tr('Bỏ theo dõi {expression}', { expression: item.expression })} onClick={() => removeWatch(item.expression)}><Icon name="close" size={11} /></button>
        </li>
      ))}</ul>
      <form className="dbg-input" onSubmit={(event) => { event.preventDefault(); addWatch(watch); setWatch('') }}>
        <input aria-label={tr('Thêm biểu thức theo dõi')} placeholder={tr('Thêm biểu thức theo dõi')} value={watch} onChange={(event) => setWatch(event.target.value)} />
        <button type="submit" aria-label={tr('Thêm biểu thức theo dõi')} title={tr('Thêm biểu thức theo dõi')}>+</button>
      </form>
    </> },
    { id: 'variables', title: 'Biến', children: <>
      {debug.scopes.map((scope) => (
        <div key={scope.variablesReference}>
          <p className="dbg-scope muted">{scope.name}</p>
          <ul className="dbg-list">{scope.vars.map((v) => <VariableRow key={v.name} variable={v} depth={0} />)}</ul>
        </div>
      ))}
    </> },
    { id: 'modules', title: 'Modules', children: <>
      {debug.moduleError && <p role="alert" className="dbg-error">{msgText(debug.moduleError)}</p>}
      {!debug.modules.length && !debug.moduleError && <p className="dbg-empty muted">{tr('Adapter không cung cấp danh sách module.')}</p>}
      <ul className="dbg-list">{debug.modules.map((module) => (
        <li key={module.id} className="dbg-scope" title={module.path ?? undefined}>{module.name}{module.version ? ` · ${module.version}` : ''}</li>
      ))}</ul>
    </> },
    { id: 'sources', title: 'Nguồn đã tải', children: <>
      {debug.sourceError && <p role="alert" className="dbg-error">{msgText(debug.sourceError)}</p>}
      {!debug.loadedSources.length && !debug.sourceError && <p className="dbg-empty muted">{tr('Adapter không cung cấp danh sách nguồn.')}</p>}
      <ul className="dbg-list">{debug.loadedSources.map((source, index) => (
        <li key={source.sourceReference ?? source.path ?? source.name ?? index} className="dbg-scope" title={source.path ?? undefined}>{source.path ?? source.name ?? tr('(nguồn không tên)')}</li>
      ))}</ul>
    </> },
    { id: 'breakpoints', title: 'Điểm dừng', actions: <button type="button" className="dbg-btn" disabled={!breakpoints.length} title={tr('Xoá tất cả điểm dừng')} aria-label={tr('Xoá tất cả điểm dừng')} onClick={clearAllBreakpoints}><Icon name="trash" size={13} /></button>, children: <>
      {breakpoints.length === 0 && <p className="dbg-empty muted">{tr('Bấm lề trái của editor để đặt điểm dừng.')}</p>}
      <ul className="dbg-list">{breakpoints.map((b) => (
        <li key={`${b.file}:${b.line}`}>
          <div className="dbg-bp">
            <input type="checkbox" checked={b.enabled} aria-label={tr('Bật điểm dừng {file}:{line}', { file: b.file, line: b.line })} onChange={(event) => setBreakpoint(b.file, b.line, { enabled: event.target.checked })} />
            <button type="button" className="dbg-frame" title={b.file} onClick={() => onOpenFile(b.file, b.line)}>
              <span className={`dbg-dot${b.logMessage ? ' dbg-dot-log' : ''}`} />{b.file.split('/').pop()}<span className="muted">:{b.line}</span>
            </button>
            <button type="button" className="dbg-remove" aria-label={tr('Sửa điểm dừng {file}:{line}', { file: b.file, line: b.line })} title={tr('Sửa điểm dừng')} onClick={() => setEditing({ file: b.file, line: b.line })}><Icon name="pencil" size={11} /></button>
            <button type="button" className="dbg-remove" aria-label={tr('Bỏ điểm dừng {file}:{line}', { file: b.file, line: b.line })} onClick={() => toggleBreakpoint(b.file, b.line)}><Icon name="close" size={11} /></button>
          </div>
          {(b.condition || b.hitCondition || b.logMessage) && <p className="dbg-bp-info muted">{[b.condition && tr('Điều kiện: {condition}', { condition: b.condition }), b.hitCondition && tr('Số lần: {count}', { count: b.hitCondition }), b.logMessage && tr('Log: {message}', { message: b.logMessage })].filter(Boolean).join(' · ')}</p>}
          {editing?.file === b.file && editing.line === b.line && <BreakpointForm point={b} onSave={(changes) => { setBreakpoint(b.file, b.line, changes); setEditing(null) }} onCancel={() => setEditing(null)} />}
        </li>
      ))}</ul>
    </> },
    { id: 'console', title: 'Debug console', children: <>
      <pre ref={output} className="dbg-output">{debug.output.join('')}</pre>
      <form className="dbg-input" onSubmit={(event) => {
        event.preventDefault()
        if (!expression.trim()) return
        evaluateConsole(expression)
        setHistory([...history, expression])
        setHistoryIndex(history.length + 1)
        setExpression('')
        setDraft('')
      }}>
        <input aria-label={tr('Tính biểu thức')} placeholder={tr('Tính biểu thức')} disabled={status !== 'stopped' || debug.frameId === null} value={expression}
          onChange={(event) => setExpression(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' && history.length) {
              event.preventDefault()
              if (historyIndex === history.length) setDraft(expression)
              const index = Math.max(0, historyIndex - 1)
              setHistoryIndex(index); setExpression(history[index])
            } else if (event.key === 'ArrowDown' && historyIndex < history.length) {
              event.preventDefault()
              const index = historyIndex + 1
              setHistoryIndex(index); setExpression(index === history.length ? draft : history[index])
            }
          }} />
        <button type="submit" disabled={status !== 'stopped' || debug.frameId === null} aria-label={tr('Tính biểu thức')}>↵</button>
      </form>
    </> }
  ]

  return (
    <div className="debug-panel">
      <div className="dbg-toolbar" role="toolbar" aria-label={tr('Điều khiển gỡ lỗi')}>
        {status === 'idle' || status === 'starting'
          ? <button type="button" className="dbg-btn dbg-run" disabled={(!chosen && (!kind || !target)) || status === 'starting' || !!needsAdapter} title={tr('Bắt đầu gỡ lỗi (F5)')} aria-label={tr('Bắt đầu gỡ lỗi')} onClick={() => void startDebugging(projectId, kind, target ?? null)}>▶</button>
          : status === 'running'
            ? <button type="button" className="dbg-btn" title={tr('Tạm dừng (F6)')} aria-label={tr('Tạm dừng')} onClick={pauseDebugging}>Ⅱ</button>
            : <button type="button" className="dbg-btn" title={tr('Chạy tiếp (F5)')} aria-label={tr('Chạy tiếp')} onClick={() => debugStep('continue')}>▶</button>}
        <button type="button" className="dbg-btn" disabled={status !== 'stopped'} title={tr('Bước qua (F10)')} aria-label={tr('Bước qua')} onClick={() => debugStep('next')}>↷</button>
        <button type="button" className="dbg-btn" disabled={status !== 'stopped'} title={tr('Bước vào (F11)')} aria-label={tr('Bước vào')} onClick={() => debugStep('stepIn')}>↓</button>
        <button type="button" className="dbg-btn" disabled={status !== 'stopped'} title={tr('Bước ra (⇧F11)')} aria-label={tr('Bước ra')} onClick={() => debugStep('stepOut')}>↑</button>
        <button type="button" className="dbg-btn" disabled={status !== 'running' && status !== 'stopped'} title={tr('Chạy lại (⇧⌘F5)')} aria-label={tr('Chạy lại phiên')} onClick={restartDebugging}>↻</button>
        <button type="button" className="dbg-btn dbg-stop" disabled={status === 'idle'} title={tr('Dừng (⇧F5)')} aria-label={tr('Dừng gỡ lỗi')} onClick={stopDebugging}>■</button>
        <span className="dbg-status muted" role="status">{status === 'idle' ? '' : status === 'starting' ? tr('Đang khởi động…') : status === 'running' ? tr('Đang chạy') : tr('Đang dừng')}</span>
      </div>
      <p className="dbg-target">{selected
        ? <><b>{selected.name}</b> <span className="muted">· {selected.request} · {ADAPTER_LABEL[selected.kind]}</span></>
        : target ? <><b>{target}</b> <span className="muted">· {kind ? ADAPTER_LABEL[kind] : tr('chỉ gỡ lỗi được tệp .js, .mjs, .cjs, .py')}</span></> : <span className="muted">{tr('Mở một tệp .js hoặc .py rồi bấm chạy.')}</span>}</p>
      {needsAdapter && banner(needsAdapter)}
      {debug.error && <p role="alert" className="dbg-error">{msgText(debug.error)}</p>}
      <section aria-label={tr('Cấu hình gỡ lỗi')}><div className="dbg-section-head"><h3>{tr('Cấu hình')}</h3>
        <div className="dbg-actions">
          <button type="button" className="dbg-btn" title={tr('Tải lại danh sách cấu hình')} aria-label={tr('Tải lại cấu hình')} onClick={() => void loadConfigs()}><Icon name="refresh" size={13} /></button>
          <button type="button" className="dbg-btn" title={tr('Mở tệp cấu hình (.vscode/launch.json; tạo mẫu nếu chưa có)')} aria-label={tr('Mở tệp cấu hình gỡ lỗi')} onClick={() => void openConfigFile()}><Icon name="pencil" size={13} /></button>
        </div></div>
        <select className="dbg-select" aria-label={tr('Cấu hình khởi chạy')} disabled={status !== 'idle'} value={selected ? configKey(selected) : ''}
          onChange={(event) => {
            const next = list.find((item) => configKey(item) === event.target.value)
            selectDebugConfig(next ? { source: next.source, name: next.name } : null)
          }}>
          <option value="">{tr('Chạy tệp đang mở')}</option>
          {list.map((item) => <option key={configKey(item)} value={configKey(item)} title={item.source}>{item.name} · {item.request}</option>)}
        </select>
        {configError && <p role="alert" className="dbg-error">{msgText(configError)}</p>}
      </section>
      {status === 'idle' && (
        <section aria-label={tr('Attach vào tiến trình')}><h3>{tr('Attach')}</h3>
          <form className="dbg-input dbg-attach" onSubmit={(event) => { event.preventDefault(); attach() }}>
            <select aria-label={tr('Loại tiến trình')} value={attachKind} onChange={(event) => setAttachKind(event.target.value as DebugKind)}>
              <option value="node">Node.js</option><option value="python">Python</option>
            </select>
            <input aria-label={tr('Địa chỉ')} placeholder={ATTACH_DEFAULT[attachKind].host} value={attachHost} onChange={(event) => setAttachHost(event.target.value)} />
            <input aria-label={tr('Cổng')} className="dbg-port" inputMode="numeric" placeholder={String(ATTACH_DEFAULT[attachKind].port)} value={attachPort} onChange={(event) => setAttachPort(event.target.value)} />
            <button type="submit" disabled={nodeAttachBlocked}>{tr('Attach')}</button>
          </form>
          <p className="dbg-empty muted">{attachKind === 'node' ? tr('Chạy tiến trình bằng node --inspect (cổng mặc định 9229).') : tr('Mã Python cần gọi debugpy.listen(5678) (cổng mặc định 5678).')}</p>
          {nodeAttachBlocked && needsAdapter !== 'node' && banner('node')}
        </section>
      )}
      <PaneStack sections={sections} state={layout} onToggle={layout.toggle} onResize={layout.setHeight} />
    </div>
  )
}
