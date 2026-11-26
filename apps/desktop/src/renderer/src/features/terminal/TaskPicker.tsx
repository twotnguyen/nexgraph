import { useEffect, useState } from 'react'
import { tr } from '../../i18n/strings'
import type { TaskDefinition } from '@nexgraph/contracts/api'
import { fuzzyFilter } from '../../shared/lib/fuzzy'
import { errorMsg } from '../../shared/lib/errorText'
import { msg, msgText, type Message } from '../../shared/lib/messages'
import { Icon } from '../../shared/ui/icons'
import { Highlight, Picker } from '../../shared/ui/Picker'

export type RecentTask = { label: string; command: string; oneshot: boolean }
export type TaskChoice = { key: string; task: TaskDefinition; recent: boolean; oneshot: boolean }

export function readTaskHistory(projectId: string): RecentTask[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`nexgraph.tasks.${projectId}`) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is RecentTask =>
      item && typeof item.label === 'string' && typeof item.command === 'string' && typeof item.oneshot === 'boolean').slice(0, 30) : []
  } catch { return [] }
}

export function rememberTask(projectId: string, task: TaskDefinition, oneshot: boolean): RecentTask[] {
  const entry = { label: task.label, command: task.command, oneshot }
  const history = [entry, ...readTaskHistory(projectId).filter((item) =>
    item.label !== entry.label || item.command !== entry.command || item.oneshot !== entry.oneshot)].slice(0, 30)
  try { localStorage.setItem(`nexgraph.tasks.${projectId}`, JSON.stringify(history)) } catch { /* chỉ là lịch sử */ }
  return history
}

export function matchTaskChoices(items: readonly TaskChoice[], query: string): { item: TaskChoice; positions: number[] }[] {
  const matches = fuzzyFilter(items, query, (item) => item.task.label)
  const recentOrder = new Map(items.map((item, index) => [item, index]))
  matches.sort((a, b) => a.item.recent && b.item.recent ? recentOrder.get(a.item)! - recentOrder.get(b.item)!
    : Number(b.item.recent) - Number(a.item.recent))
  if (matches.length || !query.trim()) return matches
  const command = query.trim()
  return [{ item: { key: `command:${command}`, task: { label: command, command, type: 'shell' }, recent: false, oneshot: true }, positions: [] }]
}

export function TaskPicker({ projectId, history, onPick, onClose, onOpenFile }: {
  projectId: string
  history: readonly RecentTask[]
  onPick: (task: TaskDefinition, oneshot: boolean) => void
  onClose: () => void
  onOpenFile?: (path: string) => void
}) {
  const [tasks, setTasks] = useState<TaskDefinition[] | null>(null)
  const [error, setError] = useState<Message | null>(null)
  useEffect(() => {
    let alive = true
    const api = window.nexgraph.tasks
    if (!api) { setError(msg('Không đọc được task ở chế độ này')); return }
    api.list(projectId).then((items) => { if (alive) setTasks(items) }).catch((e: unknown) => { if (alive) setError(errorMsg(e)) })
    return () => { alive = false }
  }, [projectId])

  const editConfig = async () => {
    const api = window.nexgraph.tasks
    if (!api?.configFile || !onOpenFile) return
    try {
      onOpenFile(await api.configFile(projectId))
      onClose()
    } catch (e) { setError(errorMsg(e)) }
  }

  const defined = tasks ?? []
  const recent: TaskChoice[] = history.flatMap((item, index) => {
    const task = item.oneshot ? { label: item.label, command: item.command, type: 'shell' as const }
      : defined.find((candidate) => candidate.label === item.label && candidate.command === item.command)
    return task ? [{ key: `recent:${index}`, task, recent: true, oneshot: item.oneshot }] : []
  })
  const items: TaskChoice[] = [...recent, ...defined.flatMap((task, index) =>
    recent.some((item) => !item.oneshot && item.task === task) ? [] : [{ key: `task:${index}`, task, recent: false, oneshot: false }])]
  const configChoice: TaskChoice | null = onOpenFile
    ? { key: 'config', task: { label: tr('Sửa tasks.json'), command: '' }, recent: false, oneshot: false } : null
  const choices = configChoice ? [...items, configChoice] : items
  const filter = (list: readonly TaskChoice[], query: string) => {
    const matches = matchTaskChoices(list.filter((item) => item !== configChoice), query)
    return configChoice ? [...matches, { item: configChoice, positions: [] }] : matches
  }
  return <Picker label={tr('Chạy task')} placeholder={tr('Tìm task, hoặc gõ lệnh để chạy')} items={choices}
    itemKey={(item) => item.key} itemText={(item) => item.task.label} filter={filter}
    empty={error ? msgText(error) : tasks ? tr('Không có task') : tr('Đang đọc task…')} error={error ? msgText(error) : undefined} onCancel={onClose}
    onPick={(item) => {
      if (item === configChoice) { void editConfig(); return }
      onClose(); onPick(item.task, item.oneshot)
    }}
    renderItem={(item, positions) => item === configChoice
      ? <button type="button" onClick={(event) => { event.stopPropagation(); void editConfig() }}>{tr('Sửa tasks.json')}</button>
      : <><Icon name={item.recent ? 'history' : 'terminal'} size={14} />
        <span><Highlight text={item.task.label} positions={positions} /></span>
        <small>{item.oneshot && !item.recent ? tr('Chạy lệnh') : item.task.command}</small></>} />
}
