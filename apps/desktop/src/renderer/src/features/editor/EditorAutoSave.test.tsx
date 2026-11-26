// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installNexgraph } from '../../test-utils'
import { setEditorPrefs } from '../../shared/lib/editorPrefs'

const format = vi.hoisted(() => vi.fn<(text: string) => Promise<string>>())
vi.mock('./monaco', () => ({
  languageFor: () => 'typescript',
  createEditor: (host: HTMLElement, opts: { value: string; readOnly: boolean }) => {
    const textarea = document.createElement('textarea')
    textarea.value = opts.value
    textarea.readOnly = opts.readOnly
    textarea.setAttribute('aria-label', 'editor')
    host.appendChild(textarea)
    return {
      getValue: () => textarea.value,
      setValue: (value: string) => { textarea.value = value },
      setReadOnly: (value: boolean) => { textarea.readOnly = value },
      onChange: (callback: () => void) => textarea.addEventListener('input', callback),
      revealLines: () => {},
      formatDocument: async () => {
        textarea.value = await format(textarea.value)
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
      },
      dispose: () => textarea.remove()
    }
  }
}))

import { EditorTab } from './EditorTab'
import { CollabTab } from '../collab/CollabUi'

beforeEach(() => {
  format.mockReset()
  format.mockImplementation(async (text) => text)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  setEditorPrefs({ autoSave: 'off', autoSaveDelay: 1000, formatOnSave: false })
})

// ES2023 của dự án chưa có kiểu Promise.withResolvers.
function deferred<T>() {
  const result = {} as { promise: Promise<T>; resolve: (value: T) => void }
  result.promise = new Promise<T>((resolve) => { result.resolve = resolve })
  return result
}
async function setup(readOnly = false) {
  const write = vi.fn(async () => ({ mtimeMs: 2, version: 'saved' }))
  installNexgraph({ fs: { read: vi.fn(async () => ({ text: 'original', eol: '\n' as const, bom: false, mtimeMs: 1, version: 'initial', readOnly })), write } })
  const dirty = vi.fn()
  render(<EditorTab projectId="p1" file="main.ts" line={1} onClose={() => {}} onDirtyChange={dirty} />)
  const editor = await screen.findByLabelText('editor') as HTMLTextAreaElement
  return { editor, dirty, write }
}

