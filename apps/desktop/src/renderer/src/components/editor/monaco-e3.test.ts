// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

type FakeModel = {
  uri: { toString(): string }
  getValue(): string
  setValue(next: string): void
  isDisposed(): boolean
  dispose: Mock
  onWillDispose(): { dispose(): void }
  getLineCount(): number
  getLineMaxColumn(): number
  getVersionId(): number
}
type FakeCollection = { set: Mock; clear: Mock }
type FakeEditor = {
  getModel(): FakeModel | null
  getValue(): string
  setValue(value: string): void
  setSelection: Mock
  revealRangeInCenter: Mock
  dispose: Mock
  createDecorationsCollection(): FakeCollection
}
type EditorOptions = { model?: FakeModel; value?: string }
const fake = vi.hoisted(() => {
  const models = new Map<string, FakeModel>()
  const collections: FakeCollection[] = []
  const editors: FakeEditor[] = []
  const disposable = { dispose() {} }
  const createModel = vi.fn((value: string, _language: string, uri: { toString(): string }): FakeModel => {
    let text = value
    let disposed = false
    const model = {
      uri,
      getValue: () => text,
      setValue: (next: string) => { text = next },
      isDisposed: () => disposed,
      dispose: vi.fn(() => { disposed = true; models.delete(uri.toString()) }),
      onWillDispose: () => disposable,
      getLineCount: () => text.split('\n').length,
      getLineMaxColumn: () => 1,
      getVersionId: () => 1
    }
    models.set(uri.toString(), model)
    return model
  })
  const createEditorMock = vi.fn((options: EditorOptions): FakeEditor => {
    const model = options.model ?? null
    const editor = {
      getModel: () => model,
      getValue: () => model?.getValue() ?? options.value ?? '',
      setValue: (v: string) => model?.setValue(v),
      setSelection: vi.fn(),
      revealRangeInCenter: vi.fn(),
      dispose: vi.fn(),
      createDecorationsCollection: () => {
        const collection = { set: vi.fn(), clear: vi.fn() }
        collections.push(collection)
        return collection
      }
    }
    editors.push(editor)
    return editor
  })
  return { models, collections, editors, createModel, createEditorMock, disposable }
})

const sideEffectModules = [
  'monaco-editor/editor/contrib/find/browser/findController.js',
  'monaco-editor/editor/contrib/comment/browser/comment.js',
  'monaco-editor/editor/contrib/folding/browser/folding.js',
  'monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js',
  'monaco-editor/editor/contrib/multicursor/browser/multicursor.js',
  'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js',
  'monaco-editor/editor/contrib/wordOperations/browser/wordOperations.js',
  'monaco-editor/editor/contrib/clipboard/browser/clipboard.js',
  'monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js',
  'monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands.js',
  'monaco-editor/editor/contrib/gotoSymbol/browser/link/goToDefinitionAtPosition.js',
  'monaco-editor/editor/contrib/suggest/browser/suggestController.js',
  'monaco-editor/editor/contrib/hover/browser/hoverContribution.js',
  'monaco-editor/editor/contrib/codeAction/browser/codeActionContributions.js',
  'monaco-editor/editor/contrib/gotoError/browser/gotoError.js',
  'monaco-editor/editor/contrib/parameterHints/browser/parameterHints.js',
  'monaco-editor/languages/definitions/typescript/register.js',
  'monaco-editor/languages/definitions/javascript/register.js',
  'monaco-editor/languages/definitions/python/register.js',
  'monaco-editor/languages/definitions/csharp/register.js',
  'monaco-editor/languages/definitions/dart/register.js',
  'monaco-editor/languages/definitions/markdown/register.js',
  'monaco-editor/languages/definitions/html/register.js',
  'monaco-editor/languages/definitions/css/register.js',
  'monaco-editor/languages/definitions/yaml/register.js'
]
for (const path of sideEffectModules) vi.doMock(path, () => ({}))
vi.doMock('monaco-editor/editor/contrib/format/browser/format.js', () => ({ FormattingConflicts: { setFormatterSelector: () => fake.disposable } }))
vi.doMock('monaco-editor/languages/features/json/tokenization.js', () => ({ createTokenizationSupport: () => ({}) }))
vi.doMock('monaco-editor/editor/editor.worker.js?worker', () => ({ default: class {} }))
vi.doMock('y-monaco', () => ({ MonacoBinding: class { destroy() {} } }))
vi.doMock('../git/conflict-widgets', () => ({ attachConflictWidgets: () => () => {} }))
vi.doMock('../../state/useTheme', () => ({ currentTheme: () => 'dark', observeTheme: () => () => {} }))
vi.doMock('./monacoPrefs', () => ({ installFontKeys: () => {}, monacoOptions: () => ({}) }))
vi.doMock('./lspEdits', () => ({ applyProjectEdits: async () => {}, diagnosticMarker: () => ({}) }))
vi.doMock('../../state/diagnostics', () => ({ getDiagnostics: () => [], subscribeDiagnostics: () => () => {} }))
vi.doMock('monaco-editor/editor/editor.api.js', () => {
  class Range {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number
    ) {}
  }
  const languageMethods: Record<string, unknown> = {
    register: () => fake.disposable,
    onLanguage: () => fake.disposable,
    getLanguages: () => [],
    CompletionItemKind: new Proxy({}, { get: (_target, key) => String(key) })
  }
  const languages = new Proxy(languageMethods, {
    get: (target, key) => {
      const name = String(key)
      return name in target ? target[name] : () => fake.disposable
    }
  })
  const editor = {
    create: (_el: HTMLElement, options: EditorOptions) => fake.createEditorMock(options),
    createModel: fake.createModel,
    getModel: (uri: { toString(): string }) => fake.models.get(uri.toString()),
    getModels: () => [...fake.models.values()],
    defineTheme: () => {},
    setTheme: () => {},
    setModelMarkers: () => {},
    registerEditorOpener: () => fake.disposable,
    registerCommand: () => fake.disposable,
    EndOfLinePreference: { LF: 1 },
    EditorOption: { readOnly: 1 },
    MouseTargetType: { GUTTER_GLYPH_MARGIN: 1, GUTTER_LINE_NUMBERS: 2 }
  }
  return {
    Range,
    Uri: {
      from: (parts: { scheme: string; authority: string; path: string }) => ({
        ...parts, toString: () => `${parts.scheme}://${parts.authority}${parts.path}`
      })
    },
    editor,
    languages
  }
})

