import { useEffect, useState } from 'react'
import type { AgentMode } from '@shared/agent-types'
import { TOOL_LABELS, deleteProfile, saveProfile, useAgentProfiles, type AgentProfile } from '../../state/agentProfiles'
import { tr } from '../../strings'

const WRITE_TOOLS: Record<string, true> = { edit: true, write: true, run_process: true }
const EMPTY = { name: '', mode: 'ask' as AgentMode, disabled: new Set<string>() }

/** Hồ sơ trợ lý kiểu Wu (Configure Profiles): đặt tên, chọn chế độ nền và tắt từng tool; hồ sơ hiện cạnh Hỏi/Kế hoạch/Sửa trong khung chat. */
export function ProfileEditor() {
  const profiles = useAgentProfiles()
  const modeOptions: { value: AgentMode; label: string }[] = [
    { value: 'ask', label: tr('Hỏi (chỉ đọc)') },
    { value: 'plan', label: tr('Kế hoạch (chỉ đọc)') },
    { value: 'edit', label: tr('Sửa (ghi có duyệt)') },
  ]
  const [tools, setTools] = useState<string[]>([])
  const [draft, setDraft] = useState(EMPTY)
  const [editing, setEditing] = useState<string | null>(null)
  useEffect(() => { void window.nexgraph.agent.toolNames?.().then(setTools).catch(() => {}) }, [])

  // Chế độ chỉ đọc vốn không có tool ghi: không cho bật/tắt chúng để tránh hiểu nhầm.
  const shown = tools.filter((t) => draft.mode === 'edit' || !WRITE_TOOLS[t])
  const toggle = (tool: string) => setDraft((d) => {
    const disabled = new Set(d.disabled)
    if (disabled.has(tool)) disabled.delete(tool)
    else disabled.add(tool)
    return { ...d, disabled }
  })
  const submit = () => {
    const name = draft.name.trim()
    if (!name) return
    const disabledTools = [...draft.disabled].filter((t) => shown.includes(t))
    saveProfile({ id: editing ?? `p-${Date.now().toString(36)}`, name, mode: draft.mode, disabledTools })
    setDraft(EMPTY)
    setEditing(null)
  }
  const edit = (p: AgentProfile) => {
    setEditing(p.id)
    setDraft({ name: p.name, mode: p.mode, disabled: new Set(p.disabledTools) })
  }

  return (
    <div className="profile-editor">
      {profiles.length > 0 && (
        <ul className="profile-list">
          {profiles.map((p) => (
            <li key={p.id}>
              <span><b>{p.name}</b> <span className="muted">· {modeOptions.find((m) => m.value === p.mode)?.label} · {tr('tắt {count} tool', { count: p.disabledTools.length })}</span></span>
              <button type="button" onClick={() => edit(p)}>{tr('Sửa')}</button>
              <button type="button" onClick={() => deleteProfile(p.id)} aria-label={tr('Xoá hồ sơ {name}', { name: p.name })}>{tr('Xoá')}</button>
            </li>
          ))}
        </ul>
      )}
      <form className="profile-form" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <div className="row">
          <input aria-label={tr('Tên hồ sơ')} placeholder={tr('Tên hồ sơ, ví dụ: Sửa không chạy lệnh')} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <select aria-label={tr('Chế độ nền')} value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value as AgentMode })}>
            {modeOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <fieldset className="profile-tools">
          <legend>{tr('Tool được dùng')}</legend>
          {shown.map((tool) => (
            <label key={tool}><input type="checkbox" checked={!draft.disabled.has(tool)} onChange={() => toggle(tool)} /> {TOOL_LABELS[tool] ? <>{TOOL_LABELS[tool]} <code className="muted">{tool}</code></> : <code>{tool}</code>}</label>
          ))}
        </fieldset>
        <div className="row">
          <button type="submit" className="primary" disabled={!draft.name.trim()}>{editing ? tr('Lưu hồ sơ') : tr('Thêm hồ sơ')}</button>
          {editing && <button type="button" onClick={() => { setEditing(null); setDraft(EMPTY) }}>{tr('Huỷ')}</button>}
        </div>
      </form>
    </div>
  )
}
