/// <reference types="vite/client" />
/// <reference path="./monaco-json.d.ts" />
// Gói tối thiểu: lõi soạn thảo + vài tính năng soạn thảo + tô cú pháp Monarch; định nghĩa/gợi ý/hover lấy từ language server ở main (lsp:*).
import * as monaco from 'monaco-editor/editor/editor.api.js'
import { MonacoBinding } from 'y-monaco'
import type { Text as YText } from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import type { DebugBreakpoint, LspDocumentSymbol, LspRange, LspWorkspaceEdit } from '@shared/api'
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
import 'monaco-editor/editor/contrib/codeAction/browser/codeActionContributions.js'
import { FormattingConflicts } from 'monaco-editor/editor/contrib/format/browser/format.js'
import 'monaco-editor/editor/contrib/gotoError/browser/gotoError.js'
import 'monaco-editor/editor/contrib/parameterHints/browser/parameterHints.js'
import { attachConflictWidgets } from '../git/conflict-widgets'
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
import { installFontKeys, monacoOptions } from './monacoPrefs'
import { overflowWidgetsHost, mountOverflowWidgets } from './overflowWidgets'
import { applyProjectEdits, diagnosticMarker } from './lspEdits'
import { getDiagnostics, subscribeDiagnostics } from '../../state/diagnostics'
import { tr } from '../../strings'


// Bản tối thiểu không có UI chọn formatter: luôn dùng provider đầu tiên (LSP).
const formatterSelector = FormattingConflicts.setFormatterSelector((providers) => providers[0])
import.meta.hot?.dispose(() => formatterSelector.dispose())
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
// Bookmark có glyph riêng, không dùng lại class của điểm dừng.
if (!document.getElementById('nexgraph-bookmark-glyph')) {
  const style = document.createElement('style')
  style.id = 'nexgraph-bookmark-glyph'
  style.textContent = '.editor-bookmark::before{content:"🔖";display:block;margin-left:3px;font-size:11px}'
  document.head.appendChild(style)
}

export interface EditorHandle {
  getValue(): string
  getSelection?(): { text: string; start: number; end: number } | null
  setValue(v: string): void
  onChange(cb: () => void): void
  watchChanges?(cb: () => void): () => void
  getPosition?(): { line: number; column: number }
  getLineCount?(): number
  getEOL?(): '\n' | '\r\n'
  setEOL?(eol: '\n' | '\r\n'): void
  getLanguage?(): string
  setLanguage?(language: string): void
  getWordAtCursor?(): string
  getScrollPosition?(): { top: number; left: number }
  setScrollPosition?(position: { top: number; left: number }): void
  previewPosition?(line: number): void
  clearPreview?(): void
  revealPosition?(line: number, column: number): void
  /** Chọn vùng theo toạ độ 1-based của Monaco (dòng, cột). */
  selectRange?(range: { startLine: number; startColumn: number; endLine: number; endColumn: number }): void
  runAction?(id: string): Promise<void>
  formatDocument?(): Promise<void>
  onCursor?(cb: (line: number, column: number) => void): void | (() => void)
  /** Vùng chọn đổi (kể cả chọn lại từ chương trình) mà con trỏ có thể đứng yên. */
  onSelection?(cb: () => void): void | (() => void)
  revealLines(start: number, end?: number): void
  setReadOnly(v: boolean): void
  /** Bật chế độ Vim (monaco-vim) và ghi trạng thái vào `status`; null để tắt. */
  setVim?(status: HTMLElement | null): void
  /** Chú thích mờ cuối một dòng (inline blame); null để xoá. */
  setLineNote?(line: number, text: string | null): void
  /** Điểm dừng (chấm đỏ ở lề) và dòng đang dừng khi gỡ lỗi. */
  setBreakpoints?(points: DebugBreakpoint[]): void
  setExecLine?(line: number | null): void
  /** Bookmark ở lề (dòng 1-based); truyền [] để xoá. */
  setBookmarks?(lines: number[]): void
  /** Bấm lề trái (cột chấm hoặc số dòng) ở một dòng. */
  onGutterClick?(cb: (line: number) => void): void
  onGutterContext?(cb: (line: number, x: number, y: number) => void): () => void
  addInlineZone?(line: number, node: HTMLElement): () => void
  /** Gắn model với Y.Text (cộng tác LAN); trả về hàm gỡ. Con trỏ người khác vẽ theo awareness. */
  bindCollab?(text: YText, awareness: Awareness): () => void
  /** Chèn văn bản tại con trỏ (thay vùng chọn), một bước undo. */
  insertText?(text: string): void
  dispose(): void
}

