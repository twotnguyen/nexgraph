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

  it('AI-01: trích dẫn không ngoặc trong câu văn cũng thành chip, bấm mở đúng dòng', async () => {
    const onOpen = vi.fn()
    render(<CitationText onOpen={onOpen} text="lib/a.dart:10–42 là chỗ usage luôn 0."
      citations={[{ raw: 'lib/a.dart:10–42', file: 'lib/a.dart', start: 10, end: 42, valid: true, reason: null }]} />)
    const chip = screen.getByRole('button', { name: 'lib/a.dart:10–42' })
    expect(screen.getByText(/là chỗ usage luôn 0/)).toBeInTheDocument()
    await userEvent.click(chip)
    expect(onOpen).toHaveBeenCalledWith('lib/a.dart', 10, 42)
  })

  it('AI-02: đường dẫn có dấu cách hiện chip, chữ đứng trước giữ nguyên', async () => {
    const onOpen = vi.fn()
    render(<CitationText onOpen={onOpen} text="Xem flow app/service.py:1-2 ngay."
      citations={[{ raw: 'Xem flow app/service.py:1-2', file: 'flow app/service.py', start: 1, end: 2, valid: true, reason: null }]} />)
    expect(screen.getByText(/Xem/)).toBeInTheDocument()
    const chip = screen.getByRole('button', { name: 'flow app/service.py:1–2' })
    await userEvent.click(chip)
    expect(onOpen).toHaveBeenCalledWith('flow app/service.py', 1, 2)
  })

  it('vẽ lại không dựng lại chip (bấm vẫn ăn khi cha re-render giữa mousedown và mouseup) và dùng onOpen mới nhất', async () => {
    const citations = [{ raw: '[[a.ts:3]]', file: 'a.ts', start: 3, end: 3, valid: true, reason: null }]
    const first = vi.fn()
    const latest = vi.fn()
    const view = render(<CitationText text="Xem [[a.ts:3]]" citations={citations} onOpen={first} />)
    const chip = screen.getByRole('button', { name: 'a.ts:3' })
    view.rerender(<CitationText text="Xem [[a.ts:3]]" citations={citations} onOpen={latest} />)
    expect(screen.getByRole('button', { name: 'a.ts:3' })).toBe(chip)
    await userEvent.click(chip)
    expect(latest).toHaveBeenCalledWith('a.ts', 3, 3)
    expect(first).not.toHaveBeenCalled()
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

  it('M1: trích dẫn trong gạch đầu dòng, danh sách số, inline code và code fence đều thành chip', async () => {
    const onOpen = vi.fn()
    const text = [
      '## Kết quả',
      '- service.py:1-2 là chỗ lưu phiên.',
      '1. app.py:8-9 gọi login.',
      '- `flow app/service.py:4-7` là luồng chính.',
      '',
      '```ts',
      '// xem utils.ts:3-4',
      'const value = 1',
      '```',
      '',
      'Xem [[khong-co.ts:1-2]].'
    ].join('\n')
    const { container } = render(<CitationText onOpen={onOpen} text={text} citations={[
      { raw: 'service.py:1-2', file: 'service.py', start: 1, end: 2, valid: true, reason: null },
      { raw: 'app.py:8-9', file: 'app.py', start: 8, end: 9, valid: true, reason: null },
      { raw: 'flow app/service.py:4-7', file: 'flow app/service.py', start: 4, end: 7, valid: true, reason: null },
      { raw: 'utils.ts:3-4', file: 'utils.ts', start: 3, end: 4, valid: true, reason: null },
      { raw: '[[khong-co.ts:1-2]]', file: 'khong-co.ts', start: 1, end: 2, valid: false, reason: 'file_not_found' }
    ]} />)
    for (const name of ['service.py:1–2', 'app.py:8–9', 'flow app/service.py:4–7', 'utils.ts:3–4']) {
      expect(screen.getByRole('button', { name })).toBeEnabled()
    }
    expect(screen.getByRole('button', { name: /khong-co\.ts:1–2 chưa xác minh/ })).toBeDisabled()
    // Code fence giữ nguyên nội dung (thụt lề/monospace) và chip hiện ở dòng dưới khối.
    expect(container.querySelector('pre code')).toHaveTextContent('const value = 1')
    expect(screen.getByText(/Trích dẫn trong khối mã:/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'flow app/service.py:4–7' }))
    expect(onOpen).toHaveBeenCalledWith('flow app/service.py', 4, 7)
    await userEvent.click(screen.getByRole('button', { name: 'utils.ts:3–4' }))
    expect(onOpen).toHaveBeenCalledWith('utils.ts', 3, 4)
  })

  it('link tự tạo không giả mạo chip; citation trong inline code thành chip, code khác giữ nguyên', () => {
    const text = '`[[a.ts:3]]` và `login()`\n\n[Giả mạo](#nexgraph-citation)'
    const { container } = render(<CitationText text={text} onOpen={vi.fn()} citations={[
      { raw: '[[a.ts:3]]', file: 'a.ts', start: 3, end: 3, valid: true, reason: null }
    ]} />)
    expect(screen.getByRole('button', { name: 'a.ts:3' })).toBeInTheDocument()
    expect(container.querySelector('code')).toHaveTextContent('login()')
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByRole('link', { name: 'Giả mạo' })).not.toBeInTheDocument()
  })
})
