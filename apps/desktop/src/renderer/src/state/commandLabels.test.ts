import { describe, expect, it } from 'vitest'
import { englishCommandLabel } from './commandLabels'
import { COMMANDS } from './commands'

describe('nhãn tiếng Anh của bảng lệnh', () => {
  it('mọi lệnh đã đăng ký đều có bản Anh (bảng lệnh ⌘⇧P, trang Phím tắt)', () => {
    const missing = COMMANDS.filter((def) => !englishCommandLabel(def.id)).map((def) => `${def.id} (${def.title})`)
    expect(missing).toEqual([])
  })

  it('mỗi category tiếng Việt ứng với đúng một category tiếng Anh', () => {
    const byCategory = new Map<string, Set<string>>()
    for (const def of COMMANDS) {
      const entry = englishCommandLabel(def.id)
      if (!entry) continue
      const set = byCategory.get(def.category) ?? new Set<string>()
      set.add(entry[1])
      byCategory.set(def.category, set)
    }
    const conflicts = [...byCategory].filter(([, en]) => en.size > 1).map(([vi, en]) => `${vi} → ${[...en].join(' | ')}`)
    expect(conflicts).toEqual([])
  })

  it('licenses.open hiện bằng tiếng Anh, cùng category Application với lệnh Ứng dụng khác', () => {
    expect(englishCommandLabel('licenses.open')).toEqual(['Open Source Licenses', 'Application'])
  })
})
