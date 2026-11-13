// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CitationText } from './CitationText'

describe('CitationText', () => {
  it('chip hợp lệ bấm được; chip sai gạch ngang, khoá, có lý do; code thành <code>', async () => {
    const onOpen = vi.fn()
    const { container } = render(<CitationText onOpen={onOpen} text="Xem [[a.ts:3-9]] và [[b.ts:80-95]] với `login()`"
      citations={[{ raw: '[[a.ts:3-9]]', file: 'a.ts', start: 3, end: 9, valid: true, reason: null },
        { raw: '[[b.ts:80-95]]', file: 'b.ts', start: 80, end: 95, valid: false, reason: 'out_of_range' }]} />)
    await userEvent.click(screen.getByRole('button', { name: 'a.ts:3–9' }))
    expect(onOpen).toHaveBeenCalledWith('a.ts', 3, 9)
    const bad = screen.getByRole('button', { name: /b\.ts:80–95 chưa xác minh/ })
    expect(bad).toHaveClass('cite', 'bad')
    expect(bad).toBeDisabled()
    expect(bad).toHaveAttribute('title', 'Khoảng dòng không tồn tại trong tệp')
    expect(container.querySelector('code')).toHaveTextContent('login()')
    expect(container.textContent).not.toContain('[[')
  })

  it('trích dẫn một dòng hiện tệp:dòng', () => {
    render(<CitationText onOpen={() => {}} text="[[x.py:7]]" citations={[{ raw: '[[x.py:7]]', file: 'x.py', start: 7, end: 7, valid: true, reason: null }]} />)
    expect(screen.getByRole('button', { name: 'x.py:7' })).toBeInTheDocument()
  })
})
