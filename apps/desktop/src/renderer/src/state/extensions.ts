import { useSyncExternalStore } from 'react'
import type { ExtensionCommand, ExtensionInfo } from '@shared/api'
import { addCommands, registerHandler, removeCommands, runCommand } from './commands'
import { addThemes } from './useTheme'
import { getActiveEditor } from './activeEditor'
import { errorMsg } from './errorText'
import type { Message } from './messages'

/**
 * Extension kiểu Wu nạp từ thư mục: đóng góp theme và lệnh. Lệnh là khai báo (chèn văn bản, chạy chuỗi lệnh có sẵn),
 * không chạy mã của extension trong app. Main đã kiểm manifest; ở đây chỉ đăng ký.
 */
type State = { extensions: ExtensionInfo[]; errors: { folder: string; message: string }[]; loaded: boolean; error: Message | null }
let state: State = { extensions: [], errors: [], loaded: false, error: null }
const listeners = new Set<() => void>()
const patch = (next: Partial<State>) => { state = { ...state, ...next }; for (const l of listeners) l() }
export const useExtensions = (): State => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => state)

let unregister: (() => void)[] = []

function perform(command: ExtensionCommand) {
  const { action } = command
  if (action.type === 'insertText') getActiveEditor()?.handle.insertText?.(action.text)
  else for (const id of action.commands) runCommand(id)
}

/** Nạp lại toàn bộ: gỡ lệnh/theme cũ rồi đăng ký theo danh sách mới. */
export async function loadExtensions(): Promise<void> {
  const api = window.nexgraph?.extensions
  if (!api) return
  try {
    const { extensions, errors } = await api.list()
    for (const off of unregister) off()
    unregister = []
    removeCommands('ext.')
    const commands = extensions.flatMap((ext) => ext.commands.map((c) => ({ ext, c })))
    addCommands(commands.map(({ ext, c }) => ({ id: c.id, title: c.title, category: ext.name })))
    unregister = commands.map(({ c }) => registerHandler(c.id, () => perform(c)))
    addThemes(extensions.flatMap((ext) => ext.themes))
    patch({ extensions, errors, loaded: true, error: null })
  } catch (e) {
    patch({ loaded: true, error: errorMsg(e) })
  }
}

export async function installExtension(): Promise<ExtensionInfo | null> {
  const installed = await window.nexgraph.extensions!.install()
  if (installed) await loadExtensions()
  return installed
}

export async function removeExtension(id: string): Promise<void> {
  await window.nexgraph.extensions!.remove(id)
  await loadExtensions()
}
