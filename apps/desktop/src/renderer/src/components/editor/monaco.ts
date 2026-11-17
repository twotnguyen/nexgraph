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
// Chỉ đăng ký Monarch cho các ngôn ngữ cần dùng; mỗi register là chunk nhỏ nạp riêng.
import 'monaco-editor/languages/definitions/typescript/register.js'
import 'monaco-editor/languages/definitions/javascript/register.js'
import 'monaco-editor/languages/definitions/python/register.js'
import 'monaco-editor/languages/definitions/csharp/register.js'
import 'monaco-editor/languages/definitions/dart/register.js'
import 'monaco-editor/languages/definitions/markdown/register.js'
import 'monaco-editor/languages/definitions/html/register.js'
import 'monaco-editor/languages/definitions/css/register.js'
import 'monaco-editor/languages/definitions/yaml/register.js'
// JSON không có Monarch: chỉ bật tokenize trong luồng chính, tắt mọi tính năng dùng worker (không language server).
import { jsonDefaults } from 'monaco-editor/languages/features/json/register.js'

jsonDefaults.setDiagnosticsOptions({ validate: false, allowComments: true, schemas: [], enableSchemaRequest: false, schemaValidation: 'ignore', comments: 'ignore', trailingCommas: 'ignore' })
jsonDefaults.setModeConfiguration({ documentFormattingEdits: false, documentRangeFormattingEdits: false, completionItems: false, hovers: false, documentSymbols: false, tokens: true, colors: false, foldingRanges: false, diagnostics: false, selectionRanges: false })
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'

;(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = { getWorker: () => new EditorWorker() }

export interface EditorHandle {
  getValue(): string
  setValue(v: string): void
  onChange(cb: () => void): void
  revealLines(start: number, end?: number): void
  setReadOnly(v: boolean): void
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
    getValue: () => editor.getValue({ lineEnding: '\n', preserveBOM: false }),
    setValue: (v) => editor.setValue(v),
    onChange: (cb) => void editor.onDidChangeModelContent(() => cb()),
    revealLines: (start, end = start) => {
      hit.set([{ range: new monaco.Range(start, 1, end, 1), options: { isWholeLine: true, className: 'editor-hit' } }])
      editor.revealLinesInCenter(start, end)
    },
    setReadOnly: (v) => editor.updateOptions({ readOnly: v }),
    dispose: () => {
      const model = editor.getModel()
      editor.dispose()
      model?.dispose()
    }
  }
}

export interface DiffHandle {
  dispose(): void
}

/** Trình xem diff chỉ đọc; `automaticLayout` tự layout lại khi panel ẩn→hiện. */
export function createDiffEditor(el: HTMLElement, opts: { before: string; after: string; language: string }): DiffHandle {
  const font = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
  const diff = monaco.editor.createDiffEditor(el, {
    readOnly: true, theme: 'vs', automaticLayout: true, renderSideBySide: false,
    minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 12,
    ...(font ? { fontFamily: font } : {})
  })
  const original = monaco.editor.createModel(opts.before, opts.language)
  const modified = monaco.editor.createModel(opts.after, opts.language)
  diff.setModel({ original, modified })
  return {
    dispose: () => {
      diff.dispose()
      original.dispose()
      modified.dispose()
    }
  }
}
