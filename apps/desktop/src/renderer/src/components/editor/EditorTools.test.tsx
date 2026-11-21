// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LspCallHierarchyCall, LspCallHierarchyItem, LspDocumentSymbol, LspRange, NexGraphApi } from '@shared/api'
import type { EditorHandle } from './monaco'
import type { ActiveEditor } from '../../state/activeEditor'
import { runCommand } from '../../state/commands'
import { getEditorPrefs, setEditorPrefs } from '../../state/editorPrefs'
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

beforeEach(() => {
  localStorage.clear()
  setEditorPrefs({ lineNumbers: true, minimap: false, renderWhitespace: 'selection', stickyScroll: false, breadcrumbs: true,
    inlayHints: false, semanticHighlighting: false, codeLens: false, colorizeBrackets: false })
})

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

const lspRange = (sl: number, sc: number, el: number, ec: number): LspRange => ({ start: { line: sl, character: sc }, end: { line: el, character: ec } })

describe('EditorTools E3', () => {
  describe('chọn theo cây cú pháp', () => {
    const leaf = (name: string, sl: number, sc: number, ec: number): LspDocumentSymbol => ({
      name, kind: 13, range: lspRange(sl, sc, sl, ec), selectionRange: lspRange(sl, sc, sl, ec)
    })
    const inner: LspDocumentSymbol = {
      name: 'inner', kind: 6, range: lspRange(1, 0, 3, 0), selectionRange: lspRange(1, 0, 3, 0),
      children: [leaf('left', 1, 2, 8), leaf('right', 2, 2, 9)]
    }
    const symbols: LspDocumentSymbol[] = [{ name: 'outer', kind: 5, range: lspRange(0, 0, 4, 0), selectionRange: lspRange(0, 0, 4, 0), children: [inner] }]
    const setup = () => {
      let cursor = { line: 2, column: 5 }
      const selectRange = vi.fn((next: { startLine: number; startColumn: number; endLine: number; endColumn: number }) => {
        cursor = { line: next.startLine, column: next.startColumn }
      })
      const active = { file: 'a.ts', handle: { ...handle(), getPosition: () => cursor, selectRange } as EditorHandle, text: () => 'one\ntwo\nthree' }
      render(<EditorTools {...props(active)} symbols={symbols} />)
      return { selectRange, moveCursor: (line: number, column: number) => { cursor = { line, column } } }
    }

    it('mở rộng rồi thu hẹp và chuyển sang sibling', () => {
      const { selectRange } = setup()
      act(() => { runCommand('editor.select_larger') })
      expect(selectRange).toHaveBeenLastCalledWith({ startLine: 2, startColumn: 3, endLine: 2, endColumn: 9 })
      act(() => { runCommand('editor.select_larger') })
      expect(selectRange).toHaveBeenLastCalledWith({ startLine: 2, startColumn: 1, endLine: 4, endColumn: 1 })
      act(() => { runCommand('editor.select_smaller') })
      expect(selectRange).toHaveBeenLastCalledWith({ startLine: 2, startColumn: 1, endLine: 4, endColumn: 1 })
      act(() => { runCommand('editor.select_smaller') })
      expect(selectRange).toHaveBeenLastCalledWith({ startLine: 2, startColumn: 3, endLine: 2, endColumn: 9 })
      act(() => { runCommand('editor.next_syntax') })
      expect(selectRange).toHaveBeenLastCalledWith({ startLine: 3, startColumn: 3, endLine: 3, endColumn: 10 })
      act(() => { runCommand('editor.previous_syntax') })
      expect(selectRange).toHaveBeenLastCalledWith({ startLine: 2, startColumn: 3, endLine: 2, endColumn: 9 })
    })

    it('không chọn gì khi tệp không có cây cú pháp', () => {
      const selectRange = vi.fn()
      const active = { file: 'a.ts', handle: { ...handle(), selectRange } as EditorHandle, text: () => 'one\ntwo\nthree' }
      render(<EditorTools {...props(active)} />)
      act(() => { runCommand('editor.select_larger') })
      expect(selectRange).not.toHaveBeenCalled()
    })

    it('xoá history khi con trỏ rời khỏi vùng đã chọn', () => {
      const { selectRange, moveCursor } = setup()
      act(() => { runCommand('editor.select_larger') })
      moveCursor(1, 1)
      act(() => { runCommand('editor.select_smaller') })
      expect(selectRange).toHaveBeenCalledTimes(1)
    })
  })

  describe('phân cấp lời gọi', () => {
    const item = (name: string, file: string, line: number): LspCallHierarchyItem => ({
      name, kind: 6, file, range: lspRange(line, 0, line, 10), selectionRange: lspRange(line, 0, line, 10), data: { token: 'keep' }
    })
    const setup = () => {
      installNexgraph()
      const root = item('callee', 'src/b.ts', 2)
      const caller = item('caller', 'src/c.ts', 4)
      const prepare = vi.fn(async () => [root])
      const incoming = vi.fn(async (_p: string, _f: string, _t: string, _l: number, _c: number, _item: LspCallHierarchyItem): Promise<LspCallHierarchyCall[]> => [{ from: caller, fromRanges: [lspRange(4, 2, 4, 8)] }])
      const outgoing = vi.fn(async (): Promise<LspCallHierarchyCall[]> => [])
      const api = window.nexgraph as NexGraphApi
      api.lsp = { callHierarchyPrepare: prepare, callHierarchyIncoming: incoming, callHierarchyOutgoing: outgoing } as unknown as NexGraphApi['lsp']
      api.fs.read = vi.fn(async () => ({ text: 'root text', eol: '\n' as const, bom: false, mtimeMs: 1, version: 'initial', readOnly: false }))
      const active = { file: 'a.ts', handle: handle(), text: () => 'one\ntwo\nthree' }
      const p = props(active)
      render(<EditorTools {...p} />)
      return { ...p, root, caller, prepare, incoming, outgoing }
    }

    it('mở picker, gọi lại API khi đổi hướng, mở dòng đã chọn và đóng khi bấm lại cùng hướng', async () => {
      const { onOpen, root, prepare, incoming, outgoing } = setup()
      act(() => { runCommand('editor.call_hierarchy_incoming') })
      expect(await screen.findByRole('dialog', { name: 'Phân cấp lời gọi' })).toBeTruthy()
      expect(prepare).toHaveBeenCalledWith('p1', 'a.ts', 'one\ntwo\nthree', 2, 3)
      fireEvent.click(screen.getByText('callee'))
      expect(await screen.findByText('caller')).toBeTruthy()
      expect(incoming).toHaveBeenCalledWith('p1', 'src/b.ts', 'root text', 3, 1, root)
      expect(incoming.mock.calls[0][5]).toBe(root)

      act(() => { runCommand('editor.call_hierarchy_outgoing') })
      await waitFor(() => expect(outgoing).toHaveBeenCalledWith('p1', 'src/b.ts', 'root text', 3, 1, root))
      expect(screen.queryByText('caller')).toBeNull()
      act(() => { runCommand('editor.call_hierarchy_outgoing') })
      expect(screen.queryByRole('dialog', { name: 'Phân cấp lời gọi' })).toBeNull()

      act(() => { runCommand('editor.call_hierarchy_incoming') })
      fireEvent.click(await screen.findByText('callee'))
      fireEvent.click(await screen.findByText('caller'))
      expect(onOpen).toHaveBeenCalledWith('src/c.ts', 5, 3)
    })

    it('báo ngắn khi backend không hỗ trợ phân cấp lời gọi', () => {
      installNexgraph()
      const active = { file: 'a.ts', handle: handle(), text: () => 'one\ntwo\nthree' }
      const p = props(active)
      render(<EditorTools {...p} />)
      act(() => { runCommand('editor.call_hierarchy_incoming') })
      expect(p.onError).toHaveBeenCalledWith('Phân cấp lời gọi không dùng được trong tệp này.')
    })
  })
})

