// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ContextRing, contextFraction, contextLevel, contextTooltip } from './ContextRing'

describe('tỉ lệ ngữ cảnh', () => {
  it('bằng token / cửa sổ, có thể vượt 100% nếu backend báo quá', () => {
    expect(contextFraction({ tokens: 50, window: 200 })).toBe(0.25)
    expect(contextFraction({ tokens: 0, window: 200 })).toBe(0)
    expect(contextFraction({ tokens: 250, window: 200 })).toBe(1.25)
  })

  it('thiếu hoặc vô nghĩa thì không có tỉ lệ (không bịa số)', () => {
    expect(contextFraction(null)).toBeNull()
    expect(contextFraction(undefined)).toBeNull()
    expect(contextFraction({ tokens: 10, window: 0 })).toBeNull()
    expect(contextFraction({ tokens: 10, window: -5 })).toBeNull()
    expect(contextFraction({ tokens: -1, window: 100 })).toBeNull()
    expect(contextFraction({ tokens: Number.NaN, window: 100 })).toBeNull()
    expect(contextFraction({ tokens: 10, window: Number.POSITIVE_INFINITY })).toBeNull()
  })
})

describe('ngưỡng màu', () => {
  it('thường dưới 75%, vàng từ 75%, đỏ từ 90%', () => {
    expect(contextLevel(0)).toBe('normal')
    expect(contextLevel(0.7499)).toBe('normal')
    expect(contextLevel(0.75)).toBe('warning')
    expect(contextLevel(0.8999)).toBe('warning')
    expect(contextLevel(0.9)).toBe('danger')
    expect(contextLevel(1.4)).toBe('danger')
  })
})

describe('tooltip và vòng', () => {
  it('tooltip dạng "x / y token (z%)" với số có dấu phân cách', () => {
    expect(contextTooltip({ tokens: 53_000, window: 1_048_576 })).toBe('53.000 / 1.048.576 token (5%)')
    expect(contextTooltip({ tokens: 150_000, window: 200_000 })).toBe('150.000 / 200.000 token (75%)')
  })

  it('không vẽ gì khi chưa có số tin cậy', () => {
    const { container, rerender } = render(<ContextRing context={null} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<ContextRing context={undefined} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<ContextRing context={{ tokens: 5, window: 0 }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('hiện % đã dùng, mức màu và tooltip đúng số', () => {
    const { rerender } = render(<ContextRing context={{ tokens: 20_000, window: 200_000 }} />)
    const ring = screen.getByRole('img', { name: 'Ngữ cảnh đã dùng: 20.000 / 200.000 token (10%)' })
    expect(ring).toHaveAttribute('title', '20.000 / 200.000 token (10%)')
    expect(ring).toHaveAttribute('data-level', 'normal')
    expect(ring).toHaveTextContent('10%')
    rerender(<ContextRing context={{ tokens: 160_000, window: 200_000 }} />)
    expect(screen.getByRole('img')).toHaveAttribute('data-level', 'warning')
    rerender(<ContextRing context={{ tokens: 190_000, window: 200_000 }} />)
    expect(screen.getByRole('img')).toHaveAttribute('data-level', 'danger')
  })

  it('cung vòng tỉ lệ với số đã dùng và không tràn khi vượt 100%', () => {
    const arc = () => document.querySelector('.agent-context-arc')!
    const { rerender } = render(<ContextRing context={{ tokens: 100, window: 200 }} />)
    const circumference = 2 * Math.PI * 6
    expect(Number(arc().getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference / 2, 5)
    rerender(<ContextRing context={{ tokens: 250, window: 200 }} />)
    expect(Number(arc().getAttribute('stroke-dashoffset'))).toBe(0)
    expect(screen.getByRole('img')).toHaveTextContent('125%')
  })
})
