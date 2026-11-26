import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../shared/ui/icons'
import { MAX_NAME, deletePrompt, savePrompt, suggestName, useSavedPrompts } from './savedPromptsStore'
import { tr } from '../../i18n/strings'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Nội dung ô soạn đang gõ: lưu thành tin mới. */
  composerText: string
  onInsert: (text: string) => void
}

/** Nút và hộp "Tin nhắn đã lưu" của ô soạn: lưu nội dung ô soạn kèm tên, chọn để chèn lại, xóa. Hộp bật lên neo theo `.agent-composer`. */
export function SavedPrompts({ open, onOpenChange, composerText, onInsert }: Props) {
  const prompts = useSavedPrompts()
  const [name, setName] = useState<string | null>(null)
  const [error, setError] = useState('')
  const root = useRef<HTMLDivElement>(null)
  // Mỗi lần mở: tên quay về gợi ý theo nội dung hiện tại, xóa lỗi cũ, đưa focus vào hộp.
  useEffect(() => {
    setName(null)
    setError('')
    if (open) root.current?.querySelector<HTMLElement>('.agent-saved-form input, .agent-saved-pick')?.focus()
  }, [open])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) onOpenChange(false) }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      onOpenChange(false)
      root.current?.querySelector<HTMLElement>('.agent-saved-toggle')?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open, onOpenChange])
  const submit = () => {
    const failure = savePrompt(name ?? suggestName(composerText), composerText)
    setError(failure ?? '')
    if (!failure) setName(null)
  }
  return <div className="agent-saved-wrap" ref={root}>
    <button type="button" className="agent-round agent-saved-toggle" aria-label={tr('Tin nhắn đã lưu')} title={tr('Tin nhắn đã lưu')} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => onOpenChange(!open)}><Icon name="bookmark" size={15} /></button>
    {open && <div className="agent-saved" role="dialog" aria-label={tr('Tin nhắn đã lưu')}>
      {composerText.trim() ? <form className="agent-saved-form" onSubmit={(event) => { event.preventDefault(); submit() }}>
        <input value={name ?? suggestName(composerText)} maxLength={MAX_NAME} aria-label={tr('Tên tin nhắn')} placeholder={tr('Tên tin nhắn')} onChange={(event) => setName(event.target.value)} />
        <button type="submit">{tr('Lưu ô soạn')}</button>
      </form> : <p className="agent-saved-hint">{tr('Soạn tin trong ô chat rồi mở lại đây để lưu.')}</p>}
      {error && <p role="alert" className="agent-saved-error">{tr(error)}</p>}
      {prompts.length === 0 ? <div className="agent-completion-empty">{tr('Chưa có tin nhắn đã lưu.')}</div>
        : <ul className="agent-saved-list">{prompts.map((prompt) => <li key={prompt.id} className="agent-saved-row">
          <button type="button" className="agent-saved-pick" title={prompt.text} onClick={() => { onInsert(prompt.text); onOpenChange(false) }}>
            <b>{prompt.name}</b><span>{prompt.text.replace(/\s+/g, ' ').trim()}</span>
          </button>
          <button type="button" className="agent-icon-button" aria-label={tr('Xóa tin đã lưu {name}', { name: prompt.name })} title={tr('Xóa')} onClick={() => deletePrompt(prompt.id)}><Icon name="trash" size={13} /></button>
        </li>)}</ul>}
    </div>}
  </div>
}
