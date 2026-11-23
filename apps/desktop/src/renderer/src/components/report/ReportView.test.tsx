// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GraphNode, GraphReport } from '@shared/graph-types'
import { installNexgraph } from '../../test-utils'
import { ReportView } from './ReportView'

const gnode = (id: string, label: string): GraphNode => ({ id, kind: 'function', label, qualified_name: label, language: 'python',
  file: 'util.py', line_start: 3, line_end: 9, is_test: false, origin: 'ast', signature: null, community: null })

const report = (over: Partial<GraphReport> = {}): GraphReport => ({
  god_nodes: [{ node: gnode('util.py::helper#function', 'helper'), degree: 12 }],
  communities: [{ id: 'com:0', label: 'Xác thực', size: 7, cohesion: 0.42 }],
  surprising: [{ source: 'login', target: 'cache', source_files: ['a.py', 'b.py'], relation: 'calls', why: 'khác cộng đồng' }],
  questions: [{ question: 'Vì sao helper được gọi nhiều?', why: 'node trung tâm' }],
  benchmark: { corpus_tokens: 100000, graph_tokens: 2000, reduction: 50 },
  truncated: false,
  cycles: { cycles: [], total: 0 },
  freshness: { indexed_at: 1763632800, index_commit: null, head_commit: null, changed_files: 0, stale: false },
  gaps: { isolated: { total: 0, nodes: [] }, ambiguous_edges: { total: 0, edges: [] } },
  ...over
})

const props = () => ({ projectId: 'p1', onOpenNode: vi.fn(), onAsk: vi.fn(), onExportMarkdown: vi.fn() })

describe('ReportView', () => {
  it('báo cáo hiện node trung tâm và mở node khi bấm', async () => {
    installNexgraph({ graph: { report: vi.fn(async () => report()) } })
    const p = props()
    render(<ReportView {...p} />)
    await userEvent.click(await screen.findByRole('button', { name: 'helper' }))
    expect(p.onOpenNode).toHaveBeenCalledWith('util.py::helper#function')
    expect(screen.getByText('Xác thực')).toBeInTheDocument()
    expect(screen.getByText(/login/)).toBeInTheDocument()
    expect(screen.getByText(/50/)).toBeInTheDocument()
  })

  it('bấm câu hỏi gợi ý chạy Hỏi graph, nút Xuất Markdown gọi callback', async () => {
    installNexgraph({ graph: { report: vi.fn(async () => report()) } })
    const p = props()
    render(<ReportView {...p} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Vì sao helper được gọi nhiều?' }))
    expect(p.onAsk).toHaveBeenCalledWith('Vì sao helper được gọi nhiều?')
    await userEvent.click(screen.getByRole('button', { name: 'Xuất Markdown' }))
    expect(p.onExportMarkdown).toHaveBeenCalled()
  })

  it('ẩn mục benchmark khi null và hiện lỗi engine', async () => {
    const reportFn = vi.fn().mockResolvedValueOnce(report({ benchmark: null })).mockRejectedValueOnce({ code: 'not_indexed', message: 'Chưa lập chỉ mục' })
    installNexgraph({ graph: { report: reportFn } })
    const { unmount } = render(<ReportView {...props()} />)
    await screen.findByText('Xác thực')
    expect(screen.queryByText('Mức giảm token')).toBeNull()
    unmount()
    render(<ReportView {...props()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa lập chỉ mục')
  })

  it('hiện vòng import, độ mới và lỗ hổng tri thức', async () => {
    const lonely = gnode('util.py::lonely#function', 'lonely')
    installNexgraph({ graph: { report: vi.fn(async () => report({
      cycles: { cycles: [{ files: ['a.py', 'b.py'], size: 2 }], total: 1 },
      freshness: { indexed_at: 1763632800, index_commit: 'aaaaaaa', head_commit: 'bbbbbbb', changed_files: 3, stale: true },
      gaps: { isolated: { total: 1, nodes: [lonely] }, ambiguous_edges: { total: 4, edges: [] } }
    })) } })
    const p = props()
    render(<ReportView {...p} />)
    expect(await screen.findByText('a.py → b.py')).toBeInTheDocument()
    expect(screen.getByText(/Graph cũ hơn mã nguồn: 3 tệp đã đổi/)).toBeInTheDocument()
    expect(screen.getByText(/4 cạnh chưa chắc chắn/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'lonely' }))
    expect(p.onOpenNode).toHaveBeenCalledWith('util.py::lonely#function')
  })

  it('không có vòng import thì báo rõ, graph mới thì không cảnh báo', async () => {
    installNexgraph({ graph: { report: vi.fn(async () => report()) } })
    render(<ReportView {...props()} />)
    expect(await screen.findByText('Không có vòng import giữa các tệp.')).toBeInTheDocument()
    expect(screen.queryByText(/Graph cũ hơn mã nguồn/)).not.toBeInTheDocument()
  })

  it('hiện cảnh báo của báo cáo (ví dụ benchmark không chạy được)', async () => {
    installNexgraph({ graph: { report: vi.fn(async () => report({
      benchmark: null, warnings: ['Không chạy được benchmark của báo cáo (RuntimeError: nổ)']
    })) } })
    render(<ReportView {...props()} />)
    expect(await screen.findByText(/Không chạy được benchmark của báo cáo/)).toBeInTheDocument()
  })
})