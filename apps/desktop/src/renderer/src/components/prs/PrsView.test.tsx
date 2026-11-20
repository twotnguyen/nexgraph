// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GraphNode, PrDetail, PrList, PrListItem } from '@shared/graph-types'
import { installNexgraph } from '../../test-utils'
import { PrsView } from './PrsView'

const gnode = (id: string, label: string, file = 'util.py'): GraphNode => ({ id, kind: 'function', label, qualified_name: label,
  language: 'python', file, line_start: 1, line_end: 2, is_test: false, origin: 'ast', signature: null, community: null })

const pr = (number: number, status: PrListItem['status'], over: Partial<PrListItem> = {}): PrListItem => ({
  number, title: `PR ${number}`, branch: `f${number}`, base: 'main', author: 'an', draft: false, review: null, ci: 'SUCCESS',
  updated_at: '2026-11-20T00:00:00Z', days_old: 1, status, url: null, files: ['util.py'], nodes_affected: 3, ...over
})

const list: PrList = { repo: 'acme/demo', default_branch: 'main', base: 'main', truncated: false,
  prs: [pr(6, 'APPROVED'), pr(8, 'READY')], conflicts: [{ a: 6, b: 8, files: ['util.py'], nodes: 2 }] }

const detail: PrDetail = {
  pr: pr(8, 'READY'), changed_files: [{ path: 'util.py', status: 'M', old_path: null }],
  changed_nodes: [gnode('util.py::helper#function', 'helper')],
  impacted: [{ node: gnode('main.py::step#method', 'step', 'main.py'), score: 0.8, hops: 1 }],
  tests: [], test_gaps: [gnode('main.py::run#function', 'run', 'main.py')],
  stale_docs: [{ node: { ...gnode('README.md::Demo#document', 'Demo', 'README.md'), kind: 'document' }, symbols: ['helper'] }],
  unreferenced: [{ node: gnode('util.py::orphan#function', 'orphan'), heuristic: true }],
  test_selection: { files: ['test_util.py'], commands: ['python -m pytest test_util.py'], run_all: true, reasons: ['1 symbol đổi chưa tìm được test'] },
  cross_repo: null, comment: '## Review cục bộ: PR #8', truncated: false
}

describe('PrsView', () => {
  it('liệt kê PR với nhãn và xung đột', async () => {
    installNexgraph({ prs: { list: vi.fn(async () => list) } })
    render(<PrsView projectId="p1" onOpenNode={vi.fn()} />)
    expect(await screen.findByText('Đã duyệt')).toBeInTheDocument()
    expect(screen.getByText('Sẵn sàng')).toBeInTheDocument()
    expect(screen.getByText('#6 và #8')).toBeInTheDocument()
    expect(screen.getByText('cùng tệp: util.py')).toBeInTheDocument()
  })

  it('chọn PR hiện review, mở nút và sao chép nhận xét', async () => {
    const detailFn = vi.fn(async () => detail)
    installNexgraph({ prs: { list: vi.fn(async () => list), detail: detailFn } })
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const onOpenNode = vi.fn()
    render(<PrsView projectId="p1" onOpenNode={onOpenNode} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Xem review của PR #8' }))
    expect(detailFn).toHaveBeenCalledWith('p1', 8)
    expect(await screen.findByText('Tài liệu có thể đã cũ')).toBeInTheDocument()
    expect(screen.getByText('Code có thể không còn ai gọi (heuristic)')).toBeInTheDocument()
    expect(screen.getByText(/Chưa chắc chắn, nên chạy toàn bộ test/)).toBeInTheDocument()
    expect(screen.getByText('python -m pytest test_util.py')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'orphan' }))
    expect(onOpenNode).toHaveBeenCalledWith('util.py::orphan#function')
    await userEvent.click(screen.getByRole('button', { name: 'Sao chép nhận xét' }))
    expect(writeText).toHaveBeenCalledWith('## Review cục bộ: PR #8')
    expect(await screen.findByText('Đã sao chép')).toBeInTheDocument()
  })

  it('hiện lỗi gh có nút thử lại', async () => {
    const listFn = vi.fn().mockRejectedValueOnce({ code: 'gh_auth', message: 'GitHub CLI chưa đăng nhập' }).mockResolvedValueOnce(list)
    installNexgraph({ prs: { list: listFn } })
    render(<PrsView projectId="p1" onOpenNode={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub CLI chưa đăng nhập')
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    expect(await screen.findByText('Đã duyệt')).toBeInTheDocument()
  })
})
