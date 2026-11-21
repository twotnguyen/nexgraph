import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocked.spawn }))

import { LspManager } from '../src/main/lsp/manager'
type Message = { id?: number; method: string; params: { textDocument?: { version?: number } } }

class Server extends EventEmitter {
  stdout = new PassThrough()
  stdin = new PassThrough()
  exitCode: number | null = null
  requests: Message[] = []
  replies = new Map<string, unknown>()
  initializeId = 0
  private buffer = Buffer.alloc(0)

  constructor() {
    super()
    this.stdin.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk])
      for (;;) {
        const end = this.buffer.indexOf('\r\n\r\n')
        if (end < 0) return
        const length = Number(/Content-Length: (\d+)/i.exec(this.buffer.subarray(0, end).toString())?.[1])
        if (this.buffer.length < end + 4 + length) return
        const message = JSON.parse(this.buffer.subarray(end + 4, end + 4 + length).toString()) as Message
        this.buffer = this.buffer.subarray(end + 4 + length)
        this.requests.push(message)
        if (message.method === 'initialize') this.initializeId = message.id!
        else if (message.id !== undefined) this.send({ id: message.id, result: this.replies.get(message.method) ?? null })
      }
    })
  }

  send(message: object): void {
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }))
    this.stdout.write(`Content-Length: ${body.length}\r\n\r\n`)
    this.stdout.write(body)
  }

  ready(capabilities: object = {}): void { this.send({ id: this.initializeId, result: { capabilities } }) }
  kill(): boolean { this.exitCode = 0; this.emit('exit'); return true }
}

let root: string
let child: Server
let lsp: LspManager
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ng-lsp-bridge-'))
  writeFileSync(join(root, 'a.ts'), 'let a = 1')
  child = new Server()
  mocked.spawn.mockReturnValue(child)
  lsp = new LspManager()
})
afterEach(() => { lsp.stopAll(); rmSync(root, { recursive: true, force: true }); mocked.spawn.mockReset() })

it('cancels an open waiting for initialize and rejects diagnostics from a previous open version', async () => {
  const events: { file: string; diagnostics: unknown[] }[] = []
  lsp.onDiagnostics = (_root, file, diagnostics) => events.push({ file, diagnostics })
  const opening = lsp.open(root, 'a.ts', 'first')
  lsp.close(root, 'a.ts')
  child.ready()
  await opening
  expect(child.requests.filter((request) => request.method === 'textDocument/didOpen')).toHaveLength(0)

  await lsp.open(root, 'a.ts', 'first')
  lsp.close(root, 'a.ts')
  await lsp.open(root, 'a.ts', 'second')
  const opens = child.requests.filter((request) => request.method === 'textDocument/didOpen')
  expect(opens.map((request) => request.params.textDocument?.version)).toEqual([1, 2])
  const uri = pathToFileURL(join(root, 'a.ts')).href
  const diagnostic = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'error' }
  child.send({ method: 'textDocument/publishDiagnostics', params: { uri, version: 1, diagnostics: [diagnostic] } })
  expect(events).toEqual([{ file: 'a.ts', diagnostics: [] }])
  child.send({ method: 'textDocument/publishDiagnostics', params: { uri, version: 2, diagnostics: [diagnostic] } })
  expect(events).toEqual([{ file: 'a.ts', diagnostics: [] }, { file: 'a.ts', diagnostics: [diagnostic] }])
  child.kill()
  expect(events.at(-1)).toEqual({ file: 'a.ts', diagnostics: [] })
})

it('routes server requests with current text and returns safe locations, edits, and workspace symbols', async () => {
  const uri = pathToFileURL(join(root, 'a.ts')).href
  const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }
  child.replies.set('textDocument/references', [{ uri, range }, { uri: 'file:///outside.ts', range }])
  child.replies.set('textDocument/rename', { documentChanges: [{ textDocument: { uri, version: 2 }, edits: [{ range, newText: 'renamed' }] }] })
  child.replies.set('workspace/symbol', [{ name: 'a', kind: 13, location: { uri, range } }, { name: 'unsafe', kind: 13, location: { uri: 'file:///outside.ts', range } }])
  const opening = lsp.open(root, 'a.ts', 'first')
  child.ready()
  await opening
  expect(await lsp.references(root, 'a.ts', 'updated', 0, 1)).toEqual([{ file: 'a.ts', line: 1, column: 1 }])
  expect(await lsp.rename(root, 'a.ts', 'updated', 0, 1, 'renamed')).toEqual({ 'a.ts': [{ range, newText: 'renamed' }] })
  expect(await lsp.workspaceSymbols(root, 'a')).toEqual([{ name: 'a', kind: 13, file: 'a.ts', range }])
})

it('resolves deferred code actions and exposes only actionable edits', async () => {
  const uri = pathToFileURL(join(root, 'a.ts')).href
  const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }
  child.replies.set('textDocument/codeAction', [{ title: 'Fix', kind: 'quickfix', data: { id: 1 } }, { title: 'Command only', command: 'x' }])
  child.replies.set('codeAction/resolve', { title: 'Fix', kind: 'quickfix', edit: { changes: { [uri]: [{ range, newText: 'x' }] } } })
  const opening = lsp.open(root, 'a.ts', 'a')
  child.ready({ codeActionProvider: { resolveProvider: true } })
  await opening
  expect(await lsp.codeActions(root, 'a.ts', 'a', range)).toEqual([{ title: 'Fix', kind: 'quickfix', edit: { 'a.ts': [{ range, newText: 'x' }] } }])
})
