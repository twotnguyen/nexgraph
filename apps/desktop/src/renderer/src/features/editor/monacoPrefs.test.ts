// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { editorFontSize, setEditorPrefs, zoomEditorFont } from '../../shared/lib/editorPrefs'

type FakeEditor = { updateOptions: (options: object) => void; getModel: () => { updateOptions: (options: object) => void } }
const fake = vi.hoisted(() => ({ editors: [] as FakeEditor[] }))
vi.mock('monaco-editor/editor/editor.api.js', () => ({
  editor: { getEditors: () => fake.editors },
  KeyMod: { CtrlCmd: 1024, Shift: 512 },
  KeyCode: { Equal: 1, Minus: 2, Digit0: 3 }
}))
import { installFontKeys, monacoOptions } from './monacoPrefs'
const BASE_OPTIONS = { parameterHints: { enabled: false }, renderValidationDecorations: 'on',
  hover: { enabled: 'on' }, cursorBlinking: 'blink', cursorStyle: 'line',
  renderLineHighlight: 'all', selectionHighlight: true }

afterEach(() => {
  fake.editors.length = 0
  zoomEditorFont('reset')
  setEditorPrefs({ fontSize: 13, tabSize: 4, wordWrap: 'off', iconTheme: 'symbols',
    lineNumbers: true, minimap: false, renderWhitespace: 'selection', stickyScroll: false, breadcrumbs: true,
    inlayHints: false, semanticHighlighting: false, codeLens: false, colorizeBrackets: false,
    autoSignatureHelp: false, inlineDiagnostics: true, hoverEnabled: true, cursorBlink: true,
    cursorShape: 'bar', currentLineHighlight: 'all', selectionHighlight: true })
})

it('updates every open editor and model when the settings change', () => {
  const firstModel = { updateOptions: vi.fn() }
  const secondModel = { updateOptions: vi.fn() }
  const first = { updateOptions: vi.fn(), getModel: () => firstModel }
  const second = { updateOptions: vi.fn(), getModel: () => secondModel }
  fake.editors.push(first, second)
  setEditorPrefs({ fontSize: 18, tabSize: 2, wordWrap: 'on' })
  const expected = { fontSize: 18, tabSize: 2, wordWrap: 'on', lineNumbers: 'on', minimap: { enabled: false },
    renderWhitespace: 'selection', stickyScroll: { enabled: false }, inlayHints: { enabled: 'off' },
    'semanticHighlighting.enabled': false, codeLens: false,
    bracketPairColorization: { enabled: false }, ...BASE_OPTIONS }
  expect(first.updateOptions).toHaveBeenCalledWith({ tabSize: 2 })
  expect(first.updateOptions).toHaveBeenCalledWith(expected)
  expect(second.updateOptions).toHaveBeenCalledWith(expected)
  expect(firstModel.updateOptions).toHaveBeenCalledWith({ tabSize: 2, indentSize: 2 })
  expect(secondModel.updateOptions).toHaveBeenCalledWith({ tabSize: 2, indentSize: 2 })
  expect(monacoOptions()).toEqual(expected)
  first.updateOptions.mockClear()
  setEditorPrefs({ iconTheme: 'mono' })
  expect(first.updateOptions).not.toHaveBeenCalled()
})

it('applies every view toggle to all open editors', () => {
  const first = { updateOptions: vi.fn(), getModel: () => ({ updateOptions: vi.fn() }) }
  const second = { updateOptions: vi.fn(), getModel: () => ({ updateOptions: vi.fn() }) }
  fake.editors.push(first, second)
  setEditorPrefs({ lineNumbers: false, minimap: true, renderWhitespace: 'all', stickyScroll: true,
    inlayHints: true, semanticHighlighting: true, codeLens: true, colorizeBrackets: true })
  const expected = { fontSize: 13, tabSize: 4, wordWrap: 'off', lineNumbers: 'off', minimap: { enabled: true },
    renderWhitespace: 'all', stickyScroll: { enabled: true }, inlayHints: { enabled: 'on' },
    'semanticHighlighting.enabled': true, codeLens: true,
    bracketPairColorization: { enabled: true }, ...BASE_OPTIONS }
  expect(first.updateOptions).toHaveBeenLastCalledWith(expected)
  expect(second.updateOptions).toHaveBeenLastCalledWith(expected)
  expect(monacoOptions()).toEqual(expected)
})

it('registers editor zoom keys that reset to the configured size', () => {
  const keys = new Map<number, () => void>()
  const editor = { addCommand: (key: number, handler: () => void) => { keys.set(key, handler); return '' } }
  installFontKeys(editor as never)
  keys.get(1025)?.()
  expect(editorFontSize()).toBe(14)
  keys.get(1026)?.()
  keys.get(1026)?.()
  expect(editorFontSize()).toBe(12)
  keys.get(1027)?.()
  expect(editorFontSize()).toBe(13)
})

it('maps cursor, hover, signature and diagnostics settings to real Monaco options', () => {
  const editor = { updateOptions: vi.fn(), getModel: () => ({ updateOptions: vi.fn() }) }
  fake.editors.push(editor)
  setEditorPrefs({ autoSignatureHelp: true, inlineDiagnostics: false, hoverEnabled: false, cursorBlink: false,
    cursorShape: 'underline', currentLineHighlight: 'none', selectionHighlight: false })
  expect(monacoOptions()).toMatchObject({
    parameterHints: { enabled: true }, renderValidationDecorations: 'off', hover: { enabled: 'off' },
    cursorBlinking: 'solid', cursorStyle: 'underline', renderLineHighlight: 'none', selectionHighlight: false
  })
  expect(editor.updateOptions).toHaveBeenLastCalledWith(monacoOptions())
  setEditorPrefs({ cursorShape: 'block' })
  expect(monacoOptions().cursorStyle).toBe('block')
})
