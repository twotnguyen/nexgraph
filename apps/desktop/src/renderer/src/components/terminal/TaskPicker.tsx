import { useEffect, useState } from 'react'
import type { TaskDefinition } from '@shared/api'
import { fuzzyFilter } from '../../state/fuzzy'
import { errorText } from '../../state/errorText'
import { Icon } from '../common/icons'
import { Highlight, Picker } from '../layout/Picker'

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

export function TaskPicker({ projectId, history, onPick, onClose }: {
  projectId: string
  history: readonly RecentTask[]
  onPick: (task: TaskDefinition, oneshot: boolean) => void
  onClose: () => void
}) {
  const [tasks, setTasks] = useState<TaskDefinition[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const api = window.nexgraph.tasks
    if (!api) { setError('Không đọc được task ở chế độ này'); return }
    api.list(projectId).then((items) => { if (alive) setTasks(items) }).catch((e: unknown) => { if (alive) setError(errorText(e)) })
    return () => { alive = false }
  }, [projectId])

  const defined = tasks ?? []
  const recent: TaskChoice[] = history.flatMap((item, index) => {
    const task = item.oneshot ? { label: item.label, command: item.command, type: 'shell' as const }
      : defined.find((candidate) => candidate.label === item.label && candidate.command === item.command)
    return task ? [{ key: `recent:${index}`, task, recent: true, oneshot: item.oneshot }] : []
  })
  const choices: TaskChoice[] = [...recent, ...defined.flatMap((task, index) =>
    recent.some((item) => !item.oneshot && item.task === task) ? [] : [{ key: `task:${index}`, task, recent: false, oneshot: false }])]
  return <Picker label="Chạy task" placeholder="Tìm task, hoặc gõ lệnh để chạy" items={choices}
    itemKey={(item) => item.key} itemText={(item) => item.task.label} filter={matchTaskChoices}
    empty={error ?? (tasks ? 'Không có task' : 'Đang đọc task…')} onCancel={onClose}
    onPick={(item) => { onClose(); onPick(item.task, item.oneshot) }}
    renderItem={(item, positions) => <><Icon name={item.recent ? 'history' : 'terminal'} size={14} />
      <span><Highlight text={item.task.label} positions={positions} /></span>
      <small>{item.oneshot && !item.recent ? 'Chạy lệnh' : item.task.command}</small></>} />
}
