import type * as Monaco from 'monaco-editor/editor/editor.api.js'
import type { TaskEdit } from './markdown'

export interface PreviewBuffer {
  edit(expected: string, edit: TaskEdit): void
  dispose(): void
}

/** Cùng URI với model của EditorTab; preview theo dõi cả lúc model chưa nạp xong. */
export function observeBuffer(projectId: string, file: string, changed: (text: string | null) => void): PreviewBuffer {
  let api: typeof Monaco | null = null
  let model: Monaco.editor.ITextModel | null = null
  let created: Monaco.IDisposable | undefined
  let content: Monaco.IDisposable | undefined
  let closing: Monaco.IDisposable | undefined
  let disposed = false
  void import('monaco-editor/editor/editor.api.js').then((monaco) => {
    if (disposed) return
    api = monaco
    const uri = monaco.Uri.from({ scheme: 'nexgraph', authority: encodeURIComponent(projectId), path: `/${file}` })
    const attach = (next: Monaco.editor.ITextModel) => {
      if (next.uri.toString() !== uri.toString()) return
      content?.dispose()
      closing?.dispose()
      model = next
      const publish = () => changed(next.getValue(monaco.editor.EndOfLinePreference.LF))
      content = next.onDidChangeContent(publish)
      closing = next.onWillDispose(() => { model = null; changed(null) })
      publish()
    }
    created = monaco.editor.onDidCreateModel(attach)
    const existing = monaco.editor.getModel(uri)
    if (existing) attach(existing)
  })
  return {
    edit(expected: string, edit: TaskEdit) {
      if (!model || !api || model.getValue(api.editor.EndOfLinePreference.LF) !== expected) return
      model.pushStackElement()
      model.pushEditOperations(null, [{ range: new api.Range(edit.line, edit.startColumn, edit.line, edit.endColumn), text: edit.text }], () => null)
      model.pushStackElement()
    },
    dispose() { disposed = true; created?.dispose(); content?.dispose(); closing?.dispose(); model = null }
  }
}
