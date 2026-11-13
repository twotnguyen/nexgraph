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
  truncated: false, ...over
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
})
