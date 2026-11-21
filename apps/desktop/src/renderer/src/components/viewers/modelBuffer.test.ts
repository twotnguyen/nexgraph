import { afterEach, describe, expect, it, vi } from 'vitest'
import { observeBuffer } from './modelBuffer'

const state = vi.hoisted(() => ({
  text: '- [ ] task',
  content: null as (() => void) | null,
  disposed: null as (() => void) | null,
  created: null as ((model: unknown) => void) | null,
  model: null as unknown
}))
vi.mock('monaco-editor/editor/editor.api.js', () => ({
  Uri: { from: () => ({ toString: () => 'model-uri' }) },
  Range: class { constructor(public startLineNumber: number, public startColumn: number, public endLineNumber: number, public endColumn: number) {} },
  editor: {
    EndOfLinePreference: { LF: 1 },
    getModel: () => state.model,
    onDidCreateModel: (callback: (model: unknown) => void) => { state.created = callback; return { dispose: () => { state.created = null } } }
  }
}))

function fakeModel() {
  return {
    uri: { toString: () => 'model-uri' },
    getValue: () => state.text,
    onDidChangeContent: (callback: () => void) => { state.content = callback; return { dispose: () => { state.content = null } } },
    onWillDispose: (callback: () => void) => { state.disposed = callback; return { dispose: () => { state.disposed = null } } },
    pushStackElement: vi.fn(),
    pushEditOperations: vi.fn((_selection: unknown, edits: { range: { startColumn: number; endColumn: number }; text: string }[]) => {
      const edit = edits[0]
      state.text = state.text.slice(0, edit.range.startColumn - 1) + edit.text + state.text.slice(edit.range.endColumn - 1)
      state.content?.()
    })
  }
}

afterEach(() => { state.model = null; state.created = null; state.content = null; state.disposed = null; state.text = '- [ ] task' })

describe('preview buffer', () => {
  it('attaches to a model created later and edits one undoable marker only if the source is current', async () => {
    const changed = vi.fn()
    const buffer = observeBuffer('p1', 'README.md', changed)
    await vi.waitFor(() => expect(state.created).not.toBeNull())
    const model = fakeModel()
    state.created?.(model)
    expect(changed).toHaveBeenLastCalledWith('- [ ] task')
    buffer.edit('stale source', { line: 1, startColumn: 3, endColumn: 6, text: '[x]' })
    expect(model.pushEditOperations).not.toHaveBeenCalled()
    buffer.edit(state.text, { line: 1, startColumn: 3, endColumn: 6, text: '[x]' })
    expect(state.text).toBe('- [x] task')
    expect(changed).toHaveBeenLastCalledWith('- [x] task')
    expect(model.pushStackElement).toHaveBeenCalledTimes(2)
    state.disposed?.()
    expect(changed).toHaveBeenLastCalledWith(null)
    buffer.dispose()
    expect(state.created).toBeNull()
  })
})