const modelUri = (path: string, projectId = '') => monaco.Uri.from({ scheme: 'nexgraph', authority: encodeURIComponent(projectId), path: `/${path}` })
const fromUri = (uri: monaco.Uri) => ({ projectId: decodeURIComponent(uri.authority), file: uri.path.slice(1) })

const toRange = ({ start, end }: LspRange) => new monaco.Range(start.line + 1, start.character + 1, end.line + 1, end.character + 1)
const readOnlyModels = new WeakSet<monaco.editor.ITextModel>()
// Nhiều tab/mirror mở cùng một tệp thì dùng chung model; chỉ huỷ khi không còn ai giữ.
const modelRefs = new WeakMap<monaco.editor.ITextModel, number>()
const retainModel = (model: monaco.editor.ITextModel) => modelRefs.set(model, (modelRefs.get(model) ?? 0) + 1)
const releaseModel = (model: monaco.editor.ITextModel) => {
  const refs = modelRefs.get(model) ?? 1
  if (refs > 1) { modelRefs.set(model, refs - 1); return }
  modelRefs.delete(model)
  if (!model.isDisposed()) model.dispose()
}

/** Đưa mọi buffer đang mở lên server trước một thao tác đổi tên liên tệp. */
export async function syncProjectModels(projectId: string): Promise<void> {
  const api = window.nexgraph.lsp
  if (!api) return
  await Promise.all(monaco.editor.getModels().flatMap((model) => {
    if (model.uri.scheme !== 'nexgraph') return []
    const target = fromUri(model.uri)
    return target.projectId === projectId ? [api.open(projectId, target.file, model.getValue(monaco.editor.EndOfLinePreference.LF))] : []
  }))
}

/** Áp dụng lên buffer đang mở; tệp khác ghi qua cùng đường an toàn và kiểm phiên bản như editor. */
export async function applyWorkspaceEdit(projectId: string, edits: LspWorkspaceEdit): Promise<void> {
  await applyProjectEdits(edits, {
    findModel: (file) => monaco.editor.getModel(modelUri(file, projectId)),
    isReadOnly: (model) => readOnlyModels.has(model),
    text: (model) => model.getValue(monaco.editor.EndOfLinePreference.LF),
    version: (model) => model.getVersionId(),
    disposed: (model) => model.isDisposed(),
    apply: (model, changes) => {
      model.pushStackElement()
      model.pushEditOperations(null, changes.map((change) => ({ range: toRange(change.range), text: change.newText })), () => null)
      model.pushStackElement()
    },
    read: (file) => window.nexgraph.fs.read(projectId, file),
    write: (file, text, opts) => window.nexgraph.fs.write(projectId, file, text, opts)
  })
}

// Mở tệp khác khi F12 / ⌘-click trỏ sang tệp đó: mỗi editor giao cho chỗ đã tạo nó (thẻ tệp mở thẻ mới đúng dòng).
const openers = new WeakMap<monaco.editor.ICodeEditor, (file: string, line: number, column?: number) => void>()
// Gỡ khi HMR nạp lại module, nếu không mỗi lần sửa mã nguồn lại thêm một bộ provider (gợi ý trùng).
const registrations: monaco.IDisposable[] = []
import.meta.hot?.dispose(() => registrations.forEach((item) => item.dispose()))
registrations.push(monaco.editor.registerEditorOpener({
  openCodeEditor: (source, resource, selection) => {
    const open = openers.get(source)
    if (resource.scheme !== 'nexgraph' || !open) return false
    const line = selection && 'startLineNumber' in selection ? selection.startLineNumber : selection?.lineNumber ?? 1
    const column = selection && 'startColumn' in selection ? selection.startColumn : selection?.column
    open(fromUri(resource).file, line, column)
    return true
  }
}))
registrations.push(monaco.editor.registerCommand('nexgraph.lsp.applyCodeAction', async (_accessor, projectId: string, edit: LspWorkspaceEdit) => {
  await applyWorkspaceEdit(projectId, edit)
}))

