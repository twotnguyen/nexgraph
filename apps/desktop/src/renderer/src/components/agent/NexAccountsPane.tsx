import { useCallback, useEffect, useRef, useState } from 'react'
import type { NexAccountMethod, NexAccountProvider, NexAccountsView, NexAuthStartView } from '@nexgraph/contracts/agent-types'
import { tr } from '../../strings'
import { errorMsg } from '../../state/errorText'
import type { Message } from '../../state/messages'
import { msg, msgText } from '../../state/messages'
import './nex-accounts.css'

/** Tên hiển thị tiếng Việt của nhà cung cấp; tên khác lấy từ sidecar. */
const NAMES: Record<string, string> = {
  openai: 'OpenAI / ChatGPT',
  anthropic: 'Anthropic / Claude',
  'claude-agent': 'Claude (Claude Code)',
  'github-copilot': 'GitHub Copilot',
  opencode: 'OpenCode Zen/Go',
  google: 'Google',
  xai: 'xAI',
  openrouter: 'OpenRouter',
  lmstudio: 'LM Studio'
}

const displayName = (provider: NexAccountProvider): string => NAMES[provider.id] ? tr(NAMES[provider.id]) : provider.name

/** Chọn một phương thức OAuth chính (bỏ các luồng legacy của ChatGPT). */
const primaryOAuth = (provider: NexAccountProvider) => {
  const oauth = provider.methods.filter((method) => method.type === 'oauth')
  return oauth.find((method) => !/legacy/i.test(method.label)) ?? oauth[0]
}
const keyMethod = (provider: NexAccountProvider) => provider.methods.find((method) => method.type === 'key')
const externalMethod = (provider: NexAccountProvider) => provider.methods.find((method) => method.type === 'external')

type Attempt = {
  providerId: string
  kind: 'oauth' | 'command'
  attemptId: string
  url?: string
  instructions?: string
  userCode?: string
  opened?: boolean
  blockedReason?: string
}

/**
 * Khối "Tài khoản AI cho Nex" trong màn kết nối: danh sách nhà cung cấp lấy từ sidecar,
 * đăng nhập/đăng xuất, chọn model mặc định. Token do sidecar lưu; renderer không nhận token.
 */
