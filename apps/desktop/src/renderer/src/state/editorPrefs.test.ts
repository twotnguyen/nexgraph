// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { editorFontSize, getEditorPrefs, parseEditorPrefs, setEditorPrefs, zoomEditorFont } from './editorPrefs'

afterEach(() => {
  setEditorPrefs({ fontSize: 13, terminalFontSize: 12, tabSize: 4, wordWrap: 'off', formatOnSave: false, autoSave: 'off', autoSaveDelay: 1000, iconTheme: 'symbols', blameDelay: 0, blameSummary: true,
    lineNumbers: true, minimap: false, renderWhitespace: 'selection', stickyScroll: false, breadcrumbs: true,
    inlayHints: false, semanticHighlighting: false, codeLens: false, colorizeBrackets: false })
  localStorage.removeItem('nexgraph.editor.preferences')
})

describe('editor preferences', () => {
  it('uses defaults for missing or malformed settings', () => {
    const defaults = { fontSize: 13, terminalFontSize: 12, tabSize: 4, wordWrap: 'off', formatOnSave: false, autoSave: 'off', autoSaveDelay: 1000, iconTheme: 'symbols', blameDelay: 0, blameSummary: true,
      lineNumbers: true, minimap: false, renderWhitespace: 'selection', stickyScroll: false, breadcrumbs: true,
      inlayHints: false, semanticHighlighting: false, codeLens: false, colorizeBrackets: false }
    expect(parseEditorPrefs(null)).toEqual(defaults)
    expect(parseEditorPrefs('{broken')).toEqual(defaults)
    expect(parseEditorPrefs('null')).toEqual(defaults)
    expect(parseEditorPrefs('{"fontSize":"20","tabSize":3,"wordWrap":"bad","formatOnSave":"true","autoSave":"bad","autoSaveDelay":null,"iconTheme":"other","blameDelay":"5","blameSummary":"no"}')).toEqual(defaults)
  })

  it('clamps numeric values and retains valid choices', () => {
    expect(parseEditorPrefs('{"fontSize":40,"tabSize":2,"wordWrap":"on","formatOnSave":true,"autoSave":"afterDelay","autoSaveDelay":0,"iconTheme":"mono","blameDelay":300,"blameSummary":false}')).toEqual({
      fontSize: 32, terminalFontSize: 12, tabSize: 2, wordWrap: 'on', formatOnSave: true, autoSave: 'afterDelay', autoSaveDelay: 1, iconTheme: 'mono', blameDelay: 300, blameSummary: false,
      lineNumbers: true, minimap: false, renderWhitespace: 'selection', stickyScroll: false, breadcrumbs: true,
      inlayHints: false, semanticHighlighting: false, codeLens: false, colorizeBrackets: false
    })
    expect(parseEditorPrefs('{"fontSize":4,"terminalFontSize":35,"autoSaveDelay":999999999999,"blameDelay":99999}')).toMatchObject({ fontSize: 8, terminalFontSize: 32, autoSaveDelay: 2147483647, blameDelay: 5000 })
    expect(parseEditorPrefs('{"blameDelay":-5}').blameDelay).toBe(0)
  })
  it('validates and persists the editor view preferences', () => {
    const toggled = { lineNumbers: false, minimap: true, renderWhitespace: 'all' as const, stickyScroll: true, breadcrumbs: false,
      inlayHints: true, semanticHighlighting: true, codeLens: true, colorizeBrackets: true }
    expect(parseEditorPrefs(JSON.stringify({ ...toggled, renderWhitespace: 'bad' }))).toMatchObject({
      lineNumbers: false, minimap: true, renderWhitespace: 'selection', stickyScroll: true, breadcrumbs: false,
      inlayHints: true, semanticHighlighting: true, codeLens: true, colorizeBrackets: true
    })
    setEditorPrefs(toggled)
    expect(getEditorPrefs()).toMatchObject(toggled)
    expect(JSON.parse(localStorage.getItem('nexgraph.editor.preferences')!)).toMatchObject(toggled)
  })
  it('keeps saved legacy fields when view fields are missing', () => {
    expect(parseEditorPrefs('{"fontSize":18,"terminalFontSize":14,"tabSize":2,"wordWrap":"on","formatOnSave":true,"autoSave":"afterDelay","autoSaveDelay":250,"iconTheme":"mono","blameDelay":120,"blameSummary":false}')).toEqual({
      fontSize: 18, terminalFontSize: 14, tabSize: 2, wordWrap: 'on', formatOnSave: true,
      autoSave: 'afterDelay', autoSaveDelay: 250, iconTheme: 'mono', blameDelay: 120, blameSummary: false,
      lineNumbers: true, minimap: false, renderWhitespace: 'selection', stickyScroll: false, breadcrumbs: true,
      inlayHints: false, semanticHighlighting: false, codeLens: false, colorizeBrackets: false
    })
  })
  it('falls back to defaults for invalid view values', () => {
    const parsed = parseEditorPrefs(JSON.stringify({ lineNumbers: 'yes', minimap: 1, renderWhitespace: 'bad', stickyScroll: null,
      breadcrumbs: 'on', inlayHints: 'true', semanticHighlighting: 'on', codeLens: [], colorizeBrackets: {}, unknown: 42 }))
    expect(parsed).toMatchObject({
      lineNumbers: true, minimap: false, renderWhitespace: 'selection', stickyScroll: false, breadcrumbs: true,
      inlayHints: false, semanticHighlighting: false, codeLens: false, colorizeBrackets: false
    })
    expect(parsed).not.toHaveProperty('unknown')
  })
  it('persists toggles and notifies subscribers', () => {
    const changed = vi.fn()
    window.addEventListener('nexgraph:editor-prefs', changed)
    try {
      const before = getEditorPrefs().lineNumbers
      setEditorPrefs({ lineNumbers: !before })
      expect(getEditorPrefs().lineNumbers).toBe(!before)
      expect(JSON.parse(localStorage.getItem('nexgraph.editor.preferences')!)).toMatchObject({ lineNumbers: !before })
      expect(changed).toHaveBeenCalledTimes(1)
      expect(changed.mock.calls[0][0]).toBeInstanceOf(Event)
    } finally { window.removeEventListener('nexgraph:editor-prefs', changed) }
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
