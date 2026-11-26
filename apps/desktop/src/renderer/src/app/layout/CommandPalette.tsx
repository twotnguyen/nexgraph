import { useRef, useState, type KeyboardEvent } from 'react'
import { availableCommands, bindingFor, eventToStroke, formatKey, runCommand, setBinding, useCommand, useKeybindings, type CommandDef } from '../../shared/lib/commands'
import { localizeCommand } from '../../shared/lib/commandLabels'
import { useLocale } from '../../shared/lib/locale'
import { tr } from '../../i18n/strings'
import { Highlight, Picker } from '../../shared/ui/Picker'

const HITS = 'nexgraph.command.hits'
const readHits = (): Record<string, number> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HITS) ?? '{}')
    return parsed && typeof parsed === 'object' ? parsed as Record<string, number> : {}
  } catch {
    return {}
  }
}
const commandKey = (command: CommandDef) => command.id

function Recorder({ onDone }: { onDone: (key: string | undefined, restoreFocus?: boolean) => void }) {
  const [strokes, setStrokes] = useState<string[]>([])
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
    if (plain && event.key === 'Escape') return onDone(undefined)
    if (plain && event.key === 'Enter') return onDone(strokes.join(' '))
    if (plain && event.key === 'Backspace') return setStrokes([])
    const stroke = eventToStroke(event.nativeEvent)
    if (stroke) setStrokes((current) => [...current, stroke].slice(-2))
  }
  return <span className="picker-recorder" data-keymap-recorder tabIndex={0} role="textbox" aria-label={tr('Nhấn tổ hợp phím mới')}
    ref={(element) => element?.focus()} onKeyDown={onKeyDown} onBlur={() => onDone(undefined, false)}>
    {strokes.length ? formatKey(strokes.join(' ')) : tr('Nhấn phím… (Enter lưu, Esc huỷ)')}
  </span>
}

/** Gắn một lần ở gốc app: ⌘⇧P mở bảng lệnh kiểu Wu; lệnh dùng nhiều đứng trước khi chưa gõ. */
export function CommandPaletteHost() {
  useLocale()
  const label = (command: CommandDef) => {
    const { title, category } = localizeCommand(command)
    return `${category}: ${title}`
  }
  const [items, setItems] = useState<CommandDef[] | null>(null)
  const [initialQuery, setInitialQuery] = useState('')
  const [recording, setRecording] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useKeybindings()
  const openPalette = (query: string) => {
    setRecording(null)
    setInitialQuery(query)
    setItems((open) => {
      if (open) return null
      const hits = readHits()
      return availableCommands().filter((command) => command.id !== 'command_palette.toggle')
        .sort((a, b) => (hits[b.id] ?? 0) - (hits[a.id] ?? 0))
    })
  }
  useCommand('command_palette.toggle', () => openPalette(''))
  useCommand('editor.indentation_selector', () => openPalette('indent'))
  if (!items) return null
  const close = () => { setRecording(null); setItems(null) }
  return (
    <Picker label={tr('Bảng lệnh')} placeholder={tr('Chạy lệnh…')} className="command-palette" items={items} itemKey={commandKey} itemText={label}
      initialQuery={initialQuery}
      empty={tr('Không có lệnh khớp')} onCancel={close} inputRef={inputRef}
      onActive={(command) => setRecording((current) => current && current !== command.id ? null : current)}
      onSecondary={(command) => setRecording(command.id)}
      footer={(command, pick) => !command ? null : recording === command.id
        ? <Recorder onDone={(key, restoreFocus = true) => {
          setRecording(null)
          if (key !== undefined) setBinding(command.id, key)
          if (restoreFocus) inputRef.current?.focus()
        }} />
        : <>
          <button type="button" disabled={!!bindingFor(command.id)} onClick={() => setRecording(command.id)}>{tr('Thêm phím tắt…')}</button>
          <button type="button" disabled={!bindingFor(command.id)} onClick={() => setRecording(command.id)}>{tr('Đổi phím tắt…')} <kbd>⌘↵</kbd></button>
          <button type="button" onClick={pick}>{tr('Chạy')} <kbd>↵</kbd></button>
        </>}
      onPick={(command) => {
        close()
        const hits = readHits()
        try { localStorage.setItem(HITS, JSON.stringify({ ...hits, [command.id]: (hits[command.id] ?? 0) + 1 })) } catch { /* bỏ qua */ }
        // Chạy sau khi bảng đóng để lệnh mở hộp thoại khác nhận được focus.
        setTimeout(() => runCommand(command.id))
      }}
      itemData={(command) => ({ 'data-command-id': command.id })}
      renderItem={(command, positions) => {
        const key = bindingFor(command.id)
        return <>
          <span><Highlight text={label(command)} positions={positions} /></span>
          <kbd>{key ? formatKey(key) : '—'}</kbd>
        </>
      }} />
  )
}