export function NexAccountsPane({ onConnected, onClose, onBusyChange }: {
  onConnected(): void
  onClose(): void
  onBusyChange(busy: boolean): void
}) {
  const [view, setView] = useState<NexAccountsView | null>(null)
  const [error, setError] = useState<Message | null>(null)
  const [notice, setNotice] = useState<Message | null>(null)
  const [hint, setHint] = useState<{ providerId: string; text: Message } | null>(null)
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [busy, setBusy] = useState(false)
  const [keyFor, setKeyFor] = useState<string | null>(null)
  const [keyValue, setKeyValue] = useState('')
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const alive = useRef(true)
  const operation = useRef(false)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false) }, [busy, onBusyChange])

  const load = useCallback(async () => {
    const next = await window.nexgraph.nex.accounts()
    if (alive.current) setView(next)
  }, [])

  const nameOfId = (id: string): string => {
    const provider = view?.providers.find((item) => item.id === id)
    return provider ? displayName(provider) : id
  }

  useEffect(() => { void load().catch((e) => { if (alive.current) setError(errorMsg(e)) }) }, [load])

  const run = async (action: () => Promise<void>) => {
    if (operation.current) return
    operation.current = true
    setBusy(true)
    setError(null)
    try { await action() } catch (e) { if (alive.current) setError(errorMsg(e)) }
    finally {
      operation.current = false
      if (alive.current) setBusy(false)
    }
  }

  // Theo dõi phiên đăng nhập đang chạy; sidecar tự poll nhà cung cấp, app chỉ hỏi trạng thái.
  useEffect(() => {
    if (!attempt) return
    let active = true
    const timer = setInterval(() => {
      void window.nexgraph.nex.authStatus(attempt.kind, attempt.providerId, attempt.attemptId).then(async (status) => {
        if (!active || !alive.current) return
        if (status.status === 'pending') return
        active = false
        setAttempt(null)
        if (status.status === 'complete') {
          setNotice(msg('Đã kết nối {name}', { name: nameOfId(attempt.providerId) }))
          setHint(null)
          await load()
        } else {
          setError(status.message ?? msg('Đăng nhập không thành công. Hãy thử lại.'))
        }
      }).catch((e) => {
        if (!active || !alive.current) return
        active = false
        setAttempt(null)
        setError(errorMsg(e))
      })
    }, 1_200)
    return () => { active = false; clearInterval(timer) }
  }, [attempt, load, view])

  /** Trường form hiển thị theo điều kiện `when` (ví dụ GitHub Enterprise URL chỉ khi chọn enterprise). */
  const fieldsFor = (provider: NexAccountProvider, method: NexAccountMethod) =>
    (method.form ?? []).filter((field) => !field.when?.length || field.when.every((condition) => {
      const dependency = method.form?.find((item) => item.key === condition.key)
      const value = formValues[`${provider.id}:${method.id}:${condition.key}`] ?? dependency?.options?.[0]?.value ?? ''
      return condition.op !== 'eq' || value === condition.value
    }))

  const start = (provider: NexAccountProvider, methodId: string) => void run(async () => {
    const method = provider.methods.find((item) => item.id === methodId)
    const fields = method ? fieldsFor(provider, method) : []
    const answers = fields.length
      ? Object.fromEntries(fields.flatMap((field) => {
          const value = formValues[`${provider.id}:${methodId}:${field.key}`] ?? field.options?.[0]?.value
          return value ? [[field.key, value]] : []
        }))
      : undefined
    const result: NexAuthStartView = await window.nexgraph.nex.authStart(provider.id, methodId, answers)
    if (result.kind === 'key') {
      setKeyFor(provider.id)
      setKeyValue('')
      return
    }
    if (result.kind === 'external') {
      setHint({ providerId: provider.id, text: result.instructions ?? msg('Đăng nhập bằng công cụ chính thức của nhà cung cấp.') })
      return
    }
    if (result.attemptId) {
      setHint(null)
      setAttempt({
        providerId: provider.id,
        kind: result.kind === 'command' ? 'command' : 'oauth',
        attemptId: result.attemptId,
        ...(result.url ? { url: result.url } : {}),
        ...(result.instructions ? { instructions: result.instructions } : {}),
        ...(result.userCode ? { userCode: result.userCode } : {}),
        ...(result.opened !== undefined ? { opened: result.opened } : {}),
        ...(result.blockedReason ? { blockedReason: result.blockedReason } : {})
      })
    }
  })

  const cancel = () => {
    const current = attempt
    setAttempt(null)
    if (current) void window.nexgraph.nex.authCancel(current.kind, current.providerId, current.attemptId).catch(() => {})
  }

  const logout = (provider: NexAccountProvider) => void run(async () => {
    if (attempt?.providerId === provider.id) cancel()
    await window.nexgraph.nex.logout(provider.id)
    setNotice(msg('Đã đăng xuất {name}', { name: displayName(provider) }))
    await load()
  })

  const saveKey = (provider: NexAccountProvider) => void run(async () => {
    await window.nexgraph.nex.saveKey(provider.id, keyValue)
    setKeyFor(null)
    setKeyValue('')
    setNotice(msg('Đã lưu API key cho {name}', { name: displayName(provider) }))
    await load()
  })

  const chooseModel = (provider: NexAccountProvider, id: string) => void run(async () => {
    await window.nexgraph.nex.selectModel(provider.id, id)
    await load()
    setNotice(id ? msg('Đã chọn model mặc định cho {name}', { name: displayName(provider) }) : msg('Đã bỏ model mặc định của {name}', { name: displayName(provider) }))
  })

  return (
    <div className="nex-accounts">
      <h3 className="nex-accounts-title">{tr('Tài khoản AI cho Nex')}</h3>
      <p className="muted">{tr('Đăng nhập bằng tài khoản gói hoặc API key. Nex lưu thông tin đăng nhập trong thư mục dữ liệu của NexGraph.')}</p>
      {error && <p role="alert" className="inline-message error">{msgText(error)}</p>}
      {notice && <p role="status" className="connection-success">{msgText(notice)}</p>}
      {!view && !error && <p className="muted" role="status">{tr('Đang tải danh sách nhà cung cấp…')}</p>}
      {view && !view.available && <p role="alert" className="inline-message error">
        {view.reason === 'no_runtime' ? tr('Chưa tìm thấy runtime Nex trên máy này.') : tr('Không khởi động được dịch vụ tài khoản Nex.')}
      </p>}
      {view?.available && <ul className="nex-account-list">
        {view.providers.map((provider) => {
          const oauth = primaryOAuth(provider)
          const external = externalMethod(provider)
          const key = keyMethod(provider)
          const selected = view.selected?.provider === provider.id ? view.selected.id : ''
          const activeAttempt = attempt?.providerId === provider.id ? attempt : null
          return <li key={provider.id} className="nex-account-row" data-provider={provider.id}>
            <div className="nex-account-head">
              <strong>{displayName(provider)}</strong>
              <span className={provider.connected ? 'nex-badge connected' : 'nex-badge'}>
                {provider.connected ? tr('Đã kết nối') : tr('Chưa kết nối')}
              </span>
            </div>
            {provider.connections.filter((connection) => connection.problem).map((connection) => <p key={connection.id || connection.label} role="status" className="inline-message error">
              {connection.problem?.message}
            </p>)}
            {oauth?.form?.length ? <div className="nex-account-form">
              {fieldsFor(provider, oauth).map((field) => {
                const formKey = `${provider.id}:${oauth.id}:${field.key}`
                const value = formValues[formKey] ?? field.options?.[0]?.value ?? ''
                return <label key={field.key}>{field.title}
                  {field.options?.length
                    ? <select aria-label={`${field.title} ${displayName(provider)}`} value={value}
                        onChange={(event) => setFormValues((current) => ({ ...current, [formKey]: event.target.value }))}>
                        {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    : <input aria-label={`${field.title} ${displayName(provider)}`} value={value}
                        onChange={(event) => setFormValues((current) => ({ ...current, [formKey]: event.target.value }))} />}
                </label>
              })}
            </div> : null}
            <div className="row">
              {oauth && <button type="button" className="primary" disabled={busy} aria-label={`${tr('Đăng nhập')} ${displayName(provider)}`}
                onClick={() => start(provider, oauth.id)}>{tr('Đăng nhập')}</button>}
              {external && <button type="button" className="primary" disabled={busy} aria-label={`${tr('Đăng nhập')} ${displayName(provider)}`}
                onClick={() => start(provider, external.id)}>{tr('Đăng nhập')}</button>}
              {key && !provider.connected && <button type="button" disabled={busy} aria-label={`${tr('Nhập API key')} ${displayName(provider)}`}
                onClick={() => { setKeyFor(provider.id); setKeyValue('') }}>{tr('Nhập API key')}</button>}
              {provider.connected && <button type="button" disabled={busy} aria-label={`${tr('Đăng xuất')} ${displayName(provider)}`}
                onClick={() => logout(provider)}>{tr('Đăng xuất')}</button>}
            </div>
            {hint?.providerId === provider.id && <div className="nex-account-hint" role="status">
              <p>{msgText(hint.text)}</p>
              <button type="button" disabled={busy} onClick={() => void run(load)}>{tr('Kiểm tra lại')}</button>
            </div>}
            {activeAttempt && <div className="nex-account-attempt" role="status">
              {activeAttempt.userCode && <p className="nex-device-code"><span>{tr('Mã xác nhận')}</span> <code>{activeAttempt.userCode}</code></p>}
              {activeAttempt.instructions && <p>{activeAttempt.instructions}</p>}
              {activeAttempt.url && <p><a href={activeAttempt.url} target="_blank" rel="noreferrer">{tr('Mở trang xác nhận')}</a></p>}
              {!activeAttempt.opened && <p className="muted small">{tr('Không mở được trình duyệt tự động. Hãy mở liên kết bên dưới.')}</p>}
              <p className="muted small">{tr('Đang chờ xác nhận trong trình duyệt…')}</p>
              <button type="button" onClick={cancel}>{tr('Huỷ')}</button>
            </div>}
            {keyFor === provider.id && <div className="field">
              <label htmlFor={`nex-key-${provider.id}`}>{tr('API key')}</label>
              <input id={`nex-key-${provider.id}`} type="password" autoComplete="off" value={keyValue}
                onChange={(event) => setKeyValue(event.target.value)} />
              <div className="row">
                <button type="button" className="primary" disabled={busy || !keyValue.trim()} onClick={() => saveKey(provider)}>{tr('Lưu API key')}</button>
                <button type="button" disabled={busy} onClick={() => { setKeyFor(null); setKeyValue('') }}>{tr('Huỷ')}</button>
              </div>
            </div>}
            {provider.models.length > 0 && <label className="field nex-model">
              <span>{tr('Model mặc định')}</span>
              <select aria-label={`${tr('Model mặc định')} ${displayName(provider)}`} disabled={busy || !provider.connected}
                value={selected} onChange={(event) => chooseModel(provider, event.target.value)}>
                <option value="">{tr('Chọn model')}</option>
                {provider.models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
              </select>
            </label>}
          </li>
        })}
      </ul>}
      <footer className="connection-footer">
        <button type="button" onClick={onClose}>{tr('Đóng')}</button>
        <button type="button" className="primary" disabled={busy} onClick={onConnected}>{tr('Dùng kết nối')}</button>
      </footer>
    </div>
  )
}
