// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { editorFontSize, getEditorPrefs, parseEditorPrefs, setEditorPrefs, zoomEditorFont } from './editorPrefs'

afterEach(() => {
  zoomEditorFont('reset')
  setEditorPrefs({ fontSize: 13, terminalFontSize: 12, tabSize: 4, wordWrap: 'off', formatOnSave: false, autoSave: 'off', autoSaveDelay: 1000, iconTheme: 'symbols' })
  localStorage.removeItem('nexgraph.editor.preferences')
})

describe('editor preferences', () => {
  it('uses defaults for missing or malformed settings', () => {
    const defaults = { fontSize: 13, terminalFontSize: 12, tabSize: 4, wordWrap: 'off', formatOnSave: false, autoSave: 'off', autoSaveDelay: 1000, iconTheme: 'symbols' }
    expect(parseEditorPrefs(null)).toEqual(defaults)
    expect(parseEditorPrefs('{broken')).toEqual(defaults)
    expect(parseEditorPrefs('null')).toEqual(defaults)
    expect(parseEditorPrefs('{"fontSize":"20","tabSize":3,"wordWrap":"bad","formatOnSave":"true","autoSave":"bad","autoSaveDelay":null,"iconTheme":"other"}')).toEqual(defaults)
  })

  it('clamps numeric values and retains valid choices', () => {
    expect(parseEditorPrefs('{"fontSize":40,"tabSize":2,"wordWrap":"on","formatOnSave":true,"autoSave":"afterDelay","autoSaveDelay":0,"iconTheme":"mono"}')).toEqual({
      fontSize: 32, terminalFontSize: 12, tabSize: 2, wordWrap: 'on', formatOnSave: true, autoSave: 'afterDelay', autoSaveDelay: 1, iconTheme: 'mono'
    })
    expect(parseEditorPrefs('{"fontSize":4,"terminalFontSize":35,"autoSaveDelay":999999999999}')).toMatchObject({ fontSize: 8, terminalFontSize: 32, autoSaveDelay: 2147483647 })
  })

  it('persists sanitized settings and keeps the snapshot stable between changes', () => {
    setEditorPrefs({ fontSize: 99, tabSize: 8, autoSave: 'onFocusChange' })
    expect(getEditorPrefs()).toMatchObject({ fontSize: 32, tabSize: 8, autoSave: 'onFocusChange' })
    expect(JSON.parse(localStorage.getItem('nexgraph.editor.preferences')!)).toEqual(getEditorPrefs())
    expect(getEditorPrefs()).toBe(getEditorPrefs())
  })

  it('zooms within bounds without persisting temporary changes and resets to the configured size', () => {
    setEditorPrefs({ fontSize: 20 })
    const saved = localStorage.getItem('nexgraph.editor.preferences')
    zoomEditorFont(1)
    expect(editorFontSize()).toBe(21)
    expect(localStorage.getItem('nexgraph.editor.preferences')).toBe(saved)
    zoomEditorFont(100)
    expect(editorFontSize()).toBe(32)
    zoomEditorFont(-100)
    expect(editorFontSize()).toBe(8)
    zoomEditorFont('reset')
    expect(editorFontSize()).toBe(20)
    zoomEditorFont(1)
    setEditorPrefs({ fontSize: 8 })
    expect(editorFontSize()).toBe(8)
  })
})
