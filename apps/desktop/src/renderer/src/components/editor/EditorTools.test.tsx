// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NexGraphApi } from '@shared/api'
import type { EditorHandle } from './monaco'
import type { ActiveEditor } from '../../state/activeEditor'
import { runCommand } from '../../state/commands'
import { installNexgraph } from '../../test-utils'
import { EditorTools } from './EditorTools'

vi.mock('./monaco', () => ({ syncProjectModels: vi.fn(async () => {}), applyWorkspaceEdit: vi.fn(async () => {}) }))

function handle(): EditorHandle {
  return {
    getValue: () => 'one\ntwo\nthree', setValue: vi.fn(), onChange: vi.fn(), setReadOnly: vi.fn(), dispose: vi.fn(),
    revealLines: vi.fn(), getPosition: () => ({ line: 2, column: 3 }), getLineCount: () => 3,
    getScrollPosition: () => ({ top: 8, left: 4 }), previewPosition: vi.fn(), clearPreview: vi.fn(),
    setScrollPosition: vi.fn(), revealPosition: vi.fn(), getWordAtCursor: () => 'old', watchChanges: () => () => {}
  }
}
const props = (active: ActiveEditor) => ({ projectId: 'p1', editor: active, symbols: [], symbolsError: null,
  onOpen: vi.fn(), onDiagnostics: vi.fn(), onError: vi.fn() })

beforeEach(() => { localStorage.clear() })

describe('EditorTools', () => {
  it('previews go-to-line input and restores scroll on escape', () => {
    const active = { file: 'a.ts', handle: handle(), text: () => 'one\ntwo\nthree' }
    render(<EditorTools {...props(active)} />)
    act(() => runCommand('editor.goto_line'))
    expect(screen.getByText('Dòng hiện tại: 2 / 3 (cột 3)')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('Dòng[:cột] hoặc +/- số dòng'), { target: { value: '+1' } })
    expect(active.handle.previewPosition).toHaveBeenCalledWith(3)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(active.handle.clearPreview).toHaveBeenCalled()
    expect(active.handle.setScrollPosition).toHaveBeenCalledWith({ top: 8, left: 4 })
  })

  it('reports rename errors in the dialog', async () => {
    const active = { file: 'a.ts', handle: handle(), text: () => 'one\ntwo\nthree' }
    installNexgraph()
    const api = window.nexgraph as NexGraphApi
    api.lsp = { rename: vi.fn(async () => { throw new Error('Không có ký hiệu') }) } as unknown as NexGraphApi['lsp']
    render(<EditorTools {...props(active)} />)
    act(() => runCommand('editor.rename'))
    fireEvent.click(screen.getByRole('button', { name: 'Đổi tên' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Không có ký hiệu')
  })

  describe('permalink', () => {
    const url = 'https://github.com/o/r/blob/abc/src/a.ts#L3-L5'
    const writeText = vi.fn(async (_text: string) => {})
    const setup = (result: () => Promise<{ url: string; published: boolean }>, selection: { text: string; start: number; end: number } | null) => {
      installNexgraph()
      const permalink = vi.fn(result)
      ;(window.nexgraph as NexGraphApi).git = { permalink } as unknown as NexGraphApi['git']
      const active = { file: 'src/a.ts', handle: { ...handle(), getSelection: () => selection }, text: () => 'one\ntwo\nthree' }
      const p = props(active)
      render(<EditorTools {...p} />)
      return { permalink, onError: p.onError }
    }
    beforeEach(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true }) })
    afterEach(() => { writeText.mockClear(); vi.restoreAllMocks() })

    it('copies the link of the selected lines and says nothing when HEAD is on the remote', async () => {
      const { permalink, onError } = setup(async () => ({ url, published: true }), { text: 'x', start: 3, end: 5 })
      act(() => runCommand('git.copy_permalink'))
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(url))
      expect(permalink).toHaveBeenCalledWith('p1', 'src/a.ts', 3, 5, 'one\ntwo\nthree')
      expect(onError).not.toHaveBeenCalled()
    })

    it('uses the cursor line without a selection, opens the link in the browser and warns when HEAD is unpublished', async () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null)
      const { permalink, onError } = setup(async () => ({ url, published: false }), null)
      act(() => runCommand('git.open_permalink'))
      await waitFor(() => expect(open).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer'))
      expect(permalink).toHaveBeenCalledWith('p1', 'src/a.ts', 2, 2, 'one\ntwo\nthree')
      expect(writeText).not.toHaveBeenCalled()
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('chưa có trên remote'))
    })

    it('shows the main-process error and neither copies nor opens anything', async () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null)
      const { onError } = setup(async () => { throw { code: 'unsupported_remote', message: 'Remote chưa được hỗ trợ' } }, null)
      act(() => runCommand('git.copy_permalink'))
      await waitFor(() => expect(onError).toHaveBeenCalledWith('Remote chưa được hỗ trợ'))
      expect(writeText).not.toHaveBeenCalled()
      expect(open).not.toHaveBeenCalled()
    })
  })
})