function symbolForMonaco(symbol: LspDocumentSymbol): monaco.languages.DocumentSymbol {
  return {
    name: symbol.name, detail: '', tags: [], kind: Math.max(0, Math.min(25, symbol.kind - 1)),
    range: toRange(symbol.range), selectionRange: toRange(symbol.selectionRange),
    children: symbol.children?.map(symbolForMonaco)
  }
}

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
  registrations.push(monaco.languages.registerDocumentSymbolProvider(language, {
    provideDocumentSymbols: async (model) => {
      const lsp = lspOf(model)
      if (!lsp) return []
      return (await lsp.api.documentSymbols(lsp.projectId, lsp.file, lsp.text)).map(symbolForMonaco)
    }
  }))
  registrations.push(monaco.languages.registerDocumentFormattingEditProvider(language, {
    provideDocumentFormattingEdits: async (model, options) => {
      const lsp = lspOf(model)
      if (!lsp) return []
      const edits = await lsp.api.format(lsp.projectId, lsp.file, lsp.text, { tabSize: options.tabSize, insertSpaces: options.insertSpaces })
      return edits.map((edit) => ({ range: toRange(edit.range), text: edit.newText }))
    }
  }))
  registrations.push(monaco.languages.registerSignatureHelpProvider(language, {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [','],
    provideSignatureHelp: async (model, position) => {
      const lsp = lspOf(model)
      if (!lsp) return null
      const help = await lsp.api.signatureHelp(lsp.projectId, lsp.file, lsp.text, position.lineNumber, position.column)
      if (!help) return null
      return {
        value: {
          activeSignature: help.activeSignature ?? 0, activeParameter: help.activeParameter ?? 0,
          signatures: help.signatures.map((signature) => ({
            ...signature, parameters: signature.parameters ?? []
          }))
        },
        dispose() {}
      }
    }
  }))
  registrations.push(monaco.languages.registerCodeActionProvider(language, {
    provideCodeActions: async (model, range) => {
      const lsp = lspOf(model)
      if (!lsp) return { actions: [], dispose() {} }
      const lspRange = { start: { line: range.startLineNumber - 1, character: range.startColumn - 1 }, end: { line: range.endLineNumber - 1, character: range.endColumn - 1 } }
      const actions = await lsp.api.codeActions(lsp.projectId, lsp.file, lsp.text, lspRange)
      return {
        actions: actions.map((action) => ({
          title: action.title, kind: action.kind ?? 'quickfix',
          command: { id: 'nexgraph.lsp.applyCodeAction', title: action.title, arguments: [lsp.projectId, action.edit] }
        })),
        dispose() {}
      }
    }
  }))
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
  registrations.push(monaco.languages.registerDeclarationProvider(language, {
    provideDeclaration: async (model, position) => {
      const lsp = lspOf(model)
      if (!lsp) return null
      const found = await lsp.api.declaration(lsp.projectId, lsp.file, lsp.text, position.lineNumber, position.column).catch(() => [])
      return found.map((loc) => ({ uri: modelUri(loc.file, lsp.projectId), range: new monaco.Range(loc.line, loc.column, loc.line, loc.column) }))
    }
  }))
  registrations.push(monaco.languages.registerTypeDefinitionProvider(language, {
    provideTypeDefinition: async (model, position) => {
      const lsp = lspOf(model)
      if (!lsp) return null
      const found = await lsp.api.typeDefinition(lsp.projectId, lsp.file, lsp.text, position.lineNumber, position.column).catch(() => [])
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

const SLASH_LANGS: Record<string, true> = { typescript: true, javascript: true, typescriptreact: true, javascriptreact: true, java: true, c: true, cpp: true, csharp: true, go: true, rust: true, jsonc: true, json5: true, dart: true, php: true, swift: true, kotlin: true, scala: true }
const HASH_LANGS: Record<string, true> = { python: true, yaml: true, shell: true, bash: true, zsh: true, ruby: true, perl: true }
const LIST_LANGS: Record<string, true> = { markdown: true }
/** `path`: model gắn với đường dẫn tệp để khung chia đôi (createMirror) dùng chung bộ đệm; có `projectId` thì F12/gợi ý/hover hỏi language server. */
/** Enter trên dòng comment/list: nội dung dòng mới (`replaceLine`: xoá marker thay vì xuống dòng). */
export function continuationFor(before: string, eol = '\n', language?: string): { text: string; replaceLine: boolean } | null {
  const match = /^([ \t]*)((?:\/\/+|#+)[ \t]*|[-*][ \t]+|\d+\.[ \t]+)(.*)$/.exec(before)
  if (!match) return null
  const [, indent, marker, rest] = match
  if (language) {
    const group = marker.startsWith('/') ? SLASH_LANGS : marker.startsWith('#') ? HASH_LANGS : LIST_LANGS
    if (!group[language]) return null
  }
  if (!rest.trim()) return { text: indent.replace(/(?:  |\t)$/, ''), replaceLine: true }
  const numbered = /^(\d+)\.[ \t]+$/.exec(marker)
  const next = numbered ? `${Number(numbered[1]) + 1}. ` : marker
  return { text: eol + indent + next, replaceLine: false }
}

function installContinuations(editor: monaco.editor.IStandaloneCodeEditor): void {
  editor.onKeyDown((event) => {
    if (event.keyCode !== monaco.KeyCode.Enter || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
    const model = editor.getModel()
    const position = editor.getPosition()
    if (!model || !position) return
    const line = model.getLineContent(position.lineNumber)
    if (line.slice(position.column - 1).trim()) return
    const edit = continuationFor(line.slice(0, position.column - 1), model.getEOL(), model.getLanguageId())
    if (!edit) return
    event.preventDefault()
    event.stopPropagation()
    const end = line.length + 1
    const range = edit.replaceLine
      ? new monaco.Range(position.lineNumber, 1, position.lineNumber, end)
      : new monaco.Range(position.lineNumber, end, position.lineNumber, end)
    editor.executeEdits('nexgraph.continuation', [{ range, text: edit.text, forceMoveMarkers: true }])
    const lineNumber = edit.replaceLine ? position.lineNumber : position.lineNumber + 1
    const column = edit.replaceLine ? edit.text.length + 1 : edit.text.length - model.getEOL().length + 1
    editor.setPosition({ lineNumber, column })
    editor.focus()
  })
}
export function createEditor(el: HTMLElement, opts: { value: string; language: string; readOnly: boolean; path?: string; projectId?: string; onOpenFile?: (file: string, line: number, column?: number) => void }): EditorHandle {
  const font = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
  const uri = opts.path ? modelUri(opts.path, opts.projectId) : null
  const model = uri ? monaco.editor.getModel(uri) ?? monaco.editor.createModel(opts.value, opts.language, uri) : undefined
  if (model) retainModel(model)
  if (model && opts.readOnly) readOnlyModels.add(model)
  const setMarkers = () => {
    if (model && opts.projectId && opts.path && !model.isDisposed()) {
      monaco.editor.setModelMarkers(model, 'lsp', getDiagnostics(opts.projectId, opts.path).map(diagnosticMarker))
    }
  }
  const stopDiagnostics = subscribeDiagnostics((event) => {
    if (event.projectId === opts.projectId && event.file === opts.path) setMarkers()
  })
  setMarkers()
  const overflowHost = overflowWidgetsHost()
  const editor = monaco.editor.create(el, {
    ...(model ? { model } : { value: opts.value, language: opts.language }), readOnly: opts.readOnly, theme: editorTheme(),
    automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false, glyphMargin: true, ...monacoOptions(),
    overflowWidgetsDomNode: overflowHost,
    ...(font ? { fontFamily: font } : {})
  })
  mountOverflowWidgets(el, overflowHost)
  installFontKeys(editor)
  if (!opts.readOnly) installContinuations(editor)
  const detachConflicts = attachConflictWidgets(editor)
  const hit = editor.createDecorationsCollection()
  const setVim = vimAttacher(editor)
  if (opts.onOpenFile) openers.set(editor, opts.onOpenFile)
  const note = editor.createDecorationsCollection()
  const breakpoints = editor.createDecorationsCollection()
  const exec = editor.createDecorationsCollection()
  const bookmarks = editor.createDecorationsCollection()
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
    watchChanges: (cb) => { const disposable = editor.onDidChangeModelContent(cb); return () => disposable.dispose() },
    getPosition: () => { const p = editor.getPosition(); return { line: p?.lineNumber ?? 1, column: p?.column ?? 1 } },
    getLineCount: () => editor.getModel()?.getLineCount() ?? 1,
    getEOL: () => (editor.getModel()?.getEOL() === '\r\n' ? '\r\n' : '\n'),
    setEOL: (eol) => editor.getModel()?.pushEOL(eol === '\r\n' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF),
    getLanguage: () => editor.getModel()?.getLanguageId() ?? opts.language,
    setLanguage: (language) => { const model = editor.getModel(); if (model) monaco.editor.setModelLanguage(model, language) },
    getWordAtCursor: () => { const p = editor.getPosition(); return p ? editor.getModel()?.getWordAtPosition(p)?.word ?? '' : '' },
    getScrollPosition: () => ({ top: editor.getScrollTop(), left: editor.getScrollLeft() }),
    setScrollPosition: ({ top, left }) => editor.setScrollPosition({ scrollTop: top, scrollLeft: left }),
    previewPosition: (line) => {
      hit.set([{ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'editor-hit' } }])
      editor.revealLineInCenter(line)
    },
    clearPreview: () => hit.clear(),
    revealPosition: (line, column) => {
      hit.clear()
      editor.setPosition({ lineNumber: line, column })
      editor.revealPositionInCenter({ lineNumber: line, column })
      editor.focus()
    },
    selectRange: ({ startLine, startColumn, endLine, endColumn }) => {
      const range = new monaco.Range(startLine, startColumn, endLine, endColumn)
      editor.setSelection(range)
      editor.revealRangeInCenter(range)
    },
    runAction: async (id) => {
      editor.focus()
      const found = editor.getAction(id)
      if (!found) throw new Error(tr('Lệnh editor "{id}" không có trong phiên bản Monaco này.', { id }))
      await found.run()
    },
    formatDocument: async () => { await editor.getAction('editor.action.formatDocument')?.run() },
    onCursor: (cb) => { const sub = editor.onDidChangeCursorPosition((e) => cb(e.position.lineNumber, e.position.column)); return () => sub.dispose() },
    onSelection: (cb) => { const sub = editor.onDidChangeCursorSelection(() => cb()); return () => sub.dispose() },
    revealLines: (start, end = start) => {
      hit.set([{ range: new monaco.Range(start, 1, end, 1), options: { isWholeLine: true, className: 'editor-hit' } }])
      editor.revealLinesInCenter(start, end)
    },
    setReadOnly: (v) => {
      const current = editor.getModel()
      if (current) { if (v) readOnlyModels.add(current); else readOnlyModels.delete(current) }
      editor.updateOptions({ readOnly: v })
    },
    setVim,
    setLineNote: (line, text) => {
      const end = editor.getModel()?.getLineMaxColumn(line) ?? 1
      // Khoảng rỗng ở cuối dòng: phải có showIfCollapsed thì Monaco mới vẽ chữ chèn.
      note.set(text ? [{ range: new monaco.Range(line, end, line, end), options: { showIfCollapsed: true, after: { content: `      ${text}`, inlineClassName: 'editor-line-note' } } }] : [])
    },
    setBreakpoints: (points) => breakpoints.set(points.map((point) => ({
      range: new monaco.Range(point.line, 1, point.line, 1),
      options: { glyphMarginClassName: `editor-breakpoint${point.enabled ? '' : ' editor-breakpoint-disabled'}${point.logMessage ? ' editor-breakpoint-log' : point.condition || point.hitCondition ? ' editor-breakpoint-condition' : ''}`,
        glyphMarginHoverMessage: { value: point.logMessage ? tr('Log point') : point.condition || point.hitCondition ? tr('Điểm dừng có điều kiện') : tr('Điểm dừng') } }
    }))),
    setExecLine: (line) => {
      exec.set(line ? [{ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'editor-exec-line', glyphMarginClassName: 'editor-exec-arrow' } }] : [])
      if (line) editor.revealLineInCenterIfOutsideViewport(line)
    },
    setBookmarks: (lines) => bookmarks.set(lines.map((line) => ({
      range: new monaco.Range(line, 1, line, 1),
      options: { glyphMarginClassName: 'editor-bookmark' }
    }))),
    onGutterClick: (cb) => void editor.onMouseDown((e) => {
      // Chỉ cột chấm (glyph margin): bấm số dòng vẫn để chọn cả dòng như thường.
      if (e.event.leftButton && e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && e.target.position) cb(e.target.position.lineNumber)
    }),
    onGutterContext: (cb) => {
      const handle = (event: MouseEvent) => {
        const target = editor.getTargetAtClientPoint(event.clientX, event.clientY)
        if (!target?.position || (target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS)) return
        event.preventDefault()
        event.stopImmediatePropagation()
        cb(target.position.lineNumber, event.clientX, event.clientY)
      }
      el.addEventListener('contextmenu', handle, true)
      return () => el.removeEventListener('contextmenu', handle, true)
    },
    addInlineZone: (line, node) => {
      let id = ''
      editor.changeViewZones((accessor) => { id = accessor.addZone({ afterLineNumber: line, heightInPx: 132, domNode: node, suppressMouseDown: false }) })
      editor.revealLineInCenterIfOutsideViewport(line)
      return () => editor.changeViewZones((accessor) => accessor.removeZone(id))
    },
    bindCollab: (text, awareness) => {
      const binding = new MonacoBinding(text, editor.getModel()!, new Set([editor]), awareness)
      return () => binding.destroy()
    },
    insertText: (text) => {
      const selection = editor.getSelection()
      if (!selection || editor.getOption(monaco.editor.EditorOption.readOnly)) return
      editor.executeEdits('nexgraph', [{ range: selection, text, forceMoveMarkers: true }])
      editor.focus()
    },
    dispose: () => {
      setVim(null)
      detachConflicts()
      bookmarks.clear()
      const model = editor.getModel()
      editor.dispose()
      if (model) releaseModel(model)
    }
  }
}

export interface MirrorHandle {
  dispose(): void
  setVim(status: HTMLElement | null): void
  setReadOnly(readOnly: boolean): void
  onDisposeModel(cb: () => void): void
}

/** Khung thứ hai trên cùng model của một tệp đang mở (chia đôi kiểu Wu); null nếu tệp chưa nạp xong. */
export function createMirror(el: HTMLElement, path: string, projectId?: string, readOnly = false): MirrorHandle | null {
  const model = monaco.editor.getModel(modelUri(path, projectId))
  if (!model) return null
  retainModel(model)
  const font = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
  const overflowHost = overflowWidgetsHost()
  const editor = monaco.editor.create(el, {
    model, theme: editorTheme(), readOnly, automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false, ...monacoOptions(),
    overflowWidgetsDomNode: overflowHost,
    ...(font ? { fontFamily: font } : {})
  })
  mountOverflowWidgets(el, overflowHost)
  installFontKeys(editor)
  const setVim = vimAttacher(editor)
  return {
    setVim,
    setReadOnly: (value) => editor.updateOptions({ readOnly: value }),
    onDisposeModel: (cb) => void model.onWillDispose(cb),
    dispose: () => { setVim(null); editor.dispose(); releaseModel(model) }
  }
}

export interface DiffHandle {
  dispose(): void
}

/** Trình xem diff chỉ đọc; `automaticLayout` tự layout lại khi panel ẩn→hiện. */
export function createDiffEditor(el: HTMLElement, opts: { before: string; after: string; language: string }): DiffHandle {
  const font = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
  const overflowHost = overflowWidgetsHost()
  const diff = monaco.editor.createDiffEditor(el, {
    readOnly: true, theme: editorTheme(), automaticLayout: true, renderSideBySide: false,
    minimap: { enabled: false }, scrollBeyondLastLine: false, ...monacoOptions(),
    overflowWidgetsDomNode: overflowHost,
    ...(font ? { fontFamily: font } : {})
  })
  mountOverflowWidgets(el, overflowHost)
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
