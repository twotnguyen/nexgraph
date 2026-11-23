import { describe, expect, it } from 'vitest'
import { relPosix, toPosix } from './scanPaths'

/**
 * Review #57 C1: `relative()` trả `components\agent\AgentPanel.tsx` trên Windows còn danh sách
 * ngoại lệ (`ALLOWED[].file`) viết `components/agent/AgentPanel.tsx`, nên test quét đỏ trên CI
 * windows dù mã đúng. Mọi test quét so đường dẫn phải đi qua `relPosix()`.
 */
describe('đường dẫn luật quét dùng "/" trên mọi hệ điều hành', () => {
  it('toPosix() đổi dấu \\ của Windows sang /', () => {
    expect(toPosix('components\\agent\\AgentPanel.tsx')).toBe('components/agent/AgentPanel.tsx')
    expect(toPosix('components/agent/AgentPanel.tsx')).toBe('components/agent/AgentPanel.tsx')
    expect(toPosix('a\\b/c\\d.ts')).toBe('a/b/c/d.ts')
  })

  it('relPosix() trả đường dẫn tương đối dạng "/" không lẫn dấu \\', () => {
    const rel = relPosix('/repo/src', '/repo/src/components/agent/AgentPanel.tsx')
    expect(rel).toBe('components/agent/AgentPanel.tsx')
    expect(rel).not.toContain('\\')
  })
})
