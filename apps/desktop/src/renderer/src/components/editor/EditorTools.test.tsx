// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
})
