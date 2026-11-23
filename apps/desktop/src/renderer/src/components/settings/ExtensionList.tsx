import { useState } from 'react'
import { installExtension, removeExtension, useExtensions } from '../../state/extensions'
import { errorText } from '../../state/errorText'
import { tr } from '../../strings'
import { msg, msgText, type Message } from '../../state/messages'

/** Trang Extension trong Cài đặt: danh sách đã cài (theme, lệnh), nút cài từ thư mục, gỡ, lỗi manifest. */
export function ExtensionList() {
  const { extensions, errors, error } = useExtensions()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setMessage(null)
    try { await work() } catch (e) { setMessage(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <div className="extension-list">
      <div className="row">
        <button type="button" className="primary" disabled={busy || !window.nexgraph.extensions} onClick={() => void act(async () => {
          const ext = await installExtension()
          if (ext) setMessage(msg('Đã cài {name} {version}', { name: ext.name, version: ext.version }))
        })}>{tr('Cài từ thư mục…')}</button>
        {message && <span role="status" className="muted">{msgText(message)}</span>}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {extensions.length === 0 && <p className="muted">{tr('Chưa cài extension nào.')}</p>}
      <ul>
        {extensions.map((ext) => (
          <li key={ext.id}>
            <div>
              <b>{ext.name}</b> <span className="muted">{ext.version} · {ext.id}</span>
              {ext.description && <p className="muted">{ext.description}</p>}
              <p className="muted">
                {ext.themes.length > 0 && <>{tr('Theme: {names}.', { names: ext.themes.map((t) => t.name).join(', ') })}{' '}</>}
                {ext.commands.length > 0 && <>{tr('Lệnh: {titles}.', { titles: ext.commands.map((c) => c.title).join(', ') })}</>}
              </p>
            </div>
            <button type="button" disabled={busy} onClick={() => void act(() => removeExtension(ext.id))}>{tr('Gỡ')}</button>
          </li>
        ))}
        {errors.map((e) => (
          <li key={e.folder} className="extension-error"><div><b>{e.folder}</b><p role="alert" className="error">{e.message}</p></div></li>
        ))}
      </ul>
    </div>
  )
}
