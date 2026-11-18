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

  it('Markdown hiển thị heading, danh sách, bảng và code fence cùng citation đã xác minh', () => {
    const text = '# Kết quả\n\n- **Đã đọc** mã\n\n| Tệp | Kết quả |\n| --- | --- |\n| app.ts | Tốt |\n\n~~~ts\nconst value = 1\n~~~\n\nXem [[app.ts:2]].'
    const { container } = render(<CitationText text={text} onOpen={vi.fn()} citations={[
      { raw: '[[app.ts:2]]', file: 'app.ts', start: 2, end: 2, valid: true, reason: null }
    ]} />)
    expect(screen.getByRole('heading', { name: 'Kết quả' })).toBeInTheDocument()
    expect(screen.getByRole('listitem')).toHaveTextContent('Đã đọc mã')
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(container.querySelector('pre code')).toHaveTextContent('const value = 1')
    expect(screen.getByRole('button', { name: 'app.ts:2' })).toBeInTheDocument()
  })

  it('chặn HTML, ảnh từ xa và link script/file; link HTTPS có rel bảo vệ', () => {
    const text = '<img src="https://tracking.example/pixel" onerror="alert(1)">\n\n![Biểu đồ](https://tracking.example/image.png)\n\n[Script](javascript:alert%281%29) [File](file:///etc/passwd) [Docs](https://example.com/docs)'
    const { container } = render(<CitationText text={text} citations={[]} onOpen={vi.fn()} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(screen.getByText('Hình ảnh · Biểu đồ')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Script' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'File' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('citation trong code giữ nguyên và link tự tạo không giả mạo chip', () => {
    const text = '`[[a.ts:3]]`\n\n[Giả mạo](#nexgraph-citation)\n\n[[a.ts:3]]'
    const { container } = render(<CitationText text={text} onOpen={vi.fn()} citations={[
      { raw: '[[a.ts:3]]', file: 'a.ts', start: 3, end: 3, valid: true, reason: null }
    ]} />)
    expect(container.querySelector('code')).toHaveTextContent('[[a.ts:3]]')
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByRole('link', { name: 'Giả mạo' })).not.toBeInTheDocument()
  })
})
