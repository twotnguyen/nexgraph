import * as monaco from 'monaco-editor/editor/editor.api.js'
import { editorFontSize, getEditorPrefs, observeEditorPrefs, zoomEditorFont } from '../../state/editorPrefs'

type EditorOptions = monaco.editor.IEditorOptions & { tabSize?: number; 'semanticHighlighting.enabled'?: boolean }

export function monacoOptions(): EditorOptions {
  const prefs = getEditorPrefs()
  return {
    fontSize: editorFontSize(), tabSize: prefs.tabSize, wordWrap: prefs.wordWrap,
    lineNumbers: prefs.lineNumbers ? 'on' : 'off',
    minimap: { enabled: prefs.minimap },
    renderWhitespace: prefs.renderWhitespace,
    stickyScroll: { enabled: prefs.stickyScroll },
    inlayHints: { enabled: prefs.inlayHints ? 'on' : 'off' },
    'semanticHighlighting.enabled': prefs.semanticHighlighting,
    codeLens: prefs.codeLens,
    bracketPairColorization: { enabled: prefs.colorizeBrackets }
  }
}

let previous = monacoOptions()
const stop = observeEditorPrefs(() => {
  const next = monacoOptions()
  if (JSON.stringify(next) === JSON.stringify(previous)) return
  const editors = monaco.editor.getEditors()
  const tabChanged = next.tabSize !== previous.tabSize
  // Cập nhật config toàn cục trước; tạo editor khác không nhận diện lại thụt lề của mọi model đang mở.
  if (tabChanged) editors[0]?.updateOptions({ tabSize: next.tabSize } as unknown as monaco.editor.IEditorOptions)
  for (const editor of editors) {
    editor.updateOptions(next)
    if (tabChanged) editor.getModel()?.updateOptions({ tabSize: next.tabSize, indentSize: next.tabSize })
  }
  previous = next
})
import.meta.hot?.dispose(stop)

export function installFontKeys(editor: monaco.editor.IStandaloneCodeEditor): void {
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Equal, () => zoomEditorFont(1))
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Equal, () => zoomEditorFont(1))
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Minus, () => zoomEditorFont(-1))
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Digit0, () => zoomEditorFont('reset'))
}
