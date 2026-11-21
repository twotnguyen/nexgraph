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
