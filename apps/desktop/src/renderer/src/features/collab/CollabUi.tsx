import { useEffect, useRef, useState } from 'react'
import { createEditor, languageFor } from '../editor/monaco'
import { FileTypeIcon } from '../../shared/ui/FileTypeIcon'
import { Icon } from '../../shared/ui/icons'
import { bindGuestEditor, clearCollabError, collabName, joinSession, leaveSession, setCollabName, useCollab } from './collab'
import './collab.css'
import { errorMsg } from '../../shared/lib/errorText'
import { msgText, type Message } from '../../shared/lib/messages'
import { tr } from '../../i18n/strings'

/** Thanh trạng thái phiên cộng tác dưới đầu vùng giữa: địa chỉ + mã để người khác nối, số người, nút dừng/rời. */
export function CollabBar() {
  const collab = useCollab()
  if (!collab.role && !collab.error) return null
  return (
    <div className="collab-bar" role="status">
      {collab.error && !collab.role && <><span className="collab-error">{msgText(collab.error)}</span><button type="button" onClick={clearCollabError}>{tr('Đóng')}</button></>}
      {collab.role === 'host' && collab.share && <>
        <Icon name="share" size={13} /><span>{tr('Đang chia sẻ')} <b>{collab.file}</b></span>
        <span className="muted">{tr('Địa chỉ')}</span><code>{collab.share.addresses.map((a) => `${a}:${collab.share!.port}`).join(' · ') || `localhost:${collab.share.port}`}</code>
        <span className="muted">{tr('Mã mời')}</span><code>{collab.share.code}</code>
        <span className="muted">{tr('{count} người tham gia', { count: collab.peers })}</span>
      </>}
      {collab.role === 'guest' && <><Icon name="share" size={13} /><span>{tr('Đang cộng tác')} <b>{collab.file}</b></span></>}
      {collab.remote.map((r) => <span key={r.name + r.color} className="collab-peer" style={{ background: r.color }}>{r.name}</span>)}
      {collab.role && <button type="button" onClick={leaveSession}>{collab.role === 'host' ? tr('Dừng chia sẻ') : tr('Rời phiên')}</button>}
    </div>
  )
}

/** Hộp thoại tham gia: địa chỉ máy:cổng, mã mời 22 ký tự và tên hiển thị cho con trỏ của mình. */
export function JoinDialog({ onClose, onJoined }: { onClose: () => void; onJoined: () => void }) {
  const [address, setAddress] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState(collabName())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Message | null>(null)
  const submit = async () => {
    setBusy(true)
    setError(null)
    setCollabName(name || tr('Người dùng'))
    try {
      await joinSession(address, code)
      onJoined()
      onClose()
    } catch (e) {
      setError(errorMsg(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="modal-backdrop" onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
      <form className="modal" role="dialog" aria-label={tr('Tham gia cộng tác')} onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <header><b>{tr('Tham gia cộng tác')}</b><button type="button" aria-label={tr('Đóng')} onClick={onClose}><Icon name="close" size={14} /></button></header>
        <p className="muted">{tr('Nhập địa chỉ và mã mời do máy chia sẻ hiển thị (cùng mạng LAN, kết nối thẳng giữa hai máy).')}</p>
        <label className="field"><span>{tr('Địa chỉ')}</span><input autoFocus placeholder="192.168.1.5:41234" value={address} onChange={(e) => setAddress(e.target.value)} /></label>
        <label className="field"><span>{tr('Mã mời')}</span><input placeholder={tr('Dán mã mời')} value={code} onChange={(e) => setCode(e.target.value)} /></label>
        <label className="field"><span>{tr('Tên của bạn')}</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        {error && <p role="alert" className="error">{msgText(error)}</p>}
        <footer><button type="button" onClick={onClose}>{tr('Huỷ')}</button><button type="submit" className="primary" disabled={busy || !address.trim() || !/^[A-Za-z0-9_-]{22}$/.test(code.trim())}>{busy ? tr('Đang nối…') : tr('Tham gia')}</button></footer>
      </form>
    </div>
  )
}

/** Thẻ editor của người tham gia: tài liệu đến từ máy chia sẻ, sửa ở đây đồng bộ về; máy chia sẻ lưu tệp. */
export function CollabTab({ file }: { file: string }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!host.current) return
    const editor = createEditor(host.current, { value: '', language: languageFor(file), readOnly: false, path: `collab/${file}` })
    const unbind = bindGuestEditor(editor)
    return () => { unbind(); editor.dispose() }
  }, [file])
  return (
    <div className="code-viewer editor-tab">
      <header className="code-head">
        <span className="editor-path mono" title={file}><FileTypeIcon name={file} size={14} /> {file} <span className="muted">· {tr('cộng tác, máy chia sẻ lưu tệp')}</span></span>
      </header>
      <div ref={host} className="editor-host" />
    </div>
  )
}
