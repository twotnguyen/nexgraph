/// <reference types="vite/client" />
/// <reference path="./monaco-json.d.ts" />
// Gói tối thiểu: lõi soạn thảo + vài tính năng soạn thảo + tô cú pháp Monarch; định nghĩa/gợi ý/hover lấy từ language server ở main (lsp:*).
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
import 'monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands.js'
import 'monaco-editor/editor/contrib/gotoSymbol/browser/link/goToDefinitionAtPosition.js'
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js'
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution.js'
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
import { createTokenizationSupport } from 'monaco-editor/languages/features/json/tokenization.js'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import { currentTheme, observeTheme } from '../../state/useTheme'

;(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = { getWorker: () => new EditorWorker() }

// Đăng ký trực tiếp bộ tô cú pháp JSON. JSON mode của Monaco nạp thêm các dịch vụ IDE sau khi editor độc lập đã khởi tạo.
monaco.languages.register({
  id: 'json',
  extensions: ['.json', '.jsonc', '.bowerrc', '.jshintrc', '.jscsrc', '.eslintrc', '.babelrc', '.har'],
  aliases: ['JSON', 'json'],
  mimetypes: ['application/json']
})
monaco.languages.onLanguage('json', () => {
  monaco.languages.setTokensProvider('json', createTokenizationSupport(true))
  monaco.languages.setLanguageConfiguration('json', {
    wordPattern: /-?\d*\.\d\w*|[^\[\]{}:",\s]+/g,
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [['{', '}'], ['[', ']']],
    autoClosingPairs: [
      { open: '{', close: '}', notIn: ['string'] },
      { open: '[', close: ']', notIn: ['string'] },
      { open: '"', close: '"', notIn: ['string'] }
    ]
  })
})

// Monaco không đọc được biến CSS: dựng lại theme từ token của app mỗi khi đổi giao diện để editor cùng màu với khung.
const syntaxTokens: Record<string, string[]> = {
  keyword: ['keyword'], string: ['string', 'attribute.value'], comment: ['comment'], number: ['number'],
  type: ['type', 'type.identifier'], function: ['function'], variable: ['variable', 'variable.predefined'],
  constant: ['constant'], tag: ['tag'], attribute: ['attribute.name'], property: ['property'],
  punctuation: ['delimiter', 'operator'], emphasis: ['emphasis'], 'emphasis-strong': ['strong']
}
function editorTheme(): string {
  const css = getComputedStyle(document.body)
  const v = (name: string) => css.getPropertyValue(`--${name}`).trim()
  const rules = Object.entries(syntaxTokens).flatMap(([key, tokens]) => {
    const color = v(`syntax-${key}`).replace('#', '')
    return color ? tokens.map((token) => ({ token, foreground: color })) : []
  })
  monaco.editor.defineTheme('nexgraph', {
    base: currentTheme() === 'dark' ? 'vs-dark' : 'vs', inherit: true, rules,
    colors: {
      'editor.background': v('color-surface'), 'editor.foreground': v('color-text'),
      'editorLineNumber.foreground': v('color-muted') + '99', 'editorLineNumber.activeForeground': v('color-text'),
      'editor.lineHighlightBackground': v('track') + '80', 'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': v('blue') + '40', 'editorCursor.foreground': v('blue'),
      'editorWidget.background': v('panel-raised'), 'editorWidget.border': v('color-border'),
      'scrollbarSlider.background': v('color-muted') + '33', 'scrollbarSlider.hoverBackground': v('color-muted') + '55'
    }
  })
  return 'nexgraph'
}
const stopObservingTheme = observeTheme(() => monaco.editor.setTheme(editorTheme()))
import.meta.hot?.dispose(stopObservingTheme)

export interface EditorHandle {
  getValue(): string
  getSelection?(): { text: string; start: number; end: number } | null
  setValue(v: string): void
  onChange(cb: () => void): void
  onCursor?(cb: (line: number, column: number) => void): void
  revealLines(start: number, end?: number): void
  setReadOnly(v: boolean): void
  /** Bật chế độ Vim (monaco-vim) và ghi trạng thái vào `status`; null để tắt. */
  setVim?(status: HTMLElement | null): void
  dispose(): void
}

const modelUri = (path: string, projectId = '') => monaco.Uri.from({ scheme: 'nexgraph', authority: encodeURIComponent(projectId), path: `/${path}` })
const fromUri = (uri: monaco.Uri) => ({ projectId: decodeURIComponent(uri.authority), file: uri.path.slice(1) })

// Mở tệp khác khi F12 / ⌘-click trỏ sang tệp đó: mỗi editor giao cho chỗ đã tạo nó (thẻ tệp mở thẻ mới đúng dòng).
const openers = new WeakMap<monaco.editor.ICodeEditor, (file: string, line: number) => void>()
// Gỡ khi HMR nạp lại module, nếu không mỗi lần sửa mã nguồn lại thêm một bộ provider (gợi ý trùng).
const registrations: monaco.IDisposable[] = []
import.meta.hot?.dispose(() => registrations.forEach((item) => item.dispose()))
registrations.push(monaco.editor.registerEditorOpener({
  openCodeEditor: (source, resource, selection) => {
    const open = openers.get(source)
    if (resource.scheme !== 'nexgraph' || !open) return false
    const line = selection && 'startLineNumber' in selection ? selection.startLineNumber : selection?.lineNumber ?? 1
    open(fromUri(resource).file, line)
    return true
  }
}))

// CompletionItemKind của LSP (1–25) → của Monaco, theo tên.
const K = monaco.languages.CompletionItemKind
const LSP_KIND = [K.Text, K.Text, K.Method, K.Function, K.Constructor, K.Field, K.Variable, K.Class, K.Interface, K.Module, K.Property, K.Unit,
  K.Value, K.Enum, K.Keyword, K.Snippet, K.Color, K.File, K.Reference, K.Folder, K.EnumMember, K.Constant, K.Struct, K.Event, K.Operator, K.TypeParameter]
const lspOf = (model: monaco.editor.ITextModel) => {
  const api = window.nexgraph?.lsp
  if (!api || model.uri.scheme !== 'nexgraph' || !model.uri.authority) return null
  const { projectId, file } = fromUri(model.uri)
  return { api, projectId, file, text: model.getValue(monaco.editor.EndOfLinePreference.LF) }
}
for (const language of ['typescript', 'javascript', 'python']) {
  registrations.push(monaco.languages.registerDefinitionProvider(language, {
    provideDefinition: async (model, position) => {
      const lsp = lspOf(model)
      if (!lsp) return null
      const found = await lsp.api.definition(lsp.projectId, lsp.file, lsp.text, position.lineNumber, position.column).catch(() => [])
      return found.map((loc) => ({ uri: modelUri(loc.file, lsp.projectId), range: new monaco.Range(loc.line, loc.column, loc.line, loc.column) }))
    }
  }))
  registrations.push(monaco.languages.registerHoverProvider(language, {
    provideHover: async (model, position) => {
      const lsp = lspOf(model)
      const text = lsp && await lsp.api.hover(lsp.projectId, lsp.file, lsp.text, position.lineNumber, position.column).catch(() => null)
      return text ? { contents: [{ value: text }] } : null
    }
  }))
  registrations.push(monaco.languages.registerCompletionItemProvider(language, {
    triggerCharacters: ['.', '"', "'", '/', '@', '<'],
    provideCompletionItems: async (model, position) => {
      const lsp = lspOf(model)
      if (!lsp) return { suggestions: [] }
      const items = await lsp.api.completion(lsp.projectId, lsp.file, lsp.text, position.lineNumber, position.column).catch(() => [])
      const word = model.getWordUntilPosition(position)
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
      return { suggestions: items.map((item) => ({ label: item.label, kind: LSP_KIND[item.kind] ?? K.Text, detail: item.detail, insertText: item.insertText, sortText: item.sortText, filterText: item.filterText, range })) }
    }
  }))
}

/** Nạp monaco-vim khi cần; trả về hàm bật/tắt. */
function vimAttacher(editor: monaco.editor.IStandaloneCodeEditor): (status: HTMLElement | null) => void {
  let mode: { dispose(): void } | null = null
  let seq = 0
  return (status) => {
    const ticket = ++seq
    mode?.dispose()
    mode = null
    if (!status) return
    void import('monaco-vim').then(({ initVimMode }) => {
      if (ticket === seq) mode = initVimMode(editor, status)
    })
  }
}

/** Ngôn ngữ theo tên tệp hoặc đuôi tệp; không khớp thì `plaintext`. */
export function languageFor(file: string): string {
  const name = (file.split('/').pop() ?? file).toLowerCase()
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot) : null
  const hit = monaco.languages.getLanguages().find((l) => l.filenames?.some((f) => f.toLowerCase() === name) || (ext !== null && l.extensions?.includes(ext)))
  return hit?.id ?? 'plaintext'
}

/** `path`: model gắn với đường dẫn tệp để khung chia đôi (createMirror) dùng chung bộ đệm; có `projectId` thì F12/gợi ý/hover hỏi language server. */
export function createEditor(el: HTMLElement, opts: { value: string; language: string; readOnly: boolean; path?: string; projectId?: string; onOpenFile?: (file: string, line: number) => void }): EditorHandle {
  const font = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
  if (opts.path) monaco.editor.getModel(modelUri(opts.path, opts.projectId))?.dispose()
  const model = opts.path ? monaco.editor.createModel(opts.value, opts.language, modelUri(opts.path, opts.projectId)) : undefined
  const editor = monaco.editor.create(el, {
    ...(model ? { model } : { value: opts.value, language: opts.language }), readOnly: opts.readOnly, theme: editorTheme(),
    automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 12,
    ...(font ? { fontFamily: font } : {})
  })
  const hit = editor.createDecorationsCollection()
  const setVim = vimAttacher(editor)
  if (opts.onOpenFile) openers.set(editor, opts.onOpenFile)
  return {
    getValue: () => editor.getValue({ lineEnding: '\n', preserveBOM: false }),
    getSelection: () => {
      const selection = editor.getSelection()
      const model = editor.getModel()
      if (!selection || selection.isEmpty() || !model) return null
      return {
        text: model.getValueInRange(selection).replace(/\r\n?/g, '\n'),
        start: selection.startLineNumber,
        end: selection.endColumn === 1 && selection.endLineNumber > selection.startLineNumber
          ? selection.endLineNumber - 1 : selection.endLineNumber
      }
    },
    setValue: (v) => editor.setValue(v),
    onChange: (cb) => void editor.onDidChangeModelContent(() => cb()),
    onCursor: (cb) => void editor.onDidChangeCursorPosition((e) => cb(e.position.lineNumber, e.position.column)),
    revealLines: (start, end = start) => {
      hit.set([{ range: new monaco.Range(start, 1, end, 1), options: { isWholeLine: true, className: 'editor-hit' } }])
      editor.revealLinesInCenter(start, end)
    },
    setReadOnly: (v) => editor.updateOptions({ readOnly: v }),
    setVim,
    dispose: () => {
      setVim(null)
      const model = editor.getModel()
      editor.dispose()
      model?.dispose()
    }
  }
}

export interface MirrorHandle {
  dispose(): void
  setVim(status: HTMLElement | null): void
  onDisposeModel(cb: () => void): void
}

/** Khung thứ hai trên cùng model của một tệp đang mở (chia đôi kiểu Wu); null nếu tệp chưa nạp xong. */
export function createMirror(el: HTMLElement, path: string, projectId?: string): MirrorHandle | null {
  const model = monaco.editor.getModel(modelUri(path, projectId))
  if (!model) return null
  const font = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
  const editor = monaco.editor.create(el, {
    model, theme: editorTheme(), automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 12,
    ...(font ? { fontFamily: font } : {})
  })
  const setVim = vimAttacher(editor)
  return {
    setVim,
    onDisposeModel: (cb) => void model.onWillDispose(cb),
    dispose: () => { setVim(null); editor.dispose() }
  }
}

export interface DiffHandle {
  dispose(): void
}

/** Trình xem diff chỉ đọc; `automaticLayout` tự layout lại khi panel ẩn→hiện. */
export function createDiffEditor(el: HTMLElement, opts: { before: string; after: string; language: string }): DiffHandle {
  const font = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
  const diff = monaco.editor.createDiffEditor(el, {
    readOnly: true, theme: editorTheme(), automaticLayout: true, renderSideBySide: false,
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
