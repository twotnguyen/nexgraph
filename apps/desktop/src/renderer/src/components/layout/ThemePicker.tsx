import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '../common/icons'
import { THEMES, currentThemeId, previewTheme, setTheme } from '../../state/useTheme'
import './theme-picker.css'

const OPEN = 'nexgraph:theme-picker'
export const openThemePicker = (): void => void window.dispatchEvent(new Event(OPEN))

// Như Wu: theme tối trước, rồi theo tên.
const ORDERED = [...THEMES].sort((a, b) => (a.appearance === b.appearance ? 0 : a.appearance === 'dark' ? -1 : 1) || a.name.localeCompare(b.name, 'vi'))

/** Gắn một lần ở thanh tiêu đề: mở bằng openThemePicker() hoặc ⌘K rồi ⌘T (Ctrl trên Windows). */
export function ThemePickerHost() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let chord = 0
    const show = () => setOpen(true)
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      const key = event.key.toLowerCase()
      if (key === 'k') chord = Date.now()
      else if (key === 't' && Date.now() - chord < 1500) {
        event.preventDefault()
        chord = 0
        setOpen(true)
      }
    }
    window.addEventListener(OPEN, show)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener(OPEN, show)
      document.removeEventListener('keydown', onKey)
    }
  }, [])
  return open ? <ThemePicker onClose={() => setOpen(false)} /> : null
}

function Name({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLocaleLowerCase('vi').indexOf(query) : -1
  if (at < 0) return <>{text}</>
  return <>{text.slice(0, at)}<mark>{text.slice(at, at + query.length)}</mark>{text.slice(at + query.length)}</>
}

/** Bảng chọn theme kiểu Wu: neo trên cùng, rê hoặc dùng phím mũi tên để xem trước, Enter lưu, Esc trả lại theme cũ. */
export function ThemePicker({ onClose }: { onClose: () => void }) {
  const original = useRef(currentThemeId())
  const listId = useId()
  const [query, setQuery] = useState('')
  const needle = query.trim().toLocaleLowerCase('vi')
  const items = ORDERED.filter((theme) => theme.name.toLocaleLowerCase('vi').includes(needle))
  const [index, setIndex] = useState(() => Math.max(0, ORDERED.findIndex((theme) => theme.id === original.current)))
  const active = items[Math.min(index, items.length - 1)]
  const rows = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (active) previewTheme(active.id)
    rows.current?.querySelector('[aria-selected=true]')?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  const cancel = () => {
    previewTheme(original.current)
    onClose()
  }
  const pick = (id: string) => {
    setTheme(id)
    onClose()
  }
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') cancel()
    else if (event.key === 'Enter' && active) pick(active.id)
    else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && items.length) {
      const step = event.key === 'ArrowDown' ? 1 : -1
      setIndex((Math.min(index, items.length - 1) + step + items.length) % items.length)
    } else return
    event.preventDefault()
  }

  return (
    <div className="theme-picker-layer" onPointerDown={(event) => { if (event.target === event.currentTarget) cancel() }}>
      <div className="theme-picker" role="dialog" aria-modal="true" aria-label="Chọn theme">
        <input autoFocus role="combobox" aria-expanded="true" aria-controls={listId} aria-label="Tìm theme" aria-activedescendant={active ? `${listId}-${active.id}` : undefined}
          placeholder="Chọn theme…" value={query} onKeyDown={onKey} onChange={(event) => { setQuery(event.target.value); setIndex(0) }} />
        {items.length === 0 ? <p className="theme-picker-empty">Không có theme khớp</p> : (
          <ul id={listId} role="listbox" aria-label="Theme" ref={rows}>
            {items.map((theme, i) => (
              <li key={theme.id} id={`${listId}-${theme.id}`} role="option" aria-selected={theme === active} data-theme-id={theme.id}
                onMouseMove={() => { if (theme !== active) setIndex(i) }} onClick={() => pick(theme.id)}>
                <span><Name text={theme.name} query={needle} /></span>
                <small>{theme.appearance === 'dark' ? 'Tối' : 'Sáng'}</small>
                {theme.id === original.current && <Icon name="check" size={14} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
