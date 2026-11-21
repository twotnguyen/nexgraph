import { useEffect, useState } from 'react'
import type { DebugVariable } from '@shared/api'
import { Icon } from '../common/icons'
import { debugStep, selectFrame, setDebugError, startDebugging, stopDebugging, toggleBreakpoint, useDebugState, type DebugKind } from '../../state/debugState'
import './debug-panel.css'
import { errorText } from '../../state/errorText'

export const debugKindOf = (file: string | undefined): DebugKind | null => (!file ? null : /\.(m|c)?js$/.test(file) ? 'node' : /\.py$/.test(file) ? 'python' : null)
const ADAPTER_LABEL: Record<DebugKind, string> = { node: 'js-debug (Node.js)', python: 'debugpy (Python)' }

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
  const kind = debugKindOf(target)
  useEffect(() => { void api?.adapterStatus().then(setInstalled).catch(() => {}) }, [api])

  if (!api) return <p className="dbg-empty muted">Gỡ lỗi không dùng được ở chế độ này.</p>
  const { status } = debug
  const needsAdapter = kind && installed && !installed[kind]
  const install = async () => {
    if (!kind) return
    setInstalling(true)
    setDebugError(null)
    try {
      await api.installAdapter(kind)
      setInstalled(await api.adapterStatus())
    } catch (e) {
      setDebugError(errorText(e))
    } finally {
      setInstalling(false)
    }
  }
  const breakpoints = Object.entries(debug.breakpoints).flatMap(([file, lines]) => lines.map((line) => ({ file, line })))

  return (
    <div className="debug-panel">
      <div className="dbg-toolbar" role="toolbar" aria-label="Điều khiển gỡ lỗi">
        {status === 'idle' || status === 'starting'
          ? <button type="button" className="dbg-btn dbg-run" disabled={!kind || !target || status === 'starting' || !!needsAdapter} title="Bắt đầu gỡ lỗi (F5)" aria-label="Bắt đầu gỡ lỗi" onClick={() => kind && target && void startDebugging(projectId, kind, target)}>▶</button>
          : <button type="button" className="dbg-btn" disabled={status !== 'stopped'} title="Chạy tiếp (F5)" aria-label="Chạy tiếp" onClick={() => debugStep('continue')}>▶</button>}
        <button type="button" className="dbg-btn" disabled={status !== 'stopped'} title="Bước qua (F10)" aria-label="Bước qua" onClick={() => debugStep('next')}>↷</button>
        <button type="button" className="dbg-btn" disabled={status !== 'stopped'} title="Bước vào (F11)" aria-label="Bước vào" onClick={() => debugStep('stepIn')}>↓</button>
        <button type="button" className="dbg-btn" disabled={status !== 'stopped'} title="Bước ra (⇧F11)" aria-label="Bước ra" onClick={() => debugStep('stepOut')}>↑</button>
        <button type="button" className="dbg-btn dbg-stop" disabled={status === 'idle'} title="Dừng (⇧F5)" aria-label="Dừng gỡ lỗi" onClick={stopDebugging}>■</button>
        <span className="dbg-status muted" role="status">{status === 'idle' ? '' : status === 'starting' ? 'Đang khởi động…' : status === 'running' ? 'Đang chạy' : 'Đang dừng'}</span>
      </div>
      <p className="dbg-target">{target ? <><b>{target}</b> <span className="muted">· {kind ? ADAPTER_LABEL[kind] : 'chỉ gỡ lỗi được tệp .js, .mjs, .cjs, .py'}</span></> : <span className="muted">Mở một tệp .js hoặc .py rồi bấm chạy.</span>}</p>
      {needsAdapter && (
        <div className="dbg-install">
          <span>Cần tải {ADAPTER_LABEL[kind]} (mã nguồn mở, MIT) về thư mục dữ liệu của app.</span>
          <button type="button" className="primary" disabled={installing} onClick={() => void install()}>{installing ? 'Đang tải…' : 'Tải về'}</button>
        </div>
      )}
      {debug.error && <p role="alert" className="dbg-error">{debug.error}</p>}
      <section aria-label="Ngăn xếp gọi"><h3>Ngăn xếp gọi</h3>
        <ul className="dbg-list">{debug.frames.map((f) => (
          <li key={f.id}><button type="button" className="dbg-frame" aria-current={f.id === debug.frameId || undefined} onClick={() => void selectFrame(f)}>
            <span>{f.name}</span><span className="muted">{f.file ? `${f.file.split('/').pop()}:${f.line}` : 'ngoài dự án'}</span>
          </button></li>
        ))}</ul>
      </section>
      <section aria-label="Biến"><h3>Biến</h3>
        {debug.scopes.map((scope) => (
          <div key={scope.variablesReference}>
            <p className="dbg-scope muted">{scope.name}</p>
            <ul className="dbg-list">{scope.vars.map((v) => <VariableRow key={v.name} variable={v} depth={0} />)}</ul>
          </div>
        ))}
      </section>
      <section aria-label="Điểm dừng"><h3>Điểm dừng</h3>
        {breakpoints.length === 0 && <p className="dbg-empty muted">Bấm lề trái của editor để đặt điểm dừng.</p>}
        <ul className="dbg-list">{breakpoints.map((b) => (
          <li key={`${b.file}:${b.line}`} className="dbg-bp">
            <button type="button" className="dbg-frame" onClick={() => onOpenFile(b.file, b.line)}><span className="dbg-dot" />{b.file.split('/').pop()}<span className="muted">:{b.line}</span></button>
            <button type="button" className="dbg-remove" aria-label={`Bỏ điểm dừng ${b.file}:${b.line}`} onClick={() => toggleBreakpoint(b.file, b.line)}><Icon name="close" size={11} /></button>
          </li>
        ))}</ul>
      </section>
      {debug.output.length > 0 && <section aria-label="Đầu ra"><h3>Đầu ra</h3><pre className="dbg-output">{debug.output.join('')}</pre></section>}
    </div>
  )
}
