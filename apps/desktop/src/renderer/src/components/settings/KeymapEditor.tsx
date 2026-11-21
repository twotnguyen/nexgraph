import { useState, type KeyboardEvent } from 'react'
import { COMMANDS, bindingFor, bindingSource, eventToStroke, formatKey, isCustomBinding, setBaseKeymap, setBinding, useBaseKeymap, useKeybindings, type KeySource } from '../../state/commands'
import { BASE_KEYMAPS, type BaseKeymapId } from '../../state/baseKeymaps'
import { fuzzyFilter } from '../../state/fuzzy'
import { Highlight } from '../layout/Picker'
import { localizeCommand } from '../../state/commandLabels'
import { tr } from '../../strings'
import { useLocale } from '../../state/locale'

const sourceLabel = (source: KeySource): string => tr(
  source === 'default' ? 'Mặc định' : source === 'base' ? 'Base' : 'Người dùng'
)

const text = (id: string) => {
  const command = COMMANDS.find((item) => item.id === id)!
  const { title, category } = localizeCommand(command)
  return `${category}: ${title}`
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
    <span className="keymap-recorder" data-keymap-recorder tabIndex={0} role="textbox" aria-label={tr('Nhấn tổ hợp phím mới')} ref={(el) => el?.focus()}
      onKeyDown={onKeyDown} onBlur={() => onDone(undefined)}>
      {strokes.length ? formatKey(strokes.join(' ')) : tr('Nhấn phím… (Enter lưu, Esc huỷ)')}
    </span>
  )
}

/** Trang Phím tắt kiểu keymap editor của Wu: chọn base keymap, tìm lệnh, bấm đúp hoặc nút Đổi để ghi phím, nút Đặt lại để bỏ ghi đè; cột Nguồn cho biết lớp nào đang giữ phím. */
export function KeymapEditor() {
  useLocale()
  useKeybindings()
  const base = useBaseKeymap()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const rows = fuzzyFilter(COMMANDS.map((command) => command.id), query, (id) => `${text(id)} ${bindingFor(id)}`)
  return (
    <div className="keymap">
      <div className="settings-row">
        <div><label htmlFor="settings-base-keymap">Base keymap</label><p>{tr('Bộ phím nền theo IDE quen thuộc, áp ngay. Phím bạn tự sửa luôn thắng; lệnh không có trong bộ nền giữ phím mặc định.')}</p></div>
        <select id="settings-base-keymap" value={base} onChange={(event) => setBaseKeymap(event.target.value as BaseKeymapId)}>
          {Object.entries(BASE_KEYMAPS).map(([id, { label }]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      <input type="search" aria-label={tr('Tìm lệnh hoặc phím')} placeholder={tr('Tìm lệnh hoặc phím…')} value={query} onChange={(event) => setQuery(event.target.value)} />
      <table>
        <thead><tr><th>{tr('Lệnh')}</th><th>{tr('Phím')}</th><th>{tr('Nguồn')}</th><th aria-label={tr('Thao tác')} /></tr></thead>
        <tbody>
          {rows.map(({ item: id, positions }) => {
            const key = bindingFor(id)
            const source = bindingSource(id)
            return (
              <tr key={id} data-command-id={id} onDoubleClick={() => setEditing(id)}>
                <td><Highlight text={text(id)} positions={positions.filter((p) => p < text(id).length)} /></td>
                <td>{editing === id
                  ? <Recorder onDone={(next) => { setEditing(null); if (next !== undefined) setBinding(id, next) }} />
                  : key ? <kbd>{formatKey(key)}</kbd> : <span className="muted">—</span>}</td>
                <td className="keymap-source">{key || source !== 'default' ? sourceLabel(source) : null}</td>
                <td className="keymap-actions">
                  <button type="button" onClick={() => setEditing(id)}>{tr('Đổi')}</button>
                  {isCustomBinding(id) && <button type="button" title={tr('Về phím của base keymap hoặc mặc định')} onClick={() => setBinding(id, null)}>{tr('Đặt lại')}</button>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
