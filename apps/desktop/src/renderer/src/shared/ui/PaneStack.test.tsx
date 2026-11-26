// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { setLocale } from '../lib/locale'
import { PaneStack, PANE_RESIZE_STEP, type PaneSection, type PaneStackState } from './PaneStack'

afterEach(() => setLocale('vi'))

const sections: PaneSection[] = [
  { id: 'console', title: 'Debug console', children: <pre data-testid="pane-body">output</pre> }
]

function Controlled({ initial }: { initial?: PaneStackState }) {
  const [state, setState] = useState<PaneStackState>(initial ?? { collapsed: {}, heights: {} })
  return <PaneStack sections={sections} state={state}
    onToggle={(id) => setState((current) => ({ ...current, collapsed: { ...current.collapsed, [id]: !current.collapsed[id] } }))}
    onResize={(id, height) => setState((current) => ({ ...current, heights: { ...current.heights, [id]: height } }))} />
}

it('bấm header để thu gọn rồi mở rộng section', () => {
  render(<Controlled />)
  expect(screen.getByTestId('pane-body')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Thu gọn Debug console' }))
  expect(screen.queryByTestId('pane-body')).not.toBeInTheDocument()
  const expand = screen.getByRole('button', { name: 'Mở rộng Debug console' })
  expect(expand).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(expand)
  expect(screen.getByTestId('pane-body')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Thu gọn Debug console' })).toHaveAttribute('aria-expanded', 'true')
})

it('dịch cả tên section trong aria-label thu gọn/mở rộng, không ghép nửa Việt nửa Anh', () => {
  setLocale('en')
  render(<PaneStack sections={[{ id: 'stack', title: 'Ngăn xếp gọi', children: null }]}
    state={{ collapsed: {}, heights: {} }} onToggle={() => {}} onResize={() => {}} />)
  expect(screen.getByRole('button', { name: 'Collapse Call stack' })).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Call stack' })).toBeInTheDocument()
})

it('đổi chiều cao 24px bằng ArrowUp/ArrowDown và giữ focus trên separator', () => {
  render(<Controlled initial={{ collapsed: {}, heights: { console: 120 } }} />)
  const separator = screen.getByRole('separator', { name: 'Chiều cao Debug console' })
  separator.focus()
  fireEvent.keyDown(separator, { key: 'ArrowUp' })
  expect(separator).toHaveAttribute('aria-valuenow', String(120 + PANE_RESIZE_STEP))
  fireEvent.keyDown(separator, { key: 'ArrowDown' })
  expect(separator).toHaveAttribute('aria-valuenow', '120')
  expect(document.activeElement).toBe(separator)
})

it('kéo separator bằng pointer để đổi chiều cao', () => {
  const onResize = vi.fn()
  render(<PaneStack sections={sections} state={{ collapsed: {}, heights: { console: 120 } }} onToggle={() => {}} onResize={onResize} />)
  const separator = screen.getByRole('separator', { name: 'Chiều cao Debug console' })
  fireEvent.pointerDown(separator, { clientY: 100, pointerId: 1 })
  fireEvent.pointerMove(separator, { clientY: 76, pointerId: 1 })
  expect(onResize).toHaveBeenCalledWith('console', 144)
  fireEvent.pointerUp(separator, { pointerId: 1 })
})

it('xếp separator trong grid, không overlay chặn nội dung', () => {
  const { container } = render(<PaneStack sections={sections} state={{ collapsed: {}, heights: { console: 120 } }} onToggle={() => {}} onResize={() => {}} />)
  const section = container.querySelector('section')!
  const separator = screen.getByRole('separator')
  expect(section).toHaveClass('pane-section')
  expect(separator.parentElement).toBe(section)
  expect(section.style.position).not.toMatch(/absolute|fixed/)
  expect(separator.style.position).not.toMatch(/absolute|fixed/)
  expect(screen.getByTestId('pane-body')).toBeVisible()
})

it('không báo 160px khi chưa resize và resize lần đầu từ chiều cao đã vẽ', () => {
  const onResize = vi.fn()
  const { container } = render(<PaneStack sections={sections} state={{ collapsed: {}, heights: {} }} onToggle={() => {}} onResize={onResize} />)
  const separator = screen.getByRole('separator', { name: 'Chiều cao Debug console' })
  expect(separator).not.toHaveAttribute('aria-valuenow')
  const body = container.querySelector('.pane-body') as HTMLElement
  const rect = vi.spyOn(body, 'getBoundingClientRect').mockReturnValue({ height: 100 } as unknown as DOMRect)
  fireEvent.keyDown(separator, { key: 'ArrowUp' })
  expect(onResize).toHaveBeenCalledWith('console', 100 + PANE_RESIZE_STEP)
  rect.mockRestore()
})
