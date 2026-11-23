// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GraphNode } from '@shared/graph-types'
import { emptyChanges } from '../../test-utils'
import { ChangesPanel } from './ChangesPanel'

const gnode = (id: string, label: string, over: Partial<GraphNode> = {}): GraphNode => ({
  id, kind: 'method', label, qualified_name: label, language: 'dart', file: 'lib/a.dart', line_start: 3, line_end: 9,
  is_test: false, origin: 'ast', signature: null, community: null, ...over
})

const full = emptyChanges({
  changed_files: [{ path: 'lib/services/auth_service.dart', status: 'M', old_path: null }, { path: 'lib/new.dart', status: 'A', old_path: null }],
  changed_nodes: [gnode('n:login', 'login')],
  impacted: [{ node: gnode('n:build', 'build'), score: 1, hops: 1 }, { node: gnode('n:screen', 'LoginScreen'), score: 0.36, hops: 2 }],
  tests: [gnode('n:t', 'login returns a user', { kind: 'test', is_test: true })],
  test_gaps: [{ ...gnode('n:gap', 'logout'), qualified_name: 'AuthService.logout' }]
})

const base = { loading: false, error: null, onReload: vi.fn(), onOpenNode: vi.fn() }

describe('ChangesPanel', () => {
  it('names the comparison base: short SHA for git, the note without git', () => {
    const { rerender } = render(<ChangesPanel {...base} changes={full} />)
    expect(screen.getByText('So với HEAD a1b2c3d')).toBeInTheDocument()
    rerender(<ChangesPanel {...base} changes={{ ...full, base: 'last_index', base_commit: null, note: 'Không có Git: so với lần lập chỉ mục trước' }} />)
    expect(screen.getByText('Không có Git: so với lần lập chỉ mục trước')).toBeInTheDocument()
  })

  it('lists files with status, impacted nodes with score and hops, tests and gaps', () => {
    render(<ChangesPanel {...base} changes={full} />)
    const files = screen.getByRole('region', { name: 'Đã thay đổi' })
    expect(within(files).getByText('lib/services/auth_service.dart')).toBeInTheDocument()
    expect(within(files).getByText('M')).toBeInTheDocument()
    expect(within(files).getByText('A')).toBeInTheDocument()
    const impacted = screen.getByRole('region', { name: 'Vùng ảnh hưởng' })
    expect(within(impacted).getByText('1,00')).toBeInTheDocument()
    expect(within(impacted).getByText('0,36')).toBeInTheDocument()
    expect(within(impacted).getByText('2 bước')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Test liên quan' })).getByText('login returns a user')).toBeInTheDocument()
    const gaps = screen.getByRole('region', { name: 'Chưa có test' })
    expect(within(gaps).getByText('AuthService.logout')).toBeInTheDocument() // tên lớp phân biệt hai phương thức cùng nhãn
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('opens a node when its entry is clicked', async () => {
    const onOpenNode = vi.fn()
    render(<ChangesPanel {...base} onOpenNode={onOpenNode} changes={full} />)
    await userEvent.click(within(screen.getByRole('region', { name: 'Vùng ảnh hưởng' })).getByRole('button', { name: /build/ }))
    expect(onOpenNode).toHaveBeenCalledWith('n:build')
  })

  it('says there is nothing when the tree is clean, and warns when the list was cut', () => {
    const { rerender } = render(<ChangesPanel {...base} changes={emptyChanges()} />)
    expect(screen.getByText('Chưa có thay đổi')).toBeInTheDocument()
    rerender(<ChangesPanel {...base} changes={{ ...full, truncated: true }} />)
    expect(screen.getByText('Danh sách đã bị cắt bớt')).toBeInTheDocument()
  })

  it('hiện vùng ảnh hưởng và test khi xem impact của một node, dù không có tệp nào đổi (A3 #1)', () => {
    const impactView = emptyChanges({
      base: 'last_index', base_commit: null,
      note: 'Ảnh hưởng nếu sửa helper',
      changed_files: [],
      changed_nodes: [gnode('n:helper', 'helper')],
      impacted: [{ node: gnode('n:main', 'main', { file: 'main.py', line_start: 7 }), score: 0.8, hops: 1 }],
      tests: [gnode('n:t', 'test_main calls helper', { kind: 'test', is_test: true, file: 'tests/test_main.py' })]
    })
    render(<ChangesPanel {...base} changes={impactView} />)
    expect(screen.queryByText('Chưa có thay đổi')).not.toBeInTheDocument()
    expect(screen.getByText('Ảnh hưởng nếu sửa helper')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Nút đang xét' })).toHaveTextContent('helper')
    expect(within(screen.getByRole('region', { name: 'Vùng ảnh hưởng' })).getByText('main')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Test liên quan' })).getByText('test_main calls helper')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Chưa có test' })).not.toBeInTheDocument()
  })

  it('nói rõ khi node không ảnh hưởng tới đâu và không có test', () => {
    const lonely = emptyChanges({ changed_files: [], changed_nodes: [gnode('n:x', 'lonely')], impacted: [], tests: [] })
    render(<ChangesPanel {...base} changes={lonely} />)
    expect(within(screen.getByRole('region', { name: 'Vùng ảnh hưởng' })).getByText('Không có nút nào bị ảnh hưởng')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Test liên quan' })).getByText('Không tìm thấy test liên quan')).toBeInTheDocument()
  })

  it('reload button, loading state and error state', async () => {
    const onReload = vi.fn()
    const { rerender } = render(<ChangesPanel {...base} onReload={onReload} changes={null} loading />)
    expect(screen.getByRole('status')).toHaveTextContent('Đang tải')
    rerender(<ChangesPanel {...base} onReload={onReload} changes={null} error="Engine lỗi" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Engine lỗi')
    await userEvent.click(screen.getByRole('button', { name: 'Làm mới' }))
    expect(onReload).toHaveBeenCalled()
  })

  it('offers "Mở mã" only when the handler is given', async () => {
    const onOpenCode = vi.fn()
    const { rerender } = render(<ChangesPanel {...base} changes={full} />)
    expect(screen.queryByRole('button', { name: /Mở mã/ })).not.toBeInTheDocument()
    rerender(<ChangesPanel {...base} onOpenCode={onOpenCode} changes={full} />)
    await userEvent.click(screen.getAllByRole('button', { name: /Mở mã/ })[0])
    expect(onOpenCode).toHaveBeenCalledWith('lib/services/auth_service.dart', undefined)
  })
})
