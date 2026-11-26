import { describe, expect, it } from 'vitest'
import { acpRules, modeInstruction } from '../src/main/features/agent/skill'

describe('chỉ dẫn theo chế độ', () => {
  it('AI-03: chế độ Kế hoạch yêu cầu nêu tệp và kiểm thử dự kiến ở mọi runtime', () => {
    expect(modeInstruction('plan')).toBe('Hãy lập kế hoạch cụ thể, nêu tệp và kiểm thử dự kiến. Chỉ đọc và phân tích trong lượt này.')
    expect(acpRules('plan')).toContain(modeInstruction('plan'))
    expect(acpRules('plan')).toContain('Chế độ hiện tại: plan')
  })

  it('AI-03: Hỏi và Sửa không kèm chỉ dẫn lập kế hoạch', () => {
    expect(modeInstruction('ask')).toBe('')
    expect(modeInstruction('edit')).toBe('')
    expect(acpRules('ask')).not.toContain('nêu tệp và kiểm thử dự kiến')
    expect(acpRules('edit')).not.toContain('nêu tệp và kiểm thử dự kiến')
  })
})
