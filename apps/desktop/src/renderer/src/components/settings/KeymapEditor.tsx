import { useState, type KeyboardEvent } from 'react'
import { COMMANDS, bindingFor, eventToStroke, formatKey, isCustomBinding, setBinding, useKeybindings } from '../../state/commands'
import { fuzzyFilter } from '../../state/fuzzy'
import { Highlight } from '../layout/Picker'

const text = (id: string) => {
  const command = COMMANDS.find((item) => item.id === id)!
  return `${command.category}: ${command.title}`
}

/** Ô ghi phím: nhấn tổ hợp (tối đa hai bước cho hợp âm), Enter lưu, Esc huỷ, Backspace xoá. */
function Recorder({ onDone }: { onDone: (key: string | undefined) => void }) {
  const [strokes, setStrokes] = useState<string[]>([])
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
    if (plain && event.key === 'Escape') return onDone(undefined)
    if (plain && event.key === 'Enter') return onDone(strokes.join(' '))
    if (plain && event.key === 'Backspace') return setStrokes([])
    const stroke = eventToStroke(event.nativeEvent)
    if (stroke) setStrokes((cur) => [...cur, stroke].slice(-2))
  }
  return (
    <span className="keymap-recorder" data-keymap-recorder tabIndex={0} role="textbox" aria-label="Nhấn tổ hợp phím mới" ref={(el) => el?.focus()}
      onKeyDown={onKeyDown} onBlur={() => onDone(undefined)}>
      {strokes.length ? formatKey(strokes.join(' ')) : 'Nhấn phím… (Enter lưu, Esc huỷ)'}
    </span>
  )
}

/** Trang Phím tắt kiểu keymap editor của Wu: tìm lệnh, bấm đúp hoặc nút Đổi để ghi phím, nút Mặc định để bỏ ghi đè. */
export function KeymapEditor() {
  useKeybindings()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const rows = fuzzyFilter(COMMANDS.map((command) => command.id), query, (id) => `${text(id)} ${bindingFor(id)}`)
  return (
    <div className="keymap">
      <input type="search" aria-label="Tìm lệnh hoặc phím" placeholder="Tìm lệnh hoặc phím…" value={query} onChange={(event) => setQuery(event.target.value)} />
      <table>
        <thead><tr><th>Lệnh</th><th>Phím</th><th aria-label="Thao tác" /></tr></thead>
        <tbody>
          {rows.map(({ item: id, positions }) => {
            const key = bindingFor(id)
            return (
              <tr key={id} data-command-id={id} onDoubleClick={() => setEditing(id)}>
                <td><Highlight text={text(id)} positions={positions.filter((p) => p < text(id).length)} /></td>
                <td>{editing === id
                  ? <Recorder onDone={(next) => { setEditing(null); if (next !== undefined) setBinding(id, next) }} />
                  : key ? <kbd>{formatKey(key)}</kbd> : <span className="muted">—</span>}</td>
                <td className="keymap-actions">
                  <button type="button" onClick={() => setEditing(id)}>Đổi</button>
                  {isCustomBinding(id) && <button type="button" onClick={() => setBinding(id, null)}>Mặc định</button>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
