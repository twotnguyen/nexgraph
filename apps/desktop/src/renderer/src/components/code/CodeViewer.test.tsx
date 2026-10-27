// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodeSlice } from '@shared/graph-types'
import { installNexgraph } from '../../test-utils'
import { CodeViewer } from './CodeViewer'

const slice = (over: Partial<CodeSlice> = {}): CodeSlice => ({
  file: 'lib/a.dart', start: 1, end: 5, language: 'dart', stale: false,
  text: 'void a() {}\n\tvoid b() {}\nvar s = "<b>&amp;</b>";\nvoid c() {}\nvoid d() {}', ...over
})

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

const props = { projectId: 'p1', file: 'lib/a.dart', line: 3, onClose: vi.fn() }

describe('CodeViewer', () => {
  it('asks for 200 lines of context before the target and numbers the lines from there', async () => {
    const code = vi.fn(async () => slice({ start: 201, end: 203, text: 'x\ny\nz' }))
    installNexgraph({ graph: { code } })
    render(<CodeViewer {...props} line={401} />)
    await screen.findByText('x')
    expect(code).toHaveBeenCalledWith('p1', 'lib/a.dart', 201)
    expect(document.querySelector('[data-line="201"]')).toBeTruthy()
    expect(document.querySelector('[data-line="203"]')).toBeTruthy()
  })

  it('clamps the start at line 1', async () => {
    const code = vi.fn(async () => slice())
    installNexgraph({ graph: { code } })
    render(<CodeViewer {...props} line={3} />)
    await screen.findByText('void a() {}')
    expect(code).toHaveBeenCalledWith('p1', 'lib/a.dart', 1)
  })

  it('highlights the target range and scrolls it into view', async () => {
    installNexgraph({ graph: { code: vi.fn(async () => slice()) } })
    render(<CodeViewer {...props} line={2} lineEnd={3} />)
    await screen.findByText('void a() {}')
    const marked = [...document.querySelectorAll('[data-highlight="true"]')].map((e) => e.getAttribute('data-line'))
    expect(marked).toEqual(['2', '3'])
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('shows source text verbatim: markup characters, tabs and long lines', async () => {
    const long = 'x'.repeat(5000)
    installNexgraph({ graph: { code: vi.fn(async () => slice({ end: 6, text: `${slice().text}\n${long}` })) } })
    render(<CodeViewer {...props} />)
    expect(await screen.findByText('var s = "<b>&amp;</b>";')).toBeInTheDocument()
    expect(document.querySelector('[data-line="2"] .src')?.textContent).toBe('\tvoid b() {}')
    expect(document.querySelector('[data-line="6"] .src')?.textContent).toBe(long)
    expect(document.querySelector('.code-viewer b')).toBeNull()
  })

  it('warns when the file changed and refreshes then reloads on request', async () => {
    const code = vi.fn().mockResolvedValueOnce(slice({ stale: true })).mockResolvedValue(slice())
    const { api } = installNexgraph({ graph: { code } })
    render(<CodeViewer {...props} />)
    expect(await screen.findByText('Tệp đã thay đổi so với lần lập chỉ mục')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Làm mới' }))
    await waitFor(() => expect(screen.queryByText('Tệp đã thay đổi so với lần lập chỉ mục')).not.toBeInTheDocument())
    expect(api.index.refresh).toHaveBeenCalledWith('p1')
    expect(code).toHaveBeenCalledTimes(2)
  })

  it('explains a missing file instead of showing a blank screen', async () => {
    installNexgraph({ graph: { code: vi.fn(async () => { throw { code: 'file_not_found', message: 'x' } }) } })
    render(<CodeViewer {...props} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Tệp không còn tồn tại hoặc chưa được lập chỉ mục')
  })

  it('tells the user when only 2,000 lines are shown', async () => {
    const text = Array.from({ length: 2000 }, (_, i) => `l${i}`).join('\n')
    installNexgraph({ graph: { code: vi.fn(async () => slice({ start: 1, end: 2000, text })) } })
    render(<CodeViewer {...props} line={1} />)
    expect(await screen.findByText('Chỉ hiện tối đa 2.000 dòng')).toBeInTheDocument()
  })

  it('shows the file name and closes', async () => {
    const onClose = vi.fn()
    installNexgraph({ graph: { code: vi.fn(async () => slice()) } })
    render(<CodeViewer {...props} onClose={onClose} />)
    expect(screen.getByText('lib/a.dart')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Đóng' }))
    expect(onClose).toHaveBeenCalled()
  })
})
