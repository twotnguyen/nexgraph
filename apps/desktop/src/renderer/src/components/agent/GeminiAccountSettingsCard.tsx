import { useEffect, useRef, useState } from 'react'
import type { GeminiCliStatus } from '@shared/gemini-types'
import { Icon } from '../common/icons'
import { tr } from '../../strings'
import { errorMsg } from '../../state/errorText'
import { msgText, type Message } from '../../state/messages'

export function GeminiAccountSettingsCard({ active, disabled = false, onConnect, onApiKey, onDisconnected }: {
  active: boolean
  disabled?: boolean
  onConnect: () => void
  onApiKey: () => void
  onDisconnected: () => void
}) {
  const [status, setStatus] = useState<GeminiCliStatus | null>(null)
  const [error, setError] = useState<Message>('')
  const [busy, setBusy] = useState(false)
  const locked = busy || disabled
  const alive = useRef(true)
  const read = useRef(0)
  useEffect(() => {
    alive.current = true
    const refresh = async () => {
      const generation = ++read.current
      try {
        const next = await window.nexgraph.gemini.status()
        if (alive.current && generation === read.current) { setStatus(next); setError('') }
      } catch (e) { if (alive.current && generation === read.current) setError(errorMsg(e)) }
    }
    void refresh()
    const off = window.nexgraph.gemini.onEvent((event) => {
      if (event.type === 'status' && alive.current) { read.current++; setStatus(event.status); setError('') }
    })
    window.addEventListener('focus', refresh)
    return () => { alive.current = false; read.current++; off(); window.removeEventListener('focus', refresh) }
  }, [])
  const disconnect = async () => {
    if (locked) return
    setBusy(true); setError('')
    try {
      await window.nexgraph.gemini.disconnect()
      if (!alive.current) return
      const next = await window.nexgraph.gemini.status()
      if (alive.current) { setStatus(next); onDisconnected() }
    } catch (e) { if (alive.current) setError(errorMsg(e)) }
    finally { if (alive.current) setBusy(false) }
  }
  const summary = status?.state === 'error' ? tr('Cần kiểm tra lại kết nối') : status?.authenticated ? active ? tr('Đang dùng tài khoản Google') : tr('Đã có kết nối Google')
    : status?.state === 'not_installed' ? tr('Chưa thiết lập Antigravity CLI') : status?.state === 'unsupported_platform' ? tr('Cần kiểm tra công cụ trên máy')
      : status?.state === 'authenticating' ? tr('Đang chờ đăng nhập Google')
        : status ? tr('Chưa đăng nhập Google') : tr('Đang kiểm tra kết nối…')
  return <section className="workbench-panel settings-section" aria-labelledby="gemini-settings-title">
    <div className="gemini-settings-card"><div><h2 id="gemini-settings-title"><Icon name="spark" size={17} /> {tr('Gemini · Tài khoản Google')}</h2>
      <p className="muted">{tr('Kết nối tài khoản Google qua Antigravity CLI chính thức. Model và hạn mức do Google quyết định theo tài khoản.')}</p>
      <p className="small" aria-live="polite">{summary}</p></div>
      <div className="row"><button type="button" className="primary" disabled={locked} onClick={onConnect}>{status?.authenticated ? tr('Quản lý kết nối Google') : tr('Kết nối tài khoản Google')}</button>
        <button type="button" disabled={locked} onClick={onApiKey}>{tr('Dùng Gemini API key')}</button>
        {active && <button type="button" disabled={locked} onClick={() => void disconnect()}>{tr('Ngắt kết nối NexGraph')}</button>}</div>
    </div>
    <p className="muted small">{tr('Ngắt kết nối chỉ dừng trợ lý Google trong NexGraph. Tài khoản Google do Antigravity quản lý; lựa chọn API key dùng hạn mức riêng.')}</p>
    {(error || status?.error) && <p role="alert" className="inline-message error">{tr(msgText(error) || status?.error || '')}</p>}
  </section>
}
