import { useEffect, useRef, useState } from 'react'
import type { AuthEventView, ModelInfo } from '@shared/agent-types'
import { consentTargetForSettings } from '@shared/agent-types'
import type { GeminiCliStatus, GeminiConnectionTest } from '@shared/gemini-types'
import { Icon } from '../common/icons'
import { AuthLinks } from './AuthLinks'

const messageOf = (error: unknown): string => error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
const modelLabel = (model: string): string => model === 'auto' || !model ? 'Tự động' : model
const steps = ['Công cụ', 'Đăng nhập', 'Kiểm tra', 'Sẵn sàng']
type Verified = { connectionId: string; model: string; result: GeminiConnectionTest }

export function GeminiConnectionPane({ projectId, onConnected, onClose, onBusyChange }: {
  projectId?: string
  onConnected: () => void
  onClose: () => void
  onBusyChange?: (busy: boolean) => void
}) {
  const [status, setStatus] = useState<GeminiCliStatus | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [authEvent, setAuthEvent] = useState<AuthEventView | null>(null)
  const [verified, setVerified] = useState<Verified | null>(null)
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState('')
  const [operation, setOperation] = useState<'setup' | 'login' | 'test' | 'model' | 'finish' | null>(null)
  const alive = useRef(true)
  const pending = useRef<typeof operation>(null)
  const read = useRef(0)
  const modelRead = useRef(0)
  const currentStatus = useRef<GeminiCliStatus | null>(null)
  const apply = (next: GeminiCliStatus) => {
    if (!alive.current) return
    if (!next.authenticated || currentStatus.current?.connectionId !== next.connectionId) { modelRead.current++; setModels([]) }
    currentStatus.current = next
    setStatus(next)
    setVerified((value) => value && (!next.authenticated || next.state === 'error' || value.connectionId !== next.connectionId || value.model !== next.model) ? null : value)
  }
  const loadModels = async (connectionId: string) => {
    const which = ++modelRead.current
    try {
      const available = await window.nexgraph.gemini.models()
      if (alive.current && which === modelRead.current && currentStatus.current?.authenticated && currentStatus.current.connectionId === connectionId) setModels(available)
    } catch (e) {
      if (alive.current && which === modelRead.current && currentStatus.current?.connectionId === connectionId) throw e
    }
  }
  const load = async () => {
    const which = ++read.current
    try {
      const next = await window.nexgraph.gemini.status()
      if (!alive.current) return null
      if (which === read.current) apply(next)
      const latest = currentStatus.current
      if (latest?.authenticated) await loadModels(latest.connectionId)
      return currentStatus.current
    } catch (e) {
      if (!alive.current || which !== read.current) return null
      throw e
    }
  }
  useEffect(() => {
    alive.current = true
    void load().catch((e) => { if (alive.current) setError(messageOf(e)) })
    const off = window.nexgraph.gemini.onEvent((event) => {
      if (!alive.current) return
      if (event.type === 'status') { read.current++; apply(event.status) }
      else setAuthEvent(event.event)
    })
    return () => {
      alive.current = false
      read.current++
      modelRead.current++
      off()
      if (pending.current === 'login') void window.nexgraph.gemini.loginCancel().catch(() => {})
    }
  }, [])
  useEffect(() => {
    if (status?.authenticated) void loadModels(status.connectionId).catch((e) => { if (alive.current) setError(messageOf(e)) })
  }, [status?.authenticated, status?.connectionId])
  const busy = operation !== null
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false) }, [busy, onBusyChange])
  const run = async (kind: NonNullable<typeof operation>, action: () => Promise<void>) => {
    if (pending.current) return
    pending.current = kind
    read.current++
    setOperation(kind); setError('')
    try { await action() } catch (e) { if (alive.current) setError(messageOf(e)) }
    finally {
      pending.current = null
      if (alive.current) setOperation(null)
    }
  }
  const setup = () => void run('setup', async () => {
    apply(await window.nexgraph.gemini.setup())
    await load()
  })
  const login = () => void run('login', async () => {
    setAuthEvent(null); setVerified(null); setConsent(false)
    apply(await window.nexgraph.gemini.login())
    await load()
  })
  const probe = () => void run('test', async () => {
    setVerified(null); setConsent(false)
    const before = await window.nexgraph.gemini.status()
    if (!before.authenticated) throw new Error('Hãy đăng nhập Google trước khi kiểm tra kết nối.')
    const result = await window.nexgraph.gemini.test()
    const after = await window.nexgraph.gemini.status()
    if (!alive.current) return
    apply(after)
    if (!after.authenticated || before.connectionId !== after.connectionId || before.model !== after.model)
      throw new Error('Kết nối Google đã thay đổi. Hãy kiểm tra lại trước khi sử dụng.')
    if (!result.ok) throw new Error(result.message)
    if (!result.capabilities?.streaming || !result.capabilities.tools)
      throw new Error('Chưa xác nhận được cả trả lời trực tiếp và công cụ. Hãy kiểm tra lại kết nối Gemini.')
    setVerified({ connectionId: after.connectionId, model: after.model, result })
  })
  const finish = () => void run('finish', async () => {
    if (!verified || projectId && !consent) return
    const latest = await window.nexgraph.gemini.status()
    if (!alive.current) return
    apply(latest)
    if (!latest.authenticated || latest.state === 'error' || latest.connectionId !== verified.connectionId || latest.model !== verified.model) {
      setVerified(null); setConsent(false)
      throw new Error('Kết nối Google đã thay đổi. Hãy kiểm tra lại trước khi sử dụng.')
    }
    await window.nexgraph.gemini.activate()
    const settings = await window.nexgraph.ai.getSettings()
    const target = consentTargetForSettings(settings)
    if (target?.runtime !== 'antigravity-cli' || target.connectionId !== verified.connectionId || settings.model !== verified.model) {
      setVerified(null); setConsent(false)
      throw new Error('Kết nối đang chọn khác kết nối đã kiểm tra. Hãy thử lại.')
    }
    if (projectId) await window.nexgraph.ai.grantConsent(projectId, target)
    if (alive.current) onConnected()
  })
  const chooseModel = (id: string) => void run('model', async () => {
    setVerified(null); setConsent(false)
    await window.nexgraph.gemini.selectModel(id)
    await load()
  })
  const cancelLogin = () => {
    setAuthEvent(null)
    void window.nexgraph.gemini.loginCancel().catch((e) => { if (alive.current) setError(messageOf(e)) })
  }
  const refresh = () => {
    setError('')
    void load().catch((e) => { if (alive.current) setError(messageOf(e)) })
  }
  const authenticated = status?.authenticated === true
  const needsSetup = status?.state === 'not_installed' || status?.state === 'error' && !status.installed && status.platformSupported
  const authenticating = operation === 'login' || status?.state === 'authenticating'
  const connectionError = status?.state === 'error' && !authenticating
  const ready = !!verified && authenticated && verified.connectionId === status.connectionId && verified.model === status.model
  const step = !status || needsSetup || operation === 'setup' ? 0 : !authenticated ? 1 : ready ? 3 : 2
  const heading = !status ? 'Đang kiểm tra công cụ' : status.state === 'unsupported_platform' ? 'Chưa hỗ trợ hệ điều hành này'
    : status.state === 'not_installed' ? 'Thiết lập Antigravity CLI' : operation === 'setup' || status.state === 'installing' ? 'Đang chuẩn bị Antigravity CLI'
      : authenticating ? 'Hoàn tất đăng nhập trong trình duyệt' : connectionError ? 'Cần kiểm tra lại kết nối' : ready ? 'Gemini đã sẵn sàng' : authenticated ? 'Google đã kết nối' : 'Đăng nhập tài khoản Google'
  const detail = !status ? 'Kiểm tra công cụ và cấu hình kết nối trên máy này.' : status.state === 'unsupported_platform'
    ? 'Chưa có bản Antigravity CLI được hỗ trợ cho máy này. Bạn vẫn có thể chọn Gemini API key.' : status.state === 'not_installed'
      ? 'NexGraph sẽ chuẩn bị bản Antigravity CLI chính thức được hỗ trợ trên máy này.' : authenticating
        ? 'Hoàn tất đăng nhập Google qua Antigravity, sau đó quay lại NexGraph.' : connectionError
          ? status.installed ? 'Kiểm tra lại kết nối hoặc đăng nhập lại Google để xác nhận phiên tài khoản.' : 'Thiết lập lại Antigravity CLI hoặc kiểm tra kết nối mạng để tiếp tục.' : ready
          ? 'Đã kiểm tra trả lời trực tiếp và công cụ. Bạn có thể bắt đầu một cuộc trò chuyện.' : authenticated
            ? 'Kiểm tra kết nối và công cụ trước khi bắt đầu. Hạn mức do Google áp dụng theo tài khoản.'
            : 'Antigravity CLI chính thức quản lý đăng nhập và hạn mức tài khoản Google.'
  const errorText = error || status?.error
  return <div className="gemini-setup">
    <ol className="gemini-steps" aria-label="Các bước kết nối Gemini">
      {steps.map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined} data-complete={index < step || undefined}>
        <span className="gemini-step-number">{index < step ? <Icon name="check" size={11} /> : index + 1}</span><span>{label}</span>
      </li>)}
    </ol>
    <div className="gemini-setup-status" data-ready={ready || undefined} role="status">
      <Icon name={ready || authenticated ? 'check' : busy || !status ? 'refresh' : needsSetup ? 'plug' : 'spark'} size={20} />
      <div><h3>{heading}</h3><small>{detail}</small>{status?.installed && <small>Antigravity CLI {status.version}</small>}</div>
    </div>
    {errorText && <p role="alert" className="inline-message error">{errorText}</p>}
    {errorText && !busy && <div className="row"><button type="button" onClick={refresh}>Kiểm tra lại kết nối</button></div>}
    {(operation === 'setup' || status?.state === 'installing') && <div className="gemini-setup-progress"><progress aria-label="Đang thiết lập Antigravity CLI" /><small className="muted">Quá trình thiết lập có thể mất vài phút tùy kết nối mạng.</small></div>}
    {needsSetup && <div className="row"><button type="button" className="primary" disabled={busy || !status.platformSupported} onClick={setup}>Thiết lập Antigravity CLI</button>
      <button type="button" disabled={busy} onClick={refresh}>Kiểm tra lại</button></div>}
    {status?.installed && !authenticated && !authenticating && <div className="row"><button type="button" className="primary" disabled={busy} onClick={login}>Đăng nhập Google</button>
      <button type="button" disabled={busy} onClick={refresh}>Kiểm tra lại</button></div>}
    {authenticating && <>
      {authEvent && <p className="connection-auth-status small">{authEvent.type === 'auth_url' ? authEvent.instructions : authEvent.type === 'device_code' ? `Mã xác nhận: ${authEvent.userCode}` : authEvent.message}</p>}
      <AuthLinks event={authEvent} />
      <div className="row"><button type="button" onClick={cancelLogin}>Hủy đăng nhập Google</button></div>
    </>}
    {status && authenticated && <>
      {models.length > 0 && <div className="field"><label htmlFor="gemini-account-model">Model Antigravity</label>
        <select id="gemini-account-model" value={status.model} disabled={busy || status.capabilities?.models === false} onChange={(event) => chooseModel(event.target.value)}>
          {!models.some((model) => model.id === status.model) && <option value={status.model}>{modelLabel(status.model)}</option>}
          {models.map((model) => <option key={model.id} value={model.id}>{model.id === 'auto' ? 'Tự động' : model.label}</option>)}
        </select></div>}
      <p className="gemini-setup-privacy">Tài khoản Google do Antigravity quản lý trên máy này. Hạn mức áp dụng theo tài khoản; API key là lựa chọn riêng.</p>
      <p className="gemini-setup-privacy">Nếu bạn đổi tài khoản Google ngoài NexGraph, hãy ngắt kết nối NexGraph rồi kết nối lại trước khi tiếp tục.</p>
      <div className="row"><button type="button" className={ready ? undefined : 'primary'} disabled={busy} onClick={probe}>{operation === 'test' ? 'Đang kiểm tra kết nối…' : 'Kiểm tra kết nối và công cụ'}</button>
        {connectionError && <button type="button" disabled={busy} onClick={login}>Đăng nhập lại Google</button>}</div>
      <p className="muted small">Bước kiểm tra gửi một yêu cầu thử nhỏ tới Gemini bằng tài khoản Google.</p>
    </>}
    {ready && <p role="status" className="connection-success">{verified.result.message}</p>}
    {projectId && ready && <label className="connection-check"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
      <span>Cho phép Antigravity CLI gửi ngữ cảnh và lịch sử hội thoại của dự án này tới Google bằng tài khoản Google hiện đang được Antigravity quản lý.</span></label>}
    <footer className="connection-footer"><button type="button" onClick={onClose}>Đóng</button>
      <button type="button" className="primary" disabled={busy || !ready || !!projectId && !consent} onClick={finish}>{operation === 'finish' ? 'Đang kết nối…' : 'Dùng tài khoản Google'}</button></footer>
  </div>
}
