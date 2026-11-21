// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as Monaco from 'monaco-editor/editor/editor.api.js'
import { attachConflictWidgets } from './conflict-widgets'

vi.mock('monaco-editor/editor/editor.api.js', () => {
  class Range {
    constructor(public startLineNumber: number, public startColumn: number, public endLineNumber: number, public endColumn: number) {}
    static fromPositions(start: { lineNumber: number; column: number }, end: { lineNumber: number; column: number }) {
      return new Range(start.lineNumber, start.column, end.lineNumber, end.column)
    }
  }
  return { Range, editor: { EditorOption: { readOnly: 1 }, ContentWidgetPositionPreference: { ABOVE: 1 } } }
})

type Listener = () => void
const subscribe = (listeners: Set<Listener>) => (listener: Listener) => {
  listeners.add(listener)
  return { dispose: () => { listeners.delete(listener) } }
}

function editorFixture(initial: string, initiallyReadOnly = false) {
  let text = initial
  let version = 1
  let readOnly = initiallyReadOnly
  let nextZone = 0
  const changes = new Set<Listener>()
  const modelChanges = new Set<Listener>()
  const disposal = new Set<Listener>()
  const config = new Set<(event: { hasChanged: () => boolean }) => void>()
  const zones = new Map<string, Monaco.editor.IViewZone>()
  const host = document.createElement('div')
  const stats = { edits: 0, stops: 0 }
  document.body.appendChild(host)
  const model = {
    getValue: () => text,
    getVersionId: () => version,
    getLineMaxColumn: (line: number) => (text.split('\n')[line - 1] ?? '').length + 1,
    getPositionAt: (offset: number) => {
      const before = text.slice(0, offset)
      return { lineNumber: before.split('\n').length, column: before.length - before.lastIndexOf('\n') }
    }
  }
  const setText = (value: string) => {
    text = value
    version++
    changes.forEach((listener) => listener())
  }
  const offsetAt = (line: number, column: number) => {
    const lines = text.split('\n')
    return lines.slice(0, line - 1).reduce((offset, item) => offset + item.length + 1, 0) + column - 1
  }
  const editor = {
    getModel: () => model,
    getOption: () => readOnly,
    createDecorationsCollection: () => ({ set: () => {}, clear: () => {} }),
    changeViewZones: (callback: (accessor: Pick<Monaco.editor.IViewZoneChangeAccessor, 'addZone' | 'removeZone'>) => void) => callback({
      addZone: (zone) => { const id = String(++nextZone); zones.set(id, zone); return id },
      removeZone: (id) => { zones.delete(id) }
    }),
    addContentWidget: (widget: Monaco.editor.IContentWidget) => { host.appendChild(widget.getDomNode()) },
    removeContentWidget: (widget: Monaco.editor.IContentWidget) => { widget.getDomNode().remove() },
    onDidChangeModelContent: subscribe(changes),
    onDidChangeModel: subscribe(modelChanges),
    onDidDispose: subscribe(disposal),
    onDidChangeConfiguration: (listener: (event: { hasChanged: () => boolean }) => void) => {
      config.add(listener)
      return { dispose: () => { config.delete(listener) } }
    },
    pushUndoStop: () => { stats.stops++; return true },
    executeEdits: (_source: string, edits: { range: Monaco.IRange; text: string }[]) => {
      stats.edits++
      const { range, text: replacement } = edits[0]
      const start = offsetAt(range.startLineNumber, range.startColumn)
      const end = offsetAt(range.endLineNumber, range.endColumn)
      setText(text.slice(0, start) + replacement + text.slice(end))
      return true
    },
    focus: () => {}
  }
  return {
    editor: editor as unknown as Monaco.editor.IStandaloneCodeEditor, host, zones, stats, setText,
    getText: () => text,
    setReadOnly: (value: boolean) => { readOnly = value; config.forEach((listener) => listener({ hasChanged: () => true })) }
  }
}

const conflict = '<<<<<<< HEAD\nmình\n=======\nhọ\n>>>>>>> branch\n'
const button = (host: HTMLElement, label: string) => Array.from(host.querySelectorAll('button')).find((item) => item.textContent === label)!

afterEach(() => { document.body.replaceChildren() })

describe('conflict editor widgets', () => {
  it('exposes labeled buttons above each block and applies one isolated edit', () => {
    const f = editorFixture(conflict + 'giữa\n' + conflict)
    const dispose = attachConflictWidgets(f.editor)
    expect(f.host.querySelectorAll('[role="group"]')).toHaveLength(2)
    expect(f.host.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Giải quyết xung đột ở dòng 1')
    expect(Array.from(f.zones.values(), (zone) => zone.afterLineNumber)).toEqual([0, 6])
    const second = f.host.querySelectorAll('[role="group"]')[1] as HTMLElement
    button(second, 'Dùng bản kia').click()
    expect(f.getText()).toBe(conflict + 'giữa\nhọ\n')
    expect(f.stats).toEqual({ edits: 1, stops: 2 })
    expect(f.host.querySelectorAll('[role="group"]')).toHaveLength(1)
    dispose()
  })

  it('recomputes shifted blocks and refuses a stale button', () => {
    const f = editorFixture(conflict)
    const dispose = attachConflictWidgets(f.editor)
    const stale = button(f.host, 'Dùng bản của mình')
    f.setText('đầu\n' + conflict)
    stale.click()
    expect(f.getText()).toBe('đầu\n' + conflict)
    button(f.host, 'Dùng cả hai').click()
    expect(f.getText()).toBe('đầu\nmình\nhọ\n')
    dispose()
  })

  it('disables actions in read-only mode, including programmatically dispatched clicks', () => {
    const f = editorFixture(conflict, true)
    const dispose = attachConflictWidgets(f.editor)
    const ours = button(f.host, 'Dùng bản của mình')
    expect(ours.disabled).toBe(true)
    ours.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(f.getText()).toBe(conflict)
    f.setReadOnly(false)
    expect(ours.disabled).toBe(false)
    f.setReadOnly(true)
    expect(ours.disabled).toBe(true)
    dispose()
  })

  it('replaces an earlier attachment and removes all widgets and handlers on disposal', () => {
    const f = editorFixture(conflict)
    const firstDispose = attachConflictWidgets(f.editor)
    const dispose = attachConflictWidgets(f.editor)
    firstDispose()
    expect(f.host.querySelectorAll('button')).toHaveLength(3)
    expect(f.zones.size).toBe(1)
    f.setText('đầu\n' + conflict)
    expect(f.host.querySelectorAll('button')).toHaveLength(3)
    dispose()
    expect(f.host.querySelectorAll('button')).toHaveLength(0)
    expect(f.zones.size).toBe(0)
    f.setText(conflict)
    expect(f.host.querySelectorAll('button')).toHaveLength(0)
  })
})
