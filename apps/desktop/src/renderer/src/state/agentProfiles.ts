import { useSyncExternalStore } from 'react'
import type { AgentMode } from '@shared/agent-types'

/** Hồ sơ trợ lý kiểu Wu: chế độ nền (Hỏi/Kế hoạch/Sửa) cộng danh sách tool bị tắt. */
export interface AgentProfile {
  id: string
  name: string
  mode: AgentMode
  disabledTools: string[]
}

const STORE = 'nexgraph.agent.profiles'
const CHANGED = 'nexgraph:agent-profiles'

const valid = (p: unknown): p is AgentProfile => !!p && typeof p === 'object' && 'id' in p && typeof p.id === 'string' && 'name' in p && typeof p.name === 'string' &&
  'mode' in p && (p.mode === 'ask' || p.mode === 'plan' || p.mode === 'edit') && 'disabledTools' in p && Array.isArray(p.disabledTools) && p.disabledTools.every((t) => typeof t === 'string')

let profiles: AgentProfile[] = (() => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORE) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(valid) : []
  } catch {
    return []
  }
})()

const save = (next: AgentProfile[]) => {
  profiles = next
  try { localStorage.setItem(STORE, JSON.stringify(next)) } catch { /* vẫn dùng trong phiên */ }
  window.dispatchEvent(new Event(CHANGED))
}

export function saveProfile(profile: AgentProfile): void {
  save(profiles.some((p) => p.id === profile.id) ? profiles.map((p) => (p.id === profile.id ? profile : p)) : [...profiles, profile])
}
export const deleteProfile = (id: string): void => save(profiles.filter((p) => p.id !== id))

const subscribe = (notify: () => void) => {
  window.addEventListener(CHANGED, notify)
  return () => window.removeEventListener(CHANGED, notify)
}
/** Hồ sơ tự tạo (ba hồ sơ dựng sẵn là ba chế độ Hỏi / Kế hoạch / Sửa). */
export const useAgentProfiles = (): AgentProfile[] => useSyncExternalStore(subscribe, () => profiles)

/** Hồ sơ tự tạo đang khớp trạng thái của dự án (cùng chế độ, cùng tập tool tắt); không khớp thì null. */
export function matchProfile(list: readonly AgentProfile[], mode: AgentMode | null, disabled: readonly string[]): AgentProfile | null {
  if (!mode || disabled.length === 0) return null
  const key = [...disabled].sort().join('\n')
  return list.find((p) => p.mode === mode && [...p.disabledTools].sort().join('\n') === key) ?? null
}

/** Nhãn dễ đọc cho tool; tool đồ thị giữ tên gốc. */
export const TOOL_LABELS: Record<string, string> = {
  read: 'Đọc tệp', grep: 'Tìm trong tệp', find: 'Tìm tệp', ls: 'Liệt kê thư mục',
  edit: 'Sửa tệp', write: 'Ghi tệp mới', run_process: 'Chạy lệnh (test, build)'
}
