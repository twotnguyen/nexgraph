import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
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
  /** Gọi khi mục đang chọn đổi (rê chuột hoặc mũi tên): dùng để xem trước. */
  onActive?: (item: T) => void
  initialKey?: string
  empty: string
  className?: string
  itemData?: (item: T) => Record<`data-${string}`, string>
  /** Tự lọc (ví dụ tìm tệp ưu tiên tên); mặc định khớp mờ theo itemText. */
  filter?: (items: readonly T[], query: string) => { item: T; positions: number[] }[]
}

/** Picker kiểu Wu: neo cách đỉnh 80px, ô tìm trên cùng, danh sách mục, mũi tên/Enter/Esc, bấm ra ngoài là huỷ. */
export function Picker<T>({ label, placeholder, items, itemKey, itemText, renderItem, onPick, onCancel, onActive, initialKey, empty, className, itemData, filter }: PickerProps<T>) {
  const listId = useId()
  const [query, setQuery] = useState('')
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

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') onCancel()
    else if (event.key === 'Enter' && active) onPick(active.item)
    else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && shown.length) {
      const step = event.key === 'ArrowDown' ? 1 : -1
      setIndex((Math.min(index, shown.length - 1) + step + shown.length) % shown.length)
    } else return
    event.preventDefault()
  }

  const optionId = (item: T) => `${listId}-${encodeURIComponent(itemKey(item))}`
  return (
    <div className="picker-layer" onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <div className={`picker${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-label={label}>
        <input autoFocus role="combobox" aria-expanded="true" aria-controls={listId} aria-label={label} aria-activedescendant={active ? optionId(active.item) : undefined}
          placeholder={placeholder} value={query} onKeyDown={onKey} onChange={(event) => { setQuery(event.target.value); setIndex(0) }} />
        {shown.length === 0 ? <p className="picker-empty">{empty}</p> : (
          <ul id={listId} role="listbox" aria-label={label} ref={rows}>
            {shown.map(({ item, positions }, i) => (
              <li key={itemKey(item)} id={optionId(item)} role="option" aria-selected={item === active?.item} {...itemData?.(item)}
                onMouseMove={() => { if (item !== active?.item) setIndex(i) }} onClick={() => onPick(item)}>
                {renderItem(item, positions)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
