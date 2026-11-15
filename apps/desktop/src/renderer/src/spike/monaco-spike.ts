import * as monaco from 'monaco-editor/editor/editor.api.js'
import 'monaco-editor/languages/definitions/python/register.js'
import 'monaco-editor/languages/definitions/typescript/register.js'
import 'monaco-editor/language/typescript/monaco.contribution.js'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker'

;(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker: (_id: string, label: string) => (label === 'typescript' || label === 'javascript' ? new TsWorker() : new EditorWorker())
}

export async function runMonacoSpike(): Promise<Record<string, unknown>> {
  document.body.innerHTML = '<div id="a" style="width:600px;height:200px"></div><div id="b" style="width:600px;height:200px"></div>'
  const mk = (id: string, lang: string, text: string, file: string) => {
    const model = monaco.editor.createModel(text, undefined, monaco.Uri.file(file))
    const ed = monaco.editor.create(document.getElementById(id)!, { model })
    return { ed, model, el: document.getElementById(id)! }
  }
  const ts = mk('a', 'typescript', 'const x: number = 1\nfunction f(a: string) { return a.length }\nf(x)\n', '/t.ts')
  const py = mk('b', 'python', 'def f(a):\n    return len(a)  # c\n', '/t.py')
  await new Promise((r) => setTimeout(r, 4000)) // chờ tokenizer nạp lười + ts worker
  const classes = (el: Element) => [...new Set([...el.querySelectorAll('.view-line span span')].map((s) => s.className))]
  const markers = monaco.editor.getModelMarkers({ resource: ts.model.uri })
  return {
    tsLang: ts.model.getLanguageId(), pyLang: py.model.getLanguageId(),
    tsTokenClasses: classes(ts.el), pyTokenClasses: classes(py.el),
    tsMarkers: markers.map((m) => m.message.slice(0, 80))
  }
}
