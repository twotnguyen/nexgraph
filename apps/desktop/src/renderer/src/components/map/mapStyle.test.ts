import { describe, expect, it } from 'vitest'
import { PALETTE, communityColor, edgeSize, nodeSize } from './mapStyle'

describe('mapStyle', () => {
  it('nodeSize theo căn bậc hai số tệp, kẹp 4–28', () => {
    expect(nodeSize(1)).toBe(6)
    expect(nodeSize(10000)).toBe(28)
    expect(nodeSize(0)).toBe(4)
  })
  it('communityColor: null xám, còn lại theo bảng 10 màu', () => {
    expect(communityColor(null)).toBe('#9aa5b1')
    expect(communityColor(13)).toBe(PALETTE[3])
  })
  it('edgeSize theo log trọng số, kẹp tối đa 6', () => {
    expect(edgeSize(1)).toBe(1)
    expect(edgeSize(1e9)).toBe(6)
  })
})
