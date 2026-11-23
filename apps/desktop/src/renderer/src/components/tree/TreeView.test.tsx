// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GraphNode, Neighborhood, NodeKind } from '@shared/graph-types'
import type { LspDiagnosticsEvent, ProjectDirectory } from '@shared/api'
import { emptyChanges, installNexgraph } from '../../test-utils'
import { startDiagnostics } from '../../state/diagnostics'
import { setLocale, useLocale } from '../../state/locale'
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

afterEach(() => setLocale('vi'))

/** Cha theo dõi locale như App thật: đổi ngôn ngữ thì cây vẽ lại. */
function LocaleHost({ render }: { render: () => ReactNode }) {
  useLocale()
  return <>{render()}</>
}

describe('TreeView', () => {
  it('cây mở thư mục khi bấm và gọi neighbors đúng tham số', async () => {
    const { api } = installNexgraph({ graph: { neighbors } })
    render(<TreeView projectId="p1" onOpenNode={() => {}} onOpenCode={() => {}} />)
    expect(api.graph.neighbors).toHaveBeenCalledWith('p1', { node: '.#repository', types: ['CONTAINS', 'DEFINES'], direction: 'out', depth: 1, limit: 500 })
    const items = await screen.findAllByRole('treeitem')
    expect(items.map((i) => i.getAttribute('aria-label'))).toEqual(['src', 'README.md']) // thư mục trước
    await userEvent.click(screen.getByRole('button', { name: 'Mở src' }))
    expect(await screen.findByRole('treeitem', { name: 'app.py' })).toBeInTheDocument()
    expect(screen.getAllByText('Tệp').length).toBeGreaterThan(0)
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
  it('tạo, đổi tên, nhân bản và chuyển tệp vào thùng rác từ cây', async () => {
    let entries: ProjectDirectory['entries'] = [{ path: 'old.txt', name: 'old.txt', kind: 'file' }]
    const list = vi.fn(async (): Promise<ProjectDirectory> => ({ entries, truncated: false }))
    const createFile = vi.fn(async (_pid: string, path: string) => {
      entries = [...entries, { path, name: path, kind: 'file' }]
    })
    const rename = vi.fn(async (_pid: string, from: string, to: string) => {
      entries = entries.map((entry) => entry.path === from ? { ...entry, path: to, name: to } : entry)
    })
    const copy = vi.fn(async () => {
      entries = [...entries, { path: 'new copy.txt', name: 'new copy.txt', kind: 'file' }]
      return 'new copy.txt'
    })
    const trash = vi.fn(async (_pid: string, path: string) => { entries = entries.filter((entry) => entry.path !== path) })
    installNexgraph({ fs: { list, createFile, rename, copy, trash } })
    const onOpenCode = vi.fn()
    const onRename = vi.fn()
    const onTrash = vi.fn()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<TreeView projectId="p1" compact onOpenNode={() => {}} onOpenCode={onOpenCode} onRename={onRename} onTrash={onTrash} />)

    const old = await screen.findByRole('treeitem', { name: 'old.txt' })
    fireEvent.contextMenu(old, { clientX: 20, clientY: 20 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Đổi tên' }))
    const edit = screen.getByRole('textbox', { name: 'Đổi tên' })
    fireEvent.change(edit, { target: { value: 'new.txt' } })
    fireEvent.keyDown(edit, { key: 'Enter' })
    await screen.findByRole('treeitem', { name: 'new.txt' })
    expect(rename).toHaveBeenCalledWith('p1', 'old.txt', 'new.txt')
    expect(onRename).toHaveBeenCalledWith('old.txt', 'new.txt')

    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'new.txt' }), { clientX: 20, clientY: 20 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Nhân bản' }))
    await screen.findByRole('treeitem', { name: 'new copy.txt' })
    expect(copy).toHaveBeenCalledWith('p1', 'new.txt', '.')

    fireEvent.contextMenu(screen.getByRole('tree', { name: 'Cây dự án' }), { clientX: 20, clientY: 20 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Tệp mới' }))
    const input = screen.getByRole('textbox', { name: 'Tệp mới' })
    fireEvent.change(input, { target: { value: 'created.txt' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await screen.findByRole('treeitem', { name: 'created.txt' })
    expect(onOpenCode).toHaveBeenCalledWith('created.txt')

    const created = screen.getByRole('treeitem', { name: 'created.txt' })
    created.focus()
    fireEvent.keyDown(created, { key: 'Delete' })
    await waitFor(() => expect(trash).toHaveBeenCalledWith('p1', 'created.txt'))
    expect(onTrash).toHaveBeenCalledWith('created.txt')
    confirm.mockRestore()
  })

  it('không đổi tên hoặc xoá tệp chứa bản nháp chưa lưu', async () => {
    const list = vi.fn(async (): Promise<ProjectDirectory> => ({
      entries: [{ path: 'a.txt', name: 'a.txt', kind: 'file' }], truncated: false
    }))
    const rename = vi.fn()
    const trash = vi.fn()
    installNexgraph({ fs: { list, createFile: vi.fn(), rename, trash } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<TreeView projectId="p1" compact onOpenNode={() => {}} onOpenCode={() => {}} dirtyFiles={new Set(['a.txt'])} />)
    const item = await screen.findByRole('treeitem', { name: 'a.txt' })
    item.focus()
    fireEvent.keyDown(item, { key: 'F2' })
    expect(screen.getByRole('alert')).toHaveTextContent('Hãy lưu')
    fireEvent.keyDown(item, { key: 'Delete' })
    expect(screen.getByRole('alert')).toHaveTextContent('Hãy lưu')
    expect(rename).not.toHaveBeenCalled()
    expect(trash).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('lỗi thao tác đổi ngôn ngữ ngay khi cây còn mở', async () => {
    const list = vi.fn(async (): Promise<ProjectDirectory> => ({
      entries: [{ path: 'a.txt', name: 'a.txt', kind: 'file' }], truncated: false
    }))
    installNexgraph({ fs: { list, createFile: vi.fn(), rename: vi.fn(), trash: vi.fn() } })
    render(<LocaleHost render={() => <TreeView projectId="p1" compact onOpenNode={() => {}} onOpenCode={() => {}} dirtyFiles={new Set(['a.txt'])} />} />)
    const item = await screen.findByRole('treeitem', { name: 'a.txt' })
    item.focus()
    fireEvent.keyDown(item, { key: 'F2' })
    expect(screen.getByRole('alert')).toHaveTextContent('Hãy lưu các tệp đang sửa trước khi đổi tên hoặc di chuyển.')
    act(() => setLocale('en'))
    expect(screen.getByRole('alert')).toHaveTextContent('Save modified files before renaming or moving them.')
  })

  it('ghép đôi khi double-click và đóng khi middle-click trong cây compact', async () => {
    const list = vi.fn(async (): Promise<ProjectDirectory> => ({ entries: [{ path: 'app.py', name: 'app.py', kind: 'file' }], truncated: false }))
    installNexgraph({ fs: { list } })
    const onPreviewFile = vi.fn()
    const onPinFile = vi.fn()
    const onCloseFile = vi.fn()
    render(<TreeView projectId="p1" compact onOpenNode={() => {}} onOpenCode={() => {}}
      onPreviewFile={onPreviewFile} onPinFile={onPinFile} onCloseFile={onCloseFile} />)
    const row = await screen.findByRole('treeitem', { name: 'app.py' })

    fireEvent.click(row)
    expect(onPreviewFile).toHaveBeenCalledWith('app.py', 1)
    fireEvent.doubleClick(row)
    expect(onPinFile).toHaveBeenCalledWith('app.py', 1)
    fireEvent(row, new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(onCloseFile).toHaveBeenCalledWith('app.py')
  })

  it('tự mở rộng thư mục chứa tệp đang hoạt động', async () => {
    const list = vi.fn(async (_pid: string, path: string): Promise<ProjectDirectory> => ({
      entries: path === '.' ? [{ path: 'src', name: 'src', kind: 'directory' }]
        : [{ path: 'src/nest-cli.json', name: 'nest-cli.json', kind: 'file' }],
      truncated: false
    }))
    installNexgraph({ fs: { list } })
    render(<TreeView projectId="p1" compact onOpenNode={() => {}} onOpenCode={() => {}} activeFile="src/nest-cli.json" />)

    expect(await screen.findByRole('treeitem', { name: 'nest-cli.json', selected: true })).toBeVisible()
    expect(screen.getByRole('treeitem', { name: 'src', expanded: true })).toBeVisible()
  })

  it('hiện huy hiệu thay đổi git và số vấn đề trên dòng tệp', async () => {
    const list = vi.fn(async (): Promise<ProjectDirectory> => ({ entries: [{ path: 'app.py', name: 'app.py', kind: 'file' }], truncated: false }))
    installNexgraph({ fs: { list }, graph: {
      changes: vi.fn(async () => emptyChanges({ changed_files: [{ path: 'app.py', status: 'M', old_path: null }] }))
    } })
    let emit: (event: LspDiagnosticsEvent) => void = () => {}
    Object.assign(window.nexgraph, { lsp: {
      onDiagnostics: (cb: (event: LspDiagnosticsEvent) => void) => { emit = cb; return () => {} }
    } })
    const stop = startDiagnostics()
    const at = { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } }
    act(() => emit({ projectId: 'p-badge', file: 'app.py', diagnostics: [
      { range: at, severity: 1, message: 'lỗi' }, { range: at, severity: 2, message: 'cảnh báo' }
    ] }))
    render(<TreeView projectId="p-badge" compact onOpenNode={() => {}} onOpenCode={() => {}} />)

    const row = await screen.findByRole('treeitem', { name: 'app.py' })
    expect(within(row).getByLabelText('Thay đổi git: M')).toHaveTextContent('M')
    expect(within(row).getByLabelText('2 vấn đề')).toHaveTextContent('2')
    stop()
  })

})
