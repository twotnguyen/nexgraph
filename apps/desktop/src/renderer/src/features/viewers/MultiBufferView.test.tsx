// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { setLocale } from '../../shared/lib/locale'
import type { MultiBufferRequest } from '../editor/multiBuffer'
import { MultiBufferView } from './MultiBufferView'

const tabProps = vi.hoisted(() => vi.fn())
vi.mock('../editor/EditorTab', () => ({
  EditorTab: (props: { projectId: string; file: string; line: number; lineEnd: number; locked?: boolean; onDirtyChange: (file: string, dirty: boolean) => void }) => {
    tabProps(props)
    return null
  }
}))

const request: MultiBufferRequest = {
  id: 'multi-1', title: 'Tham chiếu', excerpts: [
    { id: 'a', file: 'src/a.ts', startLine: 3, endLine: 5 },
    { id: 'b', file: 'src/b.ts', startLine: 9, endLine: 11, label: 'B' }
  ]
}

describe('MultiBufferView', () => {
  it('renders a sticky file:line header and opens the original file at that line', () => {
    const onOpenFile = vi.fn()
    render(<MultiBufferView projectId="p1" request={request} onOpenFile={onOpenFile} />)
    const header = screen.getByRole('button', { name: 'src/a.ts:3' })
    expect(header.textContent).toContain('src/a.ts:3')
    expect(header.style.position).toBe('sticky')
    expect(header.style.top).toBe('0px')
    fireEvent.click(header)
    expect(onOpenFile).toHaveBeenCalledWith('src/a.ts', 3)
  })

  it('uses a translated line-range label when the excerpt has no label', () => {
    setLocale('vi')
    render(<MultiBufferView projectId="p1" request={request} />)
    expect(screen.getByRole('button', { name: 'src/a.ts:3' }).textContent).toContain('dòng 3–5')
  })

  it('marks excerpt boundaries and keeps editing bound to the original model', () => {
    const onDirtyChange = vi.fn()
    render(<MultiBufferView projectId="p1" request={request} onDirtyChange={onDirtyChange} />)
    const sections = document.querySelectorAll('.multi-buffer-excerpt')
    expect(sections).toHaveLength(2)
    expect(sections[0].getAttribute('aria-label')).toBe('src/a.ts:3-5')
    const firstSection = sections[0] as HTMLElement
    expect(firstSection.style.borderBottom).toContain('1px solid')
    expect(tabProps).toHaveBeenCalledWith(expect.objectContaining({ file: 'src/a.ts', line: 3, lineEnd: 5, projectId: 'p1' }))
    expect(tabProps).toHaveBeenCalledWith(expect.objectContaining({ file: 'src/b.ts', line: 9, lineEnd: 11 }))
    const firstCall = tabProps.mock.calls[0][0]
    expect(firstCall.onDirtyChange).toBe(onDirtyChange)
  })

  it('truyền trạng thái khoá theo từng tệp và cập nhật khi toggle sau khi mở', () => {
    tabProps.mockClear()
    const view = render(<MultiBufferView projectId="p1" request={request} lockedFiles={new Set(['src/a.ts'])} />)
    expect(tabProps).toHaveBeenCalledWith(expect.objectContaining({ file: 'src/a.ts', locked: true }))
    expect(tabProps).toHaveBeenCalledWith(expect.objectContaining({ file: 'src/b.ts', locked: false }))
    view.rerender(<MultiBufferView projectId="p1" request={request} lockedFiles={new Set(['src/b.ts'])} />)
    expect(tabProps).toHaveBeenLastCalledWith(expect.objectContaining({ file: 'src/b.ts', locked: true }))
    expect(tabProps).toHaveBeenCalledWith(expect.objectContaining({ file: 'src/a.ts', locked: false }))
  })

  it('does nothing on header click when no opener was provided', () => {
    render(<MultiBufferView projectId="p1" request={request} />)
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'src/b.ts:9' }))).not.toThrow()
  })
})
