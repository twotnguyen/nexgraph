// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

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
  getLineContent(line: number): string
  getLanguageId(): string
  setLanguageId(id: string): void
}
type FakeCollection = { set: Mock; clear: Mock }
type FakeEditor = {
  getModel(): FakeModel | null
  getValue(): string
  setValue(value: string): void
  setSelection: Mock
  revealRangeInCenter: Mock
  dispose: Mock
  updateOptions: Mock
  createDecorationsCollection(): FakeCollection
  onKeyDown(cb: (event: FakeKey) => void): { dispose(): void }
  getPosition(): { lineNumber: number; column: number }
  fireKey(keyCode: number): void
  setPosition: Mock
  executeEdits: Mock
  focus: Mock
}
type FakeKey = { keyCode: number; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; preventDefault: Mock; stopPropagation: Mock }
type EditorOptions = { model?: FakeModel; value?: string; overflowWidgetsDomNode?: HTMLElement }
type FakeProvider = Record<string, (model: FakeModel, position: { lineNumber: number; column: number }) => Promise<unknown>>
const fake = vi.hoisted(() => {
  const models = new Map<string, FakeModel>()
  const collections: FakeCollection[] = []
  const editors: FakeEditor[] = []
  const providers: { name: string; language: string; provider: FakeProvider }[] = []
  const disposable = { dispose() {} }
  const createModel = vi.fn((value: string, language: string, uri?: { toString(): string }): FakeModel => {
    let text = value
    let lang = language
    let disposed = false
    const modelUri = uri ?? { toString: () => `inmemory://${models.size}` }
    const model = {
      uri: modelUri,
      getValue: () => text,
      setValue: (next: string) => { text = next },
      isDisposed: () => disposed,
      dispose: vi.fn(() => { disposed = true; models.delete(modelUri.toString()) }),
      onWillDispose: () => disposable,
      getLineCount: () => text.split('\n').length,
      getLineMaxColumn: () => 1,
      getVersionId: () => 1,
      getLineContent: (line: number) => text.split('\n')[line - 1] ?? '',
      getEOL: () => '\n',
      getLanguageId: () => lang,
      setLanguageId: (id: string) => { lang = id }
    }
    models.set(modelUri.toString(), model)
    return model
  })
  const createEditorMock = vi.fn((options: EditorOptions): FakeEditor => {
    const model = options.model ?? null
    let keyHandler: ((event: FakeKey) => void) | undefined
    let cursor = { lineNumber: 1, column: 1 }
    const editor = {
      getModel: () => model,
      getValue: () => model?.getValue() ?? options.value ?? '',
      setValue: (v: string) => model?.setValue(v),
      setSelection: vi.fn(),
      revealRangeInCenter: vi.fn(),
      dispose: vi.fn(),
      updateOptions: vi.fn(),
      createDecorationsCollection: () => {
        const collection = { set: vi.fn(), clear: vi.fn() }
        collections.push(collection)
        return collection
      },
      onKeyDown: (cb: (event: FakeKey) => void) => { keyHandler = cb; return disposable },
      fireKey: (keyCode: number) => keyHandler?.({ keyCode, ctrlKey: false, metaKey: false, altKey: false,
        shiftKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() }),
      getPosition: () => cursor,
      setPosition: vi.fn((position: { lineNumber: number; column: number }) => { cursor = position }),
      executeEdits: vi.fn(),
      focus: vi.fn()
    }
    editors.push(editor)
    return editor
  })
  return { models, collections, editors, providers, createModel, createEditorMock, diffOptions: [] as EditorOptions[], disposable, installFontKeys: vi.fn() }
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
vi.doMock('./monacoPrefs', () => ({ installFontKeys: fake.installFontKeys, monacoOptions: () => ({}) }))
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
      if (name.startsWith('register') && name.endsWith('Provider')) return (language: string, provider: FakeProvider) => {
        fake.providers.push({ name, language, provider })
        return fake.disposable
      }
      return name in target ? target[name] : () => fake.disposable
    }
  })
  const editor = {
    create: (_el: HTMLElement, options: EditorOptions) => fake.createEditorMock(options),
    createDiffEditor: (el: HTMLElement, options: EditorOptions) => {
      fake.diffOptions.push(options)
      // Hai editor con thật của Monaco: mỗi editor có cây DOM .monaco-editor riêng và
      // Monaco gắn node widget tràn vào chính cây đó khi không cấp host bên ngoài.
      const child = () => {
        const root = document.createElement('div')
        root.className = 'monaco-editor'
        const content = document.createElement('div')
        content.className = 'overflowingContentWidgets'
        const overlay = document.createElement('div')
        overlay.className = 'overflowingOverlayWidgets'
        root.append(content, overlay)
        el.appendChild(root)
        return { getDomNode: () => root, dispose: vi.fn(), updateOptions: vi.fn() }
      }
      let original: ReturnType<typeof child> | undefined
      let modified: ReturnType<typeof child> | undefined
      return { setModel: vi.fn(), dispose: vi.fn(), getOriginalEditor: () => (original ??= child()), getModifiedEditor: () => (modified ??= child()) }
    },
    createModel: fake.createModel,
    getModel: (uri: { toString(): string }) => fake.models.get(uri.toString()),
    getModels: () => [...fake.models.values()],
    defineTheme: () => {},
    setTheme: () => {},
    setModelMarkers: () => {},
    getEditors: () => fake.editors,
    setModelLanguage: (model: FakeModel, language: string) => model.setLanguageId(language),
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
    KeyCode: { Enter: 3 },
    languages
  }
})