// Phải đăng ký các vi.doMock ở trên trước khi nạp monaco.ts (mô-đun có nhiều import phụ).
const { createEditor, createMirror } = await import('./monaco')

const el = () => document.createElement('div')
const opts = (path?: string) => ({ value: 'disk', language: 'typescript', readOnly: false, path, projectId: 'p1' })

beforeEach(() => {
  fake.models.clear()
  fake.collections.length = 0
  fake.editors.length = 0
  fake.createModel.mockClear()
  fake.createEditorMock.mockClear()
})

describe('E3 editor handles', () => {
  it('draws bookmarks in a separate glyph margin collection and replaces them on the next call', () => {
    const handle = createEditor(el(), opts())
    const breakpoints = fake.collections[2]
    const bookmarks = fake.collections.at(-1)!
    handle.setBreakpoints?.([{ line: 3, enabled: true }])
    handle.setBookmarks?.([2, 5])
    expect(bookmarks.set).toHaveBeenCalledWith([
      { range: expect.objectContaining({ startLineNumber: 2, endLineNumber: 2 }), options: { glyphMarginClassName: 'editor-bookmark' } },
      { range: expect.objectContaining({ startLineNumber: 5, endLineNumber: 5 }), options: { glyphMarginClassName: 'editor-bookmark' } }
    ])
    expect(breakpoints.set).toHaveBeenCalledTimes(1)

    handle.setBookmarks?.([7])
    expect(bookmarks.set).toHaveBeenLastCalledWith([
      { range: expect.objectContaining({ startLineNumber: 7, endLineNumber: 7 }), options: { glyphMarginClassName: 'editor-bookmark' } }
    ])
    expect(breakpoints.set).toHaveBeenCalledTimes(1)

    handle.dispose()
    expect(bookmarks.clear).toHaveBeenCalledTimes(1)
  })

  it('selects and reveals a 1-based range without shifting coordinates', () => {
    const handle = createEditor(el(), opts())
    handle.selectRange?.({ startLine: 3, startColumn: 4, endLine: 5, endColumn: 6 })
    const editor = fake.editors.at(-1)!
    const range = editor.setSelection.mock.calls[0][0]
    expect(range).toMatchObject({ startLineNumber: 3, startColumn: 4, endLineNumber: 5, endColumn: 6 })
    expect(editor.revealRangeInCenter).toHaveBeenCalledWith(range)
  })

  it('reuses a live same-Uri model and disposes it only when the last owner leaves', () => {
    const first = createEditor(el(), opts('src/a.ts'))
    first.setValue?.('chưa lưu')
    const second = createEditor(el(), opts('src/a.ts'))
    expect(fake.createModel).toHaveBeenCalledTimes(1)
    const model = fake.editors[0].getModel()!
    expect(fake.editors[1].getModel()).toBe(model)
    expect(fake.editors[1].getValue()).toBe('chưa lưu')

    first.dispose()
    expect(model.dispose).not.toHaveBeenCalled()
    expect(fake.editors[1].getValue()).toBe('chưa lưu')

    second.dispose()
    expect(model.dispose).toHaveBeenCalledTimes(1)
  })

  it('keeps the shared model alive while a split mirror is open', () => {
    const handle = createEditor(el(), opts('src/b.ts'))
    const mirror = createMirror(el(), 'src/b.ts', 'p1')
    const model = fake.editors[0].getModel()!
    handle.dispose()
    expect(model.dispose).not.toHaveBeenCalled()
    mirror?.dispose()
    expect(model.dispose).toHaveBeenCalledTimes(1)
  })
})
