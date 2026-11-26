// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { installNexgraph, project } from '../../test-utils'

vi.mock('../../features/architecture/layout/elkLayoutService', async () => ({
  layoutDiagram: async (nodes: { id: string }[]) => ({ pos: Object.fromEntries(nodes.map((n, i) => [n.id, { x: i * 220, y: 0 }])), routes: {} })
}))
// jsdom không chạy Monaco.
vi.mock('../../features/editor/monaco', () => ({ languageFor: () => 'plaintext', createEditor: vi.fn(), createDiffEditor: vi.fn(), createMirror: () => null }))

import { WorkspaceScreen } from './WorkspaceScreen'
import { setChatDock, setChatWidth, setExplorerOpen } from '../../shared/lib/layoutPrefs'

beforeAll(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  vi.stubGlobal('ResizeObserver', RO)
  vi.stubGlobal('DOMMatrixReadOnly', class { m22 = 1; constructor() {} })
})
beforeEach(() => localStorage.clear())
afterEach(cleanup)

it('tuỳ chọn "Mở sẵn cây tệp": mặc định hiện cây tệp khi vào dự án, tắt thì không', () => {
  installNexgraph()
  const first = render(<WorkspaceScreen project={project()} />)
  expect(screen.getByRole('complementary', { name: 'Duyệt tệp' })).toBeVisible()
  first.unmount()

  setExplorerOpen(false)
  installNexgraph()
  render(<WorkspaceScreen project={project()} />)
  expect(screen.queryByRole('complementary', { name: 'Duyệt tệp' })).not.toBeInTheDocument()
})

it('đổi vị trí và độ rộng khung chat khi workspace đang mở (bị Cài đặt che phía sau) áp dụng ngay', () => {
  localStorage.setItem('nexgraph.chat.dock', 'right')
  installNexgraph()
  const { container } = render(<WorkspaceScreen project={project()} />)
  const shell = () => container.querySelector<HTMLElement>('.workspace-shell')!
  expect(shell().dataset.chatDock).toBe('right')
  act(() => { setChatDock('left'); setChatWidth(500) })
  expect(shell().dataset.chatDock).toBe('left')
  expect(shell().style.getPropertyValue('--ws-chat')).toBe('500px')
})
