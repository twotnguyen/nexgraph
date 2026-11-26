import { tr } from '../../i18n/strings'
import { useEffect, useRef, useState } from 'react'
import type { DebugBreakpoint } from '@nexgraph/contracts/api'
import './breakpoint-form.css'

export function BreakpointForm({ point, focus = 'condition', onSave, onCancel }: {
  point?: DebugBreakpoint
  focus?: 'condition' | 'logMessage'
  onSave: (changes: Partial<DebugBreakpoint>) => void
  onCancel: () => void
}) {
  const [condition, setCondition] = useState(point?.condition ?? '')
  const [hitCondition, setHitCondition] = useState(point?.hitCondition ?? '')
  const [logMessage, setLogMessage] = useState(point?.logMessage ?? '')
  const initial = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const frame = requestAnimationFrame(() => initial.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])
  return <form className="breakpoint-form" aria-label={tr('Sửa điểm dừng')} onSubmit={(event) => {
    event.preventDefault()
    onSave({ condition: condition.trim() || undefined, hitCondition: hitCondition.trim() || undefined, logMessage: logMessage.trim() || undefined })
  }} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel() } }}>
    <label>{tr('Điều kiện')} <input ref={focus === 'condition' ? initial : undefined} value={condition} onChange={(event) => setCondition(event.target.value)} placeholder={tr('Ví dụ: n == 2')} /></label>
    <label>{tr('Số lần chạm')} <input value={hitCondition} onChange={(event) => setHitCondition(event.target.value)} placeholder={tr('Ví dụ: 3')} /></label>
    <label>{tr('Log point')} <input ref={focus === 'logMessage' ? initial : undefined} value={logMessage} onChange={(event) => setLogMessage(event.target.value)} placeholder={tr('Ví dụ: n={n}')} /></label>
    <div><button type="button" onClick={onCancel}>{tr('Huỷ')}</button><button type="submit">{tr('Lưu điểm dừng')}</button></div>
  </form>
}
