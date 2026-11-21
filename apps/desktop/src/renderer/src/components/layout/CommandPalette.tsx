import { useState } from 'react'
import { availableCommands, bindingFor, formatKey, runCommand, useCommand, type CommandDef } from '../../state/commands'
import { Highlight, Picker } from './Picker'

const HITS = 'nexgraph.command.hits'
const readHits = (): Record<string, number> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HITS) ?? '{}')
    return parsed && typeof parsed === 'object' ? parsed as Record<string, number> : {}
  } catch {
    return {}
  }
}
const label = (command: CommandDef) => `${command.category}: ${command.title}`
const commandKey = (command: CommandDef) => command.id

/** Gắn một lần ở gốc app: ⌘⇧P mở bảng lệnh kiểu Wu; lệnh dùng nhiều đứng trước khi chưa gõ. */
export function CommandPaletteHost() {
  const [items, setItems] = useState<CommandDef[] | null>(null)
  useCommand('command_palette.toggle', () => setItems((open) => {
    if (open) return null
    const hits = readHits()
    return availableCommands().filter((command) => command.id !== 'command_palette.toggle')
      .sort((a, b) => (hits[b.id] ?? 0) - (hits[a.id] ?? 0))
  }))
  if (!items) return null
  const close = () => setItems(null)
  return (
    <Picker label="Bảng lệnh" placeholder="Chạy lệnh…" className="command-palette" items={items} itemKey={commandKey} itemText={label}
      empty="Không có lệnh khớp" onCancel={close}
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
          {key && <kbd>{formatKey(key)}</kbd>}
        </>
      }} />
  )
}
