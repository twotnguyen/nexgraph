import { describe, expect, it } from 'vitest'
import { matchTaskChoices, type TaskChoice } from './TaskPicker'

const choices: TaskChoice[] = [
  { key: 'recent', task: { label: 'Compile', command: 'npm run build' }, recent: true, oneshot: false },
  { key: 'defined', task: { label: 'Build', command: 'make' }, recent: false, oneshot: false }
]

describe('task picker', () => {
  it('ưu tiên task gần đây và lọc theo tên', () => {
    expect(matchTaskChoices(choices, '').map(({ item }) => item.key)).toEqual(['recent', 'defined'])
    expect(matchTaskChoices(choices, 'build').map(({ item }) => item.key)).toEqual(['defined'])
  })

  it('chạy lệnh gõ vào khi không có task khớp', () => {
    expect(matchTaskChoices(choices, 'echo hello')[0].item).toMatchObject({
      oneshot: true, task: { label: 'echo hello', command: 'echo hello', type: 'shell' }
    })
    expect(matchTaskChoices([], '   ')).toEqual([])
  })
})