describe('editor saving preferences', () => {
  it('saves after the last edit and clears dirty state', async () => {
    setEditorPrefs({ autoSave: 'afterDelay', autoSaveDelay: 1000 })
    const { editor, dirty, write } = await setup()
    vi.useFakeTimers()
    fireEvent.input(editor, { target: { value: 'modified' } })
    expect(dirty).toHaveBeenLastCalledWith('main.ts', true)
    await act(async () => { vi.advanceTimersByTime(999) })
    expect(write).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(write).toHaveBeenCalledWith('p1', 'main.ts', 'modified', { eol: '\n', bom: false, expectedVersion: 'initial' })
    expect(dirty).toHaveBeenLastCalledWith('main.ts', false)
  })

  it('runs formatting before a delayed auto save', async () => {
    setEditorPrefs({ autoSave: 'afterDelay', autoSaveDelay: 1000, formatOnSave: true })
    format.mockResolvedValue('formatted automatically')
    const { editor, dirty, write } = await setup()
    vi.useFakeTimers()
    fireEvent.input(editor, { target: { value: 'modified' } })
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(write).toHaveBeenCalledWith('p1', 'main.ts', 'formatted automatically', expect.any(Object))
    expect(dirty).toHaveBeenLastCalledWith('main.ts', false)
  })

  it('formats before explicit save and saves anyway if formatting fails', async () => {
    setEditorPrefs({ formatOnSave: true })
    format.mockResolvedValueOnce('formatted').mockRejectedValueOnce(new Error('no formatter'))
    const { editor, write } = await setup()
    fireEvent.input(editor, { target: { value: 'first' } })
    fireEvent.keyDown(document, { key: 's', ctrlKey: true })
    await waitFor(() => expect(write).toHaveBeenCalledWith('p1', 'main.ts', 'formatted', expect.any(Object)))
    fireEvent.input(editor, { target: { value: 'second' } })
    fireEvent.keyDown(document, { key: 's', ctrlKey: true })
    await waitFor(() => expect(write).toHaveBeenCalledWith('p1', 'main.ts', 'second', expect.any(Object)))
  })

  it('does not write an outdated pending save while formatting a newer request', async () => {
    setEditorPrefs({ formatOnSave: false })
    const initial = { text: 'original', eol: '\n' as const, bom: false, mtimeMs: 1, version: 'initial', readOnly: false }
    const pendingWrite = deferred<{ mtimeMs: number; version: string }>()
    const write = vi.fn().mockImplementationOnce(() => pendingWrite.promise)
      .mockResolvedValue({ mtimeMs: 3, version: 'saved-2' })
    installNexgraph({ fs: { read: vi.fn(async () => initial), write } })
    render(<EditorTab projectId="p1" file="main.ts" line={1} onClose={() => {}} onDirtyChange={() => {}} />)
    const editor = await screen.findByLabelText('editor')
    fireEvent.input(editor, { target: { value: 'first' } })
    fireEvent.keyDown(document, { key: 's', ctrlKey: true })
    fireEvent.input(editor, { target: { value: 'second' } })
    fireEvent.keyDown(document, { key: 's', ctrlKey: true })
    const pendingFormat = deferred<string>()
    format.mockImplementationOnce(() => pendingFormat.promise)
    act(() => setEditorPrefs({ formatOnSave: true }))
    fireEvent.input(editor, { target: { value: 'third' } })
    fireEvent.keyDown(document, { key: 's', ctrlKey: true })
    await act(async () => {})
    await act(async () => pendingWrite.resolve({ mtimeMs: 2, version: 'saved-1' }))
    expect(write).toHaveBeenCalledTimes(1)
    await act(async () => pendingFormat.resolve('formatted third'))
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2))
    expect(write).toHaveBeenLastCalledWith('p1', 'main.ts', 'formatted third', expect.objectContaining({ expectedVersion: 'saved-1' }))
  })

  it('saves when focus leaves the editor in focus-change mode', async () => {
    setEditorPrefs({ autoSave: 'onFocusChange' })
    const { editor, write } = await setup()
    fireEvent.input(editor, { target: { value: 'edited' } })
    fireEvent.focusOut(editor, { relatedTarget: document.body })
    await waitFor(() => expect(write).toHaveBeenCalledWith('p1', 'main.ts', 'edited', expect.any(Object)))
  })

  it('saves when the active tab becomes hidden without a DOM focus event', async () => {
    setEditorPrefs({ autoSave: 'onFocusChange' })
    const write = vi.fn(async () => ({ mtimeMs: 2, version: 'saved' }))
    installNexgraph({ fs: { read: vi.fn(async () => ({ text: 'original', eol: '\n' as const, bom: false, mtimeMs: 1, version: 'initial', readOnly: false })), write } })
    const props = { projectId: 'p1', file: 'main.ts', line: 1, onClose: () => {}, onDirtyChange: () => {} }
    const view = render(<EditorTab {...props} active />)
    const editor = await screen.findByLabelText('editor')
    fireEvent.input(editor, { target: { value: 'edited' } })
    view.rerender(<EditorTab {...props} active={false} />)
    await waitFor(() => expect(write).toHaveBeenCalledWith('p1', 'main.ts', 'edited', expect.any(Object)))
  })

  it('does not save read-only files or the collaboration guest buffer', async () => {
    setEditorPrefs({ autoSave: 'afterDelay', autoSaveDelay: 10 })
    const { editor, write } = await setup(true)
    vi.useFakeTimers()
    fireEvent.input(editor, { target: { value: 'changed' } })
    await act(async () => { vi.advanceTimersByTime(10) })
    expect(write).not.toHaveBeenCalled()
    cleanup()
    render(<CollabTab file="remote.ts" />)
    fireEvent.input(screen.getByLabelText('editor'), { target: { value: 'guest edit' } })
    await act(async () => { vi.advanceTimersByTime(10) })
    expect(write).not.toHaveBeenCalled()
  })
})