// Phải đăng ký các vi.doMock ở trên trước khi nạp monaco.ts (mô-đun có nhiều import phụ).
const { createEditor, createMirror, createDiffEditor, continuationFor } = await import('./monaco')

const el = () => document.createElement('div')
const opts = (path?: string, language = 'typescript') => ({ value: 'disk', language, readOnly: false, path, projectId: 'p1' })

beforeEach(() => {
  fake.models.clear()
  fake.collections.length = 0
  fake.editors.length = 0
  fake.createModel.mockClear()
  fake.createEditorMock.mockClear()
  fake.installFontKeys.mockClear()
})
afterEach(() => vi.unstubAllGlobals())

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

  it('registers font zoom keys in the main editor', () => {
    createEditor(el(), opts('a.ts'))
    expect(fake.installFontKeys).toHaveBeenCalledWith(fake.editors.at(-1))
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
  it('creates a locked split mirror readOnly and can unlock it', () => {
    const handle = createEditor(el(), opts('src/c.ts'))
    const mirror = createMirror(el(), 'src/c.ts', 'p1', true)!
    expect(fake.createEditorMock.mock.calls.at(-1)?.[0]).toMatchObject({ readOnly: true })
    mirror.setReadOnly(false)
    expect(fake.editors.at(-1)!.updateOptions).toHaveBeenCalledWith({ readOnly: false })
    handle.dispose()
    mirror.dispose()
  })

  it('passes a page-anchored overflow widget node to the editor, the mirror and the diff editor', () => {
    const editorEl = el()
    const handle = createEditor(editorEl, opts('src/d.ts'))
    const editorOptions = fake.createEditorMock.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(editorOptions.fixedOverflowWidgets).toBeUndefined()
    const host = editorOptions.overflowWidgetsDomNode as HTMLElement
    expect(host).toBeInstanceOf(HTMLElement)
    expect(host.parentElement).toBe(editorEl)
    expect(host.className).toContain('monaco-editor')

    const mirrorEl = el()
    const mirror = createMirror(mirrorEl, 'src/d.ts', 'p1')!
    const mirrorOptions = fake.createEditorMock.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(mirrorOptions.overflowWidgetsDomNode).toBeInstanceOf(HTMLElement)
    expect((mirrorOptions.overflowWidgetsDomNode as HTMLElement).parentElement).toBe(mirrorEl)
    expect(mirrorOptions.overflowWidgetsDomNode).not.toBe(host)

    const diffEl = el()
    const diff = createDiffEditor(diffEl, { before: 'a', after: 'b', language: 'typescript' })
    // Diff có hai editor con: mỗi con một host riêng, không dùng chung host của diff.
    expect(fake.diffOptions.at(-1)?.overflowWidgetsDomNode).toBeUndefined()
    const diffHosts = [...diffEl.querySelectorAll<HTMLElement>('.ne-overflow-widgets')]
    expect(diffHosts).toHaveLength(2)
    for (const diffHost of diffHosts) {
      expect(diffHost.parentElement?.className).toBe('monaco-editor')
      expect(diffHost.querySelectorAll('.overflowingContentWidgets')).toHaveLength(1)
      expect(diffHost.querySelectorAll('.overflowingOverlayWidgets')).toHaveLength(1)
    }
    expect(new Set(diffHosts.map((node) => node.parentElement)).size).toBe(2)

    diff.dispose()
    handle.dispose()
    mirror.dispose()
    expect(host.parentElement).toBeNull()
    expect(diffEl.querySelectorAll('.ne-overflow-widgets')).toHaveLength(0)
  })
})

