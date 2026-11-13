// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { installNexgraph } from '../../test-utils'
import { ExportDialog } from './ExportDialog'

const props = { projectId: 'p1', projectName: 'demo', scope: { kind: 'all' } as const, onClose: () => {} }

describe('ExportDialog', () => {
  it('xuất HTML vào thư mục đã chọn và cho mở thư mục', async () => {
    const { api } = installNexgraph({ exporter: { pickDir: vi.fn(async () => '/tmp/out'),
      run: vi.fn(async () => ({ files: ['/tmp/out/demo-graph.html'], truncated: false })) } })
    render(<ExportDialog {...props} />)
    await userEvent.click(screen.getByLabelText('HTML tương tác'))
    await userEvent.click(screen.getByRole('button', { name: 'Chọn thư mục và xuất' }))
    expect(api.exporter.run).toHaveBeenCalledWith('p1', 'html', { kind: 'all' }, '/tmp/out')
    expect(await screen.findByText('/tmp/out/demo-graph.html')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Mở thư mục' }))
    expect(api.exporter.reveal).toHaveBeenCalledWith('/tmp/out/demo-graph.html')
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
    expect(api.exporter.run).toHaveBeenCalledWith('p1', 'html', { kind: 'all' }, '/Đồ án/xuất')
  })

  it('PNG chụp vùng đang xem', async () => {
    const { api } = installNexgraph({ exporter: { png: vi.fn(async () => '/tmp/nexgraph.png') } })
    render(<ExportDialog {...props} />)
    await userEvent.click(screen.getByLabelText('Ảnh PNG vùng đang xem'))
    await userEvent.click(screen.getByRole('button', { name: 'Lưu ảnh PNG' }))
    expect(api.exporter.png).toHaveBeenCalled()
    expect(await screen.findByText('/tmp/nexgraph.png')).toBeInTheDocument()
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
})
