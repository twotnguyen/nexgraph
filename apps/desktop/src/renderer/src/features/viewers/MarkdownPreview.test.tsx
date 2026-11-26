// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installNexgraph } from '../../test-utils'
import { MarkdownPreview } from './MarkdownPreview'

afterEach(() => cleanup())

const buffer = vi.hoisted(() => ({ text: '', notify: null as ((value: string | null) => void) | null }))
vi.mock('./modelBuffer', () => ({
  observeBuffer: (_projectId: string, _file: string, changed: (text: string | null) => void) => {
    buffer.notify = changed
    changed(buffer.text)
    return {
      edit: (expected: string, edit: { line: number; startColumn: number; endColumn: number; text: string }) => {
        if (buffer.text !== expected) return
        const lines = buffer.text.split('\n')
        const line = lines[edit.line - 1]
        lines[edit.line - 1] = line.slice(0, edit.startColumn - 1) + edit.text + line.slice(edit.endColumn - 1)
        buffer.text = lines.join('\n')
        changed(buffer.text)
      },
      dispose: () => { buffer.notify = null }
    }
  }
}))
const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }))
vi.mock('mermaid', () => ({ default: mermaid }))

describe('MarkdownPreview', () => {
  beforeEach(() => { installNexgraph(); buffer.text = '# Ban đầu\n\n- [ ] Một\n  - [x] Hai'; buffer.notify = null })
  it('hiển thị chỉnh sửa chưa lưu và checkbox cập nhật đúng dòng nguồn', async () => {
    render(<MarkdownPreview projectId="p1" file="README.md" onClose={() => {}} onOpenFile={() => {}} />)
    expect(await screen.findByRole('heading', { name: 'Ban đầu' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Đánh dấu hoàn thành' }))
    expect(buffer.text).toContain('- [x] Một')
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Bỏ đánh dấu hoàn thành' })[1])
    expect(buffer.text).toContain('  - [ ] Hai')
    act(() => { buffer.text = '# Chưa lưu'; buffer.notify?.(buffer.text) })
    expect(await screen.findByRole('heading', { name: 'Chưa lưu' })).toBeInTheDocument()
  })
  it('không sửa checkbox của bộ đệm chỉ đọc', async () => {
    render(<MarkdownPreview projectId="p1" file="README.md" readOnly onClose={() => {}} onOpenFile={() => {}} />)
    const checkbox = await screen.findByRole('checkbox', { name: 'Đánh dấu hoàn thành' })
    expect(checkbox).toBeDisabled()
    fireEvent.click(checkbox)
    expect(buffer.text).toContain('- [ ] Một')
  })
  it('đọc ảnh tương đối qua IPC và mở tệp Markdown liên kết', async () => {
    const readBinary = vi.fn(async () => ({ data: 'eA==', size: 1 }))
    installNexgraph({ fs: { readBinary } })
    const open = vi.fn()
    buffer.text = '![ảnh](../img/a.png)\n\n[tiếp](next.md)'
    render(<MarkdownPreview projectId="p1" file="docs/readme.md" onClose={() => {}} onOpenFile={open} />)
    await waitFor(() => expect(readBinary).toHaveBeenCalledWith('p1', 'img/a.png'))
    expect(await screen.findByRole('img', { name: 'ảnh' })).toHaveAttribute('src', 'data:image/png;base64,eA==')
    fireEvent.click(screen.getByRole('link', { name: 'tiếp' }))
    expect(open).toHaveBeenCalledWith('docs/next.md')
  })
})

describe('MarkdownPreview mermaid', () => {
  const fence = (code: string) => `\`\`\`mermaid\n${code}\n\`\`\``
  const open = () => render(<MarkdownPreview projectId="p1" file="README.md" onClose={() => {}} onOpenFile={() => {}} />)
  beforeEach(() => {
    installNexgraph()
    buffer.notify = null
    mermaid.initialize.mockReset()
    mermaid.render.mockReset()
    mermaid.render.mockImplementation(async (id: string) => ({ svg: `<svg id="${id}" role="img"></svg>` }))
  })
  afterEach(() => { delete document.documentElement.dataset.appearance })

  it('vẽ khối mermaid đã đóng thành SVG với id riêng cho từng sơ đồ, ẩn mã và để nguyên khối mã khác', async () => {
    buffer.text = `# Sơ đồ\n\n${fence('graph TD; A-->B')}\n\n${fence('graph TD; A-->B')}\n\n\`\`\`ts\nconst x = 1\n\`\`\``
    const { container } = open()
    await waitFor(() => expect(container.querySelectorAll('.md-mermaid svg')).toHaveLength(2))
    const ids = mermaid.render.mock.calls.map(([id]) => id as string)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    // Vùng nháp nằm ngoài .md-document (không dính quy tắc p/margin của tài liệu) và chung cho mọi sơ đồ; css của nó tắt chuyển tiếp để mermaid đo đúng khi bật giảm chuyển động.
    const scratch = document.body.querySelector('.md-mermaid-scratch')
    expect(scratch).not.toBeNull()
    expect(container.contains(scratch)).toBe(false)
    expect(document.body.querySelectorAll('.md-mermaid-scratch')).toHaveLength(1)
    expect(mermaid.render).toHaveBeenCalledWith(expect.stringMatching(/^nexgraph-mermaid-\d+$/), 'graph TD; A-->B\n', scratch)
    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ startOnLoad: false, securityLevel: 'strict', theme: 'default' }))
    expect(screen.queryByText('graph TD; A-->B')).toBeNull()
    expect(screen.getByText('const x = 1')).toBeInTheDocument()
  })

  it('dùng theme tối của mermaid khi giao diện tối', async () => {
    document.documentElement.dataset.appearance = 'dark'
    buffer.text = fence('pie\n"a": 1')
    open()
    await waitFor(() => expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' })))
  })

  it('cú pháp sai: báo lỗi và giữ mã nguồn', async () => {
    mermaid.render.mockRejectedValue(new Error('Parse error on line 2'))
    buffer.text = fence('graph TD\nA--')
    const { container } = open()
    expect(await screen.findByRole('alert')).toHaveTextContent('Không vẽ được sơ đồ: Parse error on line 2')
    expect(container.querySelector('.md-mermaid')).toBeNull()
    expect(container.querySelector('pre')).toHaveTextContent('graph TD A--')
  })

  it('không tải được mermaid cũng báo lỗi thay vì để trống', async () => {
    mermaid.initialize.mockImplementation(() => { throw new Error('thiếu mô-đun') })
    buffer.text = fence('graph TD; A-->B')
    const { container } = open()
    expect(await screen.findByRole('alert')).toHaveTextContent('thiếu mô-đun')
    expect(container.querySelector('pre')).toHaveTextContent('graph TD; A-->B')
  })

  it('khối chưa đóng rào vẫn là mã và không gọi mermaid', async () => {
    buffer.text = `${fence('graph TD; A-->B')}\n\n\`\`\`mermaid\ngraph LR; X-->Y`
    const { container } = open()
    await waitFor(() => expect(container.querySelectorAll('.md-mermaid svg')).toHaveLength(1))
    expect(mermaid.render).toHaveBeenCalledTimes(1)
    expect(container.querySelector('pre')).toHaveTextContent('graph LR; X-->Y')
  })

  it('gõ liên tục chỉ vẽ lại một lần với nội dung cuối', async () => {
    buffer.text = fence('graph TD; A-->B')
    const { container } = open()
    await waitFor(() => expect(container.querySelector('.md-mermaid svg')).not.toBeNull())
    act(() => { buffer.notify?.(fence('graph TD; A-->')) })
    act(() => { buffer.notify?.(fence('graph LR; X-->Y')) })
    await waitFor(() => expect(mermaid.render).toHaveBeenLastCalledWith(expect.any(String), 'graph LR; X-->Y\n', expect.any(HTMLElement)))
    expect(mermaid.render).toHaveBeenCalledTimes(2)
  })
})
