/// <reference types="vite/client" />
// Gói tối thiểu: lõi soạn thảo + vài tính năng soạn thảo + tô cú pháp Monarch (không worker ngôn ngữ, không LSP).
import * as monaco from 'monaco-editor/editor/editor.api.js'
import 'monaco-editor/editor/contrib/find/browser/findController.js'
import 'monaco-editor/editor/contrib/comment/browser/comment.js'
import 'monaco-editor/editor/contrib/folding/browser/folding.js'
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js'
import 'monaco-editor/editor/contrib/multicursor/browser/multicursor.js'
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js'
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations.js'
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js'
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js'
import 'monaco-editor/languages/definitions/register.all.js'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'

;(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = { getWorker: () => new EditorWorker() }

export interface EditorHandle {
  getValue(): string
  setValue(v: string): void
  onChange(cb: () => void): void
  revealLines(start: number, end?: number): void
  dispose(): void
}

/** Ngôn ngữ theo tên tệp hoặc đuôi tệp; không khớp thì `plaintext`. */
export function languageFor(file: string): string {
  const name = (file.split('/').pop() ?? file).toLowerCase()
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot) : null
  const hit = monaco.languages.getLanguages().find((l) => l.filenames?.some((f) => f.toLowerCase() === name) || (ext !== null && l.extensions?.includes(ext)))
  return hit?.id ?? 'plaintext'
}

export function createEditor(el: HTMLElement, opts: { value: string; language: string; readOnly: boolean }): EditorHandle {
  const font = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
  const editor = monaco.editor.create(el, {
    value: opts.value, language: opts.language, readOnly: opts.readOnly, theme: 'vs',
    automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 12,
    ...(font ? { fontFamily: font } : {})
  })
  const hit = editor.createDecorationsCollection()
  return {
    getValue: () => editor.getValue(),
    setValue: (v) => editor.setValue(v),
    onChange: (cb) => void editor.onDidChangeModelContent(() => cb()),
    revealLines: (start, end = start) => {
      hit.set([{ range: new monaco.Range(start, 1, end, 1), options: { isWholeLine: true, className: 'editor-hit' } }])
      editor.revealLinesInCenter(start, end)
    },
    dispose: () => {
      const model = editor.getModel()
      editor.dispose()
      model?.dispose()
    }
  }
}
