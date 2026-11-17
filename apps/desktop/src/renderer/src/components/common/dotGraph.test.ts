import { describe, expect, it } from 'vitest'
import { radialLayout } from './dotGraph'

describe('radialLayout', () => {
  const ids = ['c', ...Array.from({ length: 40 }, (_, i) => `n${i}`)]
  const at = radialLayout(ids, 'c')

  it('đặt nút tâm ở gốc và xếp đủ mọi nút', () => {
    expect(at.c).toEqual({ x: 0, y: 0 })
    expect(Object.keys(at)).toHaveLength(ids.length)
  })

  it('không có hai nút nào đứng sát nhau hơn bề rộng một nhãn', () => {
    const pts = Object.values(at)
    let min = Infinity
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) min = Math.min(min, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y))
    expect(min).toBeGreaterThan(130)
  })
})