describe('EditorTools view commands', () => {
  const setup = (over: Partial<EditorHandle> = {}) => {
    const runAction = vi.fn(async (_id: string) => {})
    const active = { file: 'a.ts', handle: { ...handle(), runAction, ...over } as EditorHandle, text: () => 'one\ntwo\nthree' }
    return { ...props(active), runAction }
  }

  it('persists toggles issued from the command palette', () => {
    render(<EditorTools {...setup()} />)
    act(() => { runCommand('editor.toggle_minimap') })
    act(() => { runCommand('editor.toggle_whitespace') })
    act(() => { runCommand('editor.toggle_line_numbers') })
    expect(getEditorPrefs()).toMatchObject({ minimap: true, renderWhitespace: 'trailing', lineNumbers: false })
    expect(JSON.parse(localStorage.getItem('nexgraph.editor.preferences')!)).toMatchObject({ minimap: true, renderWhitespace: 'trailing', lineNumbers: false })
  })

  it('runs the real Monaco multi-cursor and line actions', () => {
    const p = setup()
    render(<EditorTools {...p} />)
    const ids = ['editor.select_next_occurrence', 'editor.select_all_occurrences', 'editor.add_cursor_above', 'editor.add_cursor_below',
      'editor.move_line_up', 'editor.move_line_down', 'editor.duplicate_line', 'editor.toggle_comment']
    for (const id of ids) act(() => { runCommand(id) })
    expect(p.runAction.mock.calls.map(([id]) => id)).toEqual([
      'editor.action.addSelectionToNextFindMatch', 'editor.action.selectHighlights', 'editor.action.insertCursorAbove',
      'editor.action.insertCursorBelow', 'editor.action.moveLinesUpAction', 'editor.action.moveLinesDownAction',
      'editor.action.copyLinesDownAction', 'editor.action.commentLine'
    ])
  })

  it('copies the selection with common indentation removed and never edits the buffer', async () => {
    const writeText = vi.fn(async (_text: string) => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const setValue = vi.fn()
    const active = { file: 'a.ts', handle: { ...handle(), setValue, runAction: vi.fn(async () => {}),
      getSelection: () => ({ text: '    one\n      two\n\n    three', start: 1, end: 4 }) }, text: () => 'root text' }
    const p = props(active)
    render(<EditorTools {...p} />)
    act(() => { runCommand('editor.copy_and_trim') })
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('one\n  two\n\nthree'))
    expect(setValue).not.toHaveBeenCalled()
    expect(p.onError).not.toHaveBeenCalled()
  })

  it('copies the cursor line when nothing is selected', async () => {
    const writeText = vi.fn(async (_text: string) => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const active = { file: 'a.ts', handle: handle(), text: () => 'one\n      two\nthree' }
    render(<EditorTools {...props(active)} />)
    act(() => { runCommand('editor.copy_and_trim') })
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('two'))
  })

  it('reports clipboard failures from copy and trim', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('Không có clipboard') }) }, configurable: true })
    const p = props({ file: 'a.ts', handle: handle(), text: () => 'one\ntwo\nthree' })
    render(<EditorTools {...p} />)
    act(() => { runCommand('editor.copy_and_trim') })
    await waitFor(() => expect(p.onError).toHaveBeenCalledWith('Không có clipboard'))
  })
})
})
