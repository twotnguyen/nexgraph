// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { ExportScope } from '@nexgraph/contracts/graph-types'
import { describe, expect, it, vi } from 'vitest'
import { installNexgraph } from '../../test-utils'
import { ExportDialog } from './ExportDialog'

const props = { projectId: 'p1', projectName: 'demo', scope: { kind: 'all' } as const, onClose: () => {} }

/** Mô phỏng chỗ dùng thật: một nút mở hộp thoại, hộp thoại nằm cạnh nút đó. */
function Opener({ scope }: { scope: ExportScope }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Xuất cộng đồng go</button>
      <button type="button">Xuất cộng đồng java</button>
      {open && <ExportDialog projectId="p1" projectName="demo" scope={scope} scopeLabel="go" onClose={() => setOpen(false)} />}
    </>
  )
}

describe('ExportDialog', () => {
  it('xuất HTML vào thư mục đã chọn và cho mở thư mục', async () => {
    const { api } = installNexgraph({ exporter: { pickDir: vi.fn(async () => '/tmp/out'),
      run: vi.fn(async () => ({ files: ['/tmp/out/demo-graph.html'], truncated: false })) } })
    render(<ExportDialog {...props} />)
    await userEvent.click(screen.getByLabelText('HTML tương tác'))
    await userEvent.click(screen.getByRole('button', { name: 'Chọn thư mục và xuất' }))
    expect(api.exporter.pickDir).toHaveBeenCalledWith('p1')
    expect(api.exporter.run).toHaveBeenCalledWith('p1', 'html', { kind: 'all' }, 'vi')
    expect(await screen.findByText('/tmp/out/demo-graph.html')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Mở thư mục' }))
    expect(api.exporter.reveal).toHaveBeenCalledWith('p1', '/tmp/out/demo-graph.html')
  })

  it('báo khi bị cắt', async () => {
    installNexgraph({ exporter: { run: vi.fn(async () => ({ files: ['/x/a.svg'], truncated: true })) } })
    render(<ExportDialog {...props} />)
    await userEvent.click(screen.getByLabelText('Ảnh SVG'))
    await userEvent.click(screen.getByRole('button', { name: 'Chọn thư mục và xuất' }))
    expect(await screen.findByText(/chỉ xuất 5\.000 node/)).toBeInTheDocument()
  })

  it('huỷ chọn thư mục thì không xuất', async () => {
    const { api } = installNexgraph({ exporter: { pickDir: vi.fn(async () => null) } })
    render(<ExportDialog {...props} />)
    await userEvent.click(screen.getByRole('button', { name: 'Chọn thư mục và xuất' }))
    expect(api.exporter.run).not.toHaveBeenCalled()
  })

  it('phạm vi node có thể đổi về toàn bộ dự án', async () => {
    const { api } = installNexgraph()
    render(<ExportDialog {...props} scope={{ kind: 'node', value: 'lib/a.dart#file' }} />)
    await userEvent.click(screen.getByLabelText('Toàn bộ dự án'))
    await userEvent.click(screen.getByRole('button', { name: 'Chọn thư mục và xuất' }))
    expect(api.exporter.run).toHaveBeenCalledWith('p1', 'html', { kind: 'all' }, 'vi')
  })

  it('PNG chụp vùng đang xem, không chụp chính hộp thoại', async () => {
    let dialogShown: boolean | null = null
    const png = vi.fn(async () => {
      dialogShown = screen.queryByRole('dialog') !== null
      return '/tmp/nexgraph.png'
    })
    const { api } = installNexgraph({ exporter: { png } })
    const canvas = document.createElement('div')
    canvas.className = 'canvas-wrap'
    canvas.getBoundingClientRect = () => ({ x: 10.4, y: 80, width: 600.6, height: 400, top: 80, left: 10.4, right: 611, bottom: 480, toJSON: () => ({}) })
    document.body.appendChild(canvas)
    render(<ExportDialog {...props} />)
    await userEvent.click(screen.getByLabelText('Ảnh PNG vùng đang xem'))
    await userEvent.click(screen.getByRole('button', { name: 'Lưu ảnh PNG' }))
    await waitFor(() => expect(api.exporter.png).toHaveBeenCalledWith('p1', { x: 10, y: 80, width: 601, height: 400 }))
    expect(dialogShown).toBe(false)
    expect(await screen.findByText('/tmp/nexgraph.png')).toBeInTheDocument()
    canvas.remove()
  })

  it('đẩy lên Neo4j với mật khẩu không lưu và hiện lỗi engine', async () => {
    const push = vi.fn().mockRejectedValueOnce({ code: 'push_failed', message: 'Không kết nối được' })
      .mockResolvedValueOnce({ nodes: 10, edges: 20, truncated: false })
    const { api } = installNexgraph({ exporter: { push } })
    render(<ExportDialog {...props} />)
    await userEvent.click(screen.getByLabelText('Đẩy lên Neo4j'))
    expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('type', 'password')
    await userEvent.clear(screen.getByLabelText('URI'))
    await userEvent.type(screen.getByLabelText('URI'), 'bolt://localhost:7687')
    await userEvent.type(screen.getByLabelText('Người dùng'), 'neo4j')
    await userEvent.type(screen.getByLabelText('Mật khẩu'), 'secret')
    await userEvent.click(screen.getByRole('button', { name: 'Đẩy lên server' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Không kết nối được')
    await userEvent.click(screen.getByRole('button', { name: 'Đẩy lên server' }))
    expect(api.exporter.push).toHaveBeenLastCalledWith('p1', { target: 'neo4j', uri: 'bolt://localhost:7687', user: 'neo4j', password: 'secret', scope: { kind: 'all' } })
    expect(await screen.findByText(/10 node, 20 cạnh/)).toBeInTheDocument()
  })

  it('đổi cộng đồng khi hộp thoại đang mở thì nhãn và phạm vi xuất theo cộng đồng mới (review #63, Important 2)', async () => {
    const { api } = installNexgraph()
    const { rerender } = render(<ExportDialog {...props} scope={{ kind: 'community', value: 'com:0' }} scopeLabel="go" />)
    expect(screen.getByRole('radio', { name: 'Cộng đồng go' })).toBeChecked()
    rerender(<ExportDialog {...props} scope={{ kind: 'community', value: 'com:1' }} scopeLabel="java" />)
    expect(screen.getByRole('radio', { name: 'Cộng đồng java' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Toàn bộ dự án' })).not.toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Chọn thư mục và xuất' }))
    expect(api.exporter.run).toHaveBeenCalledWith('p1', 'html', { kind: 'community', value: 'com:1' }, 'vi')
  })

  it('mở thì đưa focus vào hộp thoại, Tab không thoát ra sau lưng (review #63, Important 2)', async () => {
    render(<Opener scope={{ kind: 'community', value: 'com:0' }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Xuất cộng đồng go' }))
    const dialog = screen.getByRole('dialog', { name: 'Xuất đồ thị: demo' })
    expect(dialog.contains(document.activeElement)).toBe(true)

    const controls = dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')
    const first = controls[0]
    const last = controls[controls.length - 1]
    last.focus()
    await userEvent.tab()
    expect(document.activeElement).toBe(first)
    await userEvent.tab({ shift: true })
    expect(document.activeElement).toBe(last)

    // Như ca QA: focus lạc ra nút bên ngoài rồi bấm Tab — phải quay lại trong hộp thoại.
    screen.getByRole('button', { name: 'Xuất cộng đồng java' }).focus()
    await userEvent.tab()
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('Escape đóng hộp thoại và trả focus về nút đã mở (review #63, Minor 3)', async () => {
    render(<Opener scope={{ kind: 'community', value: 'com:0' }} />)
    const opener = screen.getByRole('button', { name: 'Xuất cộng đồng go' })
    await userEvent.click(opener)
    expect(screen.getByRole('dialog', { name: 'Xuất đồ thị: demo' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Xuất đồ thị: demo' })).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})