describe('Enter continuations', () => {
  it('keeps comment and Markdown list prefixes on the next line', () => {
    expect(continuationFor('// hello', '\n', 'typescript')).toEqual({ text: '\n// ', replaceLine: false })
    expect(continuationFor('  # hello', '\n', 'python')).toEqual({ text: '\n  # ', replaceLine: false })
    expect(continuationFor('- item', '\n', 'markdown')).toEqual({ text: '\n- ', replaceLine: false })
    expect(continuationFor('* item', '\n', 'markdown')).toEqual({ text: '\n* ', replaceLine: false })
    expect(continuationFor('3. item', '\n', 'markdown')).toEqual({ text: '\n4. ', replaceLine: false })
    expect(continuationFor('const x = 1', '\n', 'typescript')).toBeNull()
  })

  it('removes a marker-only line instead of creating an empty marker', () => {
    expect(continuationFor('  - ', '\n', 'markdown')).toEqual({ text: '', replaceLine: true })
    expect(continuationFor('#', '\n', 'python')).toEqual({ text: '', replaceLine: true })
  })

  it('only continues markers that fit the language', () => {
    expect(continuationFor('#header {', '\n', 'css')).toBeNull()
    expect(continuationFor('#x = 1', '\n', 'typescript')).toBeNull()
    expect(continuationFor('  - ', '\n', 'typescript')).toBeNull()
    expect(continuationFor('// x', '\n', 'typescript')).toEqual({ text: '\n// ', replaceLine: false })
    expect(continuationFor('- item', '\n', 'markdown')).toEqual({ text: '\n- ', replaceLine: false })
    expect(continuationFor('// x', '\n', 'plaintext')).toBeNull()
  })

  it('uses the model language at Enter time, after a status-bar switch', () => {
    const handle = createEditor(el(), opts('a.ts'))
    const editor = fake.editors.at(-1)!
    handle.setValue('- item')
    editor.setPosition({ lineNumber: 1, column: 7 })
    handle.setLanguage?.('markdown')
    editor.fireKey(3)
    expect(editor.executeEdits).toHaveBeenCalledWith('nexgraph.continuation', [{
      range: expect.objectContaining({ startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 7 }),
      text: '\n- ', forceMoveMarkers: true
    }])

    const other = createEditor(el(), opts('b.md', 'markdown'))
    const otherEditor = fake.editors.at(-1)!
    other.setValue('- item')
    otherEditor.setPosition({ lineNumber: 1, column: 7 })
    other.setLanguage?.('typescript')
    otherEditor.fireKey(3)
    expect(otherEditor.executeEdits).not.toHaveBeenCalled()
  })

  it('edits the real model with executeEdits when Enter is pressed on a comment', () => {
    const handle = createEditor(el(), opts('a.ts'))
    const editor = fake.editors.at(-1)!
    handle.setValue('// hello')
    editor.setPosition({ lineNumber: 1, column: 9 })
    editor.fireKey(3)
    expect(editor.executeEdits).toHaveBeenCalledWith('nexgraph.continuation', [{
      range: expect.objectContaining({ startLineNumber: 1, startColumn: 9, endLineNumber: 1, endColumn: 9 }),
      text: '\n// ', forceMoveMarkers: true
    }])
    expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 2, column: 4 })
  })

  it('deletes the whole marker range when Enter is pressed on an empty list item', () => {
    const handle = createEditor(el(), opts('a.md', 'markdown'))
    const editor = fake.editors.at(-1)!
    handle.setValue('  - ')
    editor.setPosition({ lineNumber: 1, column: 5 })
    editor.fireKey(3)
    expect(editor.executeEdits).toHaveBeenCalledWith('nexgraph.continuation', [{
      range: expect.objectContaining({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 5 }),
      text: '', forceMoveMarkers: true
    }])
    expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 1, column: 1 })
  })
})

describe('LSP navigation providers', () => {
  const location = { file: 'src/target.ts', line: 12, column: 3 }
  const api = {
    definition: vi.fn(async () => [location]),
    declaration: vi.fn(async () => [location]),
    typeDefinition: vi.fn(async () => [location])
  }

  it('maps definition, declaration and type-definition responses to Monaco locations', async () => {
    vi.stubGlobal('nexgraph', { lsp: api })
    createEditor(el(), opts('src/a.ts'))
    const model = fake.editors.at(-1)!.getModel()!
    const position = { lineNumber: 4, column: 5 }
    const expected = [{
      uri: expect.objectContaining({ scheme: 'nexgraph', authority: 'p1', path: '/src/target.ts' }),
      range: expect.objectContaining({ startLineNumber: 12, startColumn: 3, endLineNumber: 12, endColumn: 3 })
    }]
    for (const [register, method, apiMethod] of [
      ['registerDefinitionProvider', 'provideDefinition', 'definition'],
      ['registerDeclarationProvider', 'provideDeclaration', 'declaration'],
      ['registerTypeDefinitionProvider', 'provideTypeDefinition', 'typeDefinition']
    ] as const) {
      const provider = fake.providers.find((item) => item.name === register && item.language === 'typescript')!.provider
      expect(await provider[method](model, position)).toEqual(expected)
      expect(api[apiMethod]).toHaveBeenCalledWith('p1', 'src/a.ts', 'disk', 4, 5)
    }
  })
})
