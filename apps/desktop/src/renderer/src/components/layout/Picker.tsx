import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { fuzzyFilter } from '../../state/fuzzy'
import './picker.css'

/** Tô các ký tự khớp; `offset` khi chuỗi hiển thị là phần đuôi của chuỗi đã khớp. */
export function Highlight({ text, positions, offset = 0 }: { text: string; positions: readonly number[]; offset?: number }) {
  if (positions.length === 0) return <>{text}</>
  const hit = new Set(positions.map((p) => p - offset))
  return <>{Array.from(text).map((ch, i) => (hit.has(i) ? <mark key={i}>{ch}</mark> : ch))}</>
}

interface PickerProps<T> {
  label: string
  placeholder: string
  items: readonly T[]
  itemKey: (item: T) => string
  /** Chuỗi để khớp mờ. */
  itemText: (item: T) => string
  renderItem: (item: T, positions: number[]) => ReactNode
  onPick: (item: T) => void
  onCancel: () => void
  onSecondary?: (item: T) => void
  /** Chân picker; mục đang chọn có thể chưa có (danh sách rỗng) — khi đó chân vẫn hiện để còn nút như "Quay lại". */
  footer?: (item: T | undefined, pick: () => void) => ReactNode
  inputRef?: Ref<HTMLInputElement>
  error?: string | null
  /** Gọi khi mục đang chọn đổi (rê chuột hoặc mũi tên): dùng để xem trước. */
  onActive?: (item: T) => void
  onQueryChange?: (query: string) => void
  initialKey?: string
  initialQuery?: string
  empty: string
  className?: string
  itemData?: (item: T) => Record<`data-${string}`, string>
  /** Tự lọc (ví dụ tìm tệp ưu tiên tên); mặc định khớp mờ theo itemText. */
  filter?: (items: readonly T[], query: string) => { item: T; positions: number[] }[]
}

/** Picker kiểu Wu: neo cách đỉnh 80px, ô tìm trên cùng, danh sách mục, mũi tên/Enter/Esc, bấm ra ngoài là huỷ. */
export function Picker<T>({ label, placeholder, items, itemKey, itemText, renderItem, onPick, onCancel, onActive, onQueryChange, onSecondary, footer, inputRef, error, initialKey, initialQuery, empty, className, itemData, filter }: PickerProps<T>) {
  const listId = useId()
  const [query, setQuery] = useState(initialQuery ?? '')
  const shown = useMemo(() => (filter ? filter(items, query) : fuzzyFilter(items, query, itemText)), [items, query, filter, itemText])
  const [index, setIndex] = useState(() => Math.max(0, initialKey ? items.findIndex((item) => itemKey(item) === initialKey) : 0))
  const active = shown[Math.min(index, shown.length - 1)]
  const rows = useRef<HTMLUListElement>(null)
  const onActiveRef = useRef(onActive)
  onActiveRef.current = onActive

  useEffect(() => {
    if (active) onActiveRef.current?.(active.item)
    rows.current?.querySelector('[aria-selected=true]')?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const inInput = event.target instanceof HTMLInputElement
    if (event.key === 'Escape') onCancel()
    else if (event.key === 'Enter' && active && onSecondary && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) onSecondary(active.item)
    else if (inInput && event.key === 'Enter' && active && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) onPick(active.item)
    else if (inInput && (event.key === 'ArrowDown' || event.key === 'ArrowUp') && shown.length) {
      const step = event.key === 'ArrowDown' ? 1 : -1
      setIndex((Math.min(index, shown.length - 1) + step + shown.length) % shown.length)
    } else return
    event.preventDefault()
  }

  const optionId = (item: T) => `${listId}-${encodeURIComponent(itemKey(item))}`
  const footerContent = footer?.(active?.item, () => { if (active) onPick(active.item) })
  return (
    <div className="picker-layer" onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <div className={`picker${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-label={label} onKeyDown={onKey}>
        <input ref={inputRef} autoFocus role="combobox" aria-expanded="true" aria-controls={listId} aria-label={label} aria-activedescendant={active ? optionId(active.item) : undefined}
          aria-describedby={error ? `${listId}-error` : undefined} placeholder={placeholder} value={query} onChange={(event) => { setQuery(event.target.value); setIndex(0); onQueryChange?.(event.target.value) }} />
        {shown.length === 0 ? <p className="picker-empty">{empty}</p> : (
          <ul id={listId} role="listbox" aria-label={label} ref={rows}>
            {shown.map(({ item, positions }, i) => (
              <li key={itemKey(item)} id={optionId(item)} role="option" aria-selected={i === Math.min(index, shown.length - 1)} {...itemData?.(item)}
                onMouseMove={() => { if (i !== Math.min(index, shown.length - 1)) setIndex(i) }} onClick={() => onPick(item)}>
                {renderItem(item, positions)}
              </li>
            ))}
          </ul>
        )}
        {error && <p id={`${listId}-error`} className="picker-error" role="alert">{error}</p>}
        {footerContent ? <div className="picker-footer">{footerContent}</div> : null}
      </div>
    </div>
  )
}
