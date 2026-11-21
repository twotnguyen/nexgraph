// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { editorFontSize, setEditorPrefs, zoomEditorFont } from '../../state/editorPrefs'

type FakeEditor = { updateOptions: (options: object) => void; getModel: () => { updateOptions: (options: object) => void } }
const fake = vi.hoisted(() => ({ editors: [] as FakeEditor[] }))
vi.mock('monaco-editor/editor/editor.api.js', () => ({
  editor: { getEditors: () => fake.editors },
  KeyMod: { CtrlCmd: 1024, Shift: 512 },
  KeyCode: { Equal: 1, Minus: 2, Digit0: 3 }
}))
import { installFontKeys, monacoOptions } from './monacoPrefs'

afterEach(() => {
  fake.editors.length = 0
  zoomEditorFont('reset')
  setEditorPrefs({ fontSize: 13, tabSize: 4, wordWrap: 'off', iconTheme: 'symbols' })
})

it('updates every open editor and model when the settings change', () => {
  const firstModel = { updateOptions: vi.fn() }
  const secondModel = { updateOptions: vi.fn() }
  const first = { updateOptions: vi.fn(), getModel: () => firstModel }
  const second = { updateOptions: vi.fn(), getModel: () => secondModel }
  fake.editors.push(first, second)
  setEditorPrefs({ fontSize: 18, tabSize: 2, wordWrap: 'on' })
  expect(first.updateOptions).toHaveBeenCalledWith({ tabSize: 2 })
  expect(first.updateOptions).toHaveBeenCalledWith({ fontSize: 18, wordWrap: 'on' })
  expect(second.updateOptions).toHaveBeenCalledWith({ fontSize: 18, wordWrap: 'on' })
  expect(firstModel.updateOptions).toHaveBeenCalledWith({ tabSize: 2, indentSize: 2 })
  expect(secondModel.updateOptions).toHaveBeenCalledWith({ tabSize: 2, indentSize: 2 })
  expect(monacoOptions()).toEqual({ fontSize: 18, tabSize: 2, wordWrap: 'on' })
  first.updateOptions.mockClear()
  setEditorPrefs({ iconTheme: 'mono' })
  expect(first.updateOptions).not.toHaveBeenCalled()
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
