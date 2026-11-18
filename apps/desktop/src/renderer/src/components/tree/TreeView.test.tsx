// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GraphNode, Neighborhood, NodeKind } from '@shared/graph-types'
import type { ProjectDirectory } from '@shared/api'
import { installNexgraph } from '../../test-utils'
import { TreeView } from './TreeView'

const gnode = (id: string, kind: NodeKind, label: string, line: number | null = null): GraphNode => ({ id, kind, label, qualified_name: label,
  language: null, file: kind === 'directory' ? null : 'src/app.py', line_start: line, line_end: line, is_test: false, origin: 'ast', signature: null, community: null })

const hood = (center: GraphNode, kids: GraphNode[], truncated = false): Neighborhood => ({
  nodes: [center, ...kids],
  edges: kids.map((k, i) => ({ id: i + 1, source: center.id, target: k.id, type: 'CONTAINS', subtype: null, confidence: 'EXTRACTED' as const,
    confidence_score: 1, origin: 'ast', evidence: null })),
  truncated
})

const root = gnode('.#repository', 'repository', 'demo')
const src = gnode('src#directory', 'directory', 'src')
const readme = gnode('README.md#file', 'file', 'README.md')
const app = gnode('src/app.py#file', 'file', 'app.py')
const fnB = gnode('src/app.py::b#function', 'function', 'b', 20)
const fnA = gnode('src/app.py::a#function', 'function', 'a', 5)

const neighbors = vi.fn(async (_p: string, q: { node: string }) => {
  if (q.node === root.id) return hood(root, [readme, src])
  if (q.node === src.id) return hood(src, [app], true)
  if (q.node === app.id) return hood(app, [fnB, fnA])
  return hood(gnode(q.node, 'file', q.node), [])
})

describe('TreeView', () => {
  it('cây mở thư mục khi bấm và gọi neighbors đúng tham số', async () => {
    const { api } = installNexgraph({ graph: { neighbors } })
    render(<TreeView projectId="p1" onOpenNode={() => {}} onOpenCode={() => {}} />)
    expect(api.graph.neighbors).toHaveBeenCalledWith('p1', { node: '.#repository', types: ['CONTAINS', 'DEFINES'], direction: 'out', depth: 1, limit: 500 })
    const items = await screen.findAllByRole('treeitem')
    expect(items.map((i) => i.getAttribute('aria-label'))).toEqual(['src', 'README.md']) // thư mục trước
    await userEvent.click(screen.getByRole('button', { name: 'Mở src' }))
    expect(await screen.findByRole('treeitem', { name: 'app.py' })).toBeInTheDocument()
    expect(screen.getByText(/còn nữa, dùng Tìm kiếm/)).toBeInTheDocument()
  })

  it('symbol sắp theo dòng, mở code và mở node', async () => {
    installNexgraph({ graph: { neighbors } })
    const onOpenCode = vi.fn()
    const onOpenNode = vi.fn()
    render(<TreeView projectId="p1" onOpenNode={onOpenNode} onOpenCode={onOpenCode} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Mở src' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Mở app.py' }))
    await screen.findByRole('treeitem', { name: 'a' })
    const labels = screen.getAllByRole('treeitem').map((i) => i.getAttribute('aria-label'))
    expect(labels.indexOf('a')).toBeLessThan(labels.indexOf('b'))
    await userEvent.click(screen.getByRole('button', { name: 'Mở mã a' }))
    expect(onOpenCode).toHaveBeenCalledWith('src/app.py', 5)
    await userEvent.click(screen.getByText('b'))
    expect(onOpenNode).toHaveBeenCalledWith('src/app.py::b#function')
  })

  it('điều hướng bằng phím mũi tên', async () => {
    installNexgraph({ graph: { neighbors } })
    render(<TreeView projectId="p1" onOpenNode={() => {}} onOpenCode={() => {}} />)
    const first = await screen.findByRole('treeitem', { name: 'src' })
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    await screen.findByRole('treeitem', { name: 'app.py' })
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: 'app.py' })))
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowLeft' })
    await waitFor(() => expect(document.activeElement).toBe(first))
    fireEvent.keyDown(first, { key: 'ArrowLeft' })
    await waitFor(() => expect(screen.queryByRole('treeitem', { name: 'app.py' })).toBeNull())
  })

  it('mở tệp cấu hình ngoài chỉ mục và giữ nhánh đã mở khi cây làm mới', async () => {
    let entries: ProjectDirectory['entries'] = [{ path: 'src/app.py', name: 'app.py', kind: 'file' }]
    const list = vi.fn(async (_pid: string, path: string): Promise<ProjectDirectory> => ({
      entries: path === '.' ? [
        { path: 'src', name: 'src', kind: 'directory' },
        { path: 'package.json', name: 'package.json', kind: 'file' }
      ] : entries,
      truncated: false
    }))
    const index = vi.fn(neighbors)
    installNexgraph({ fs: { list }, graph: { neighbors: index } })
    const onOpenCode = vi.fn()
    const explorer = (revision: number) => (
      <TreeView projectId="p1" compact revision={revision} onOpenNode={() => {}} onOpenCode={onOpenCode} activeFile="package.json" />
    )
    const tree = render(explorer(0))

    await userEvent.click(await screen.findByRole('treeitem', { name: 'package.json', selected: true }))
    expect(onOpenCode).toHaveBeenCalledWith('package.json', 1)
    await userEvent.click(screen.getByRole('treeitem', { name: 'src' }))
    expect(await screen.findByRole('treeitem', { name: 'app.py' })).toBeVisible()
    expect(index).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Mở app.py' }))
    expect(await screen.findByRole('treeitem', { name: 'a' })).toBeVisible()
    entries = [{ path: 'src/nest-cli.json', name: 'nest-cli.json', kind: 'file' }, ...entries]
    tree.rerender(explorer(1))

    expect(await screen.findByRole('treeitem', { name: 'nest-cli.json' })).toBeVisible()
    expect(screen.getByRole('treeitem', { name: 'src', expanded: true })).toBeVisible()
    expect(screen.getByRole('treeitem', { name: 'app.py', expanded: true })).toBeVisible()
  })
})
