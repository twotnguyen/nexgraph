import * as monaco from 'monaco-editor/editor/editor.api.js'
import { editorFontSize, getEditorPrefs, observeEditorPrefs, zoomEditorFont } from '../../state/editorPrefs'

export function monacoOptions() {
  const { tabSize, wordWrap } = getEditorPrefs()
  return { fontSize: editorFontSize(), tabSize, wordWrap }
}

let previous = monacoOptions()
const stop = observeEditorPrefs(() => {
  const next = monacoOptions()
  if (next.fontSize === previous.fontSize && next.wordWrap === previous.wordWrap && next.tabSize === previous.tabSize) return
  const editors = monaco.editor.getEditors()
  const tabChanged = next.tabSize !== previous.tabSize
  // Cập nhật config toàn cục trước; tạo editor khác không nhận diện lại thụt lề của mọi model đang mở.
  if (tabChanged) editors[0]?.updateOptions({ tabSize: next.tabSize } as unknown as monaco.editor.IEditorOptions)
  for (const editor of editors) {
    editor.updateOptions({ fontSize: next.fontSize, wordWrap: next.wordWrap })
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
