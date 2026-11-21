import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { normalizeDiagnostics, normalizeSignatureHelp, normalizeWorkspaceEdit, projectFile } from '../src/main/lsp/protocol'

let base: string
let root: string
let uri: string
const range = { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } }

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'ng-lsp-protocol-'))
  root = join(base, 'project')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'one file.ts'), 'hello')
  writeFileSync(join(base, 'outside.ts'), 'private')
  symlinkSync(join(base, 'outside.ts'), join(root, 'src', 'escape.ts'))
  uri = pathToFileURL(join(root, 'src', 'one file.ts')).href
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

describe('language server URI boundaries', () => {
  it('decodes local project URIs while rejecting outside, protected, malformed and symlink escapes', () => {
    expect(projectFile(root, uri)).toBe('src/one file.ts')
    expect(projectFile(root, pathToFileURL(join(base, 'outside.ts')).href)).toBeNull()
    expect(projectFile(root, pathToFileURL(join(root, 'src', 'escape.ts')).href)).toBeNull()
    expect(projectFile(root, pathToFileURL(join(root, '.env')).href)).toBeNull()
    expect(projectFile(root, 'https://example.com/file.ts')).toBeNull()
    expect(projectFile(root, 'file://remote.example/path')).toBeNull()
    expect(projectFile(root, 'file:///%ZZ')).toBeNull()
  })
})

describe('workspace edit normalization', () => {
  it('retains all edits and exact 0-based ranges across changes and documentChanges for the same file', () => {
    const second = { start: { line: 2, character: 0 }, end: { line: 2, character: 3 } }
    expect(normalizeWorkspaceEdit(root, {
      changes: { [uri]: [{ range, newText: 'first' }] },
      documentChanges: [{ textDocument: { uri, version: 3 }, edits: [{ range: second, newText: 'second' }] }]
    }, () => 3)).toEqual({ 'src/one file.ts': [{ range, newText: 'first' }, { range: second, newText: 'second' }] })
  })

  it('rejects resource operations, unsafe targets, invalid edits and stale document versions', () => {
    expect(() => normalizeWorkspaceEdit(root, { documentChanges: [{ kind: 'rename', oldUri: uri, newUri: uri }] })).toThrow()
    expect(() => normalizeWorkspaceEdit(root, { changes: { [pathToFileURL(join(root, 'src', 'escape.ts')).href]: [{ range, newText: 'x' }] } })).toThrow()
    expect(() => normalizeWorkspaceEdit(root, { changes: { [uri]: [{ range, insertText: 'snippet' }] } })).toThrow()
    expect(() => normalizeWorkspaceEdit(root, { documentChanges: [{ textDocument: { uri, version: 2 }, edits: [{ range, newText: 'x' }] }] }, () => 3)).toThrow()
    expect(() => normalizeWorkspaceEdit(root, { changes: { [uri]: [{ range: { start: { line: -1, character: 0 }, end: { line: 0, character: 0 } }, newText: 'x' }] } })).toThrow()
  })
})

describe('diagnostics normalization', () => {
  it('retains supported fields and 0-based ranges, including empty clears and document versions', () => {
    expect(normalizeDiagnostics(root, { uri, version: 4, diagnostics: [{ range, severity: 2, message: 'warning', source: 'ts', code: 123, tags: [1, 2] }] })).toEqual({
      file: 'src/one file.ts', version: 4,
      diagnostics: [{ range, severity: 2, message: 'warning', source: 'ts', code: 123, tags: [1, 2] }]
    })
    expect(normalizeDiagnostics(root, { uri, diagnostics: [] })).toEqual({ file: 'src/one file.ts', diagnostics: [] })
  })

  it('ignores unsafe notification URIs and malformed diagnostics without accepting an invalid clear', () => {
    expect(normalizeDiagnostics(root, { uri: pathToFileURL(join(root, 'src', 'escape.ts')).href, diagnostics: [] })).toBeNull()
    expect(normalizeDiagnostics(root, { uri, diagnostics: 'invalid' })).toBeNull()
    expect(normalizeDiagnostics(root, { uri, diagnostics: [{ range: null, message: 'bad' }] })).toBeNull()
  })
})

it('retains signature documentation, UTF-16 parameter offsets, and active indexes', () => {
  expect(normalizeSignatureHelp({
    signatures: [{ label: 'f(a: string)', documentation: { kind: 'markdown', value: '**f**' }, parameters: [{ label: [2, 3], documentation: 'argument' }], activeParameter: 0 }],
    activeSignature: 0, activeParameter: 0
  })).toEqual({
    signatures: [{ label: 'f(a: string)', documentation: { kind: 'markdown', value: '**f**' }, parameters: [{ label: [2, 3], documentation: 'argument' }], activeParameter: 0 }],
    activeSignature: 0, activeParameter: 0
  })
  expect(normalizeSignatureHelp({ signatures: [{ label: 'f', parameters: [{ label: [3, 1] }] }] })).toBeNull()
})
