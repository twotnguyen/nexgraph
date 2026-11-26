import { EventEmitter } from 'node:events'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { LspCallHierarchyItem } from '../src/shared/api'

const mocked = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocked.spawn }))

import { LspManager } from '../src/main/features/lsp/manager'

type Message = { id?: number; method: string; params?: { item?: { uri?: string; data?: unknown }; textDocument?: { version?: number }; capabilities?: { textDocument?: { callHierarchy?: unknown } } } }
const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 8 } }

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

  ready(capabilities: object): void { this.send({ id: this.initializeId, result: { capabilities } }) }
  kill(): boolean { this.exitCode = 0; this.emit('exit'); return true }
}

let root: string
let child: Server
let lsp: LspManager
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ng-lsp-call-hierarchy-'))
  writeFileSync(join(root, 'a.ts'), 'function callee() {}\n')
  child = new Server()
  mocked.spawn.mockReturnValue(child)
  lsp = new LspManager()
})
afterEach(() => { lsp.stopAll(); rmSync(root, { recursive: true, force: true }); mocked.spawn.mockReset() })

it('quảng bá callHierarchy: {} và trả caller khi server bật provider', async () => {
  const uri = pathToFileURL(realpathSync.native(join(root, 'a.ts'))).href
  const item = { name: 'callee', kind: 12, uri, range, selectionRange: range, data: { id: 7 } }
  child.replies.set('textDocument/prepareCallHierarchy', [item])
  child.replies.set('callHierarchy/incomingCalls', [{ from: { ...item, name: 'caller', data: { id: 8 } }, fromRanges: [range] }])
  const opening = lsp.open(root, 'a.ts', 'a')
  child.ready({ callHierarchyProvider: true })
  await opening
  const initialize = child.requests.find((request) => request.method === 'initialize')
  expect(initialize?.params?.capabilities?.textDocument?.callHierarchy).toEqual({})
  const prepared = await lsp.callHierarchyPrepare(root, 'a.ts', 'a', 0, 0)
  expect(prepared?.map((entry) => entry.name)).toEqual(['callee'])
  const incoming = await lsp.callHierarchyIncoming(root, 'a.ts', 'a', 0, 0, prepared![0])
  expect(incoming.map((call) => call.from.name)).toEqual(['caller'])
  expect(child.requests.find((request) => request.method === 'callHierarchy/incomingCalls')?.params?.item?.data).toEqual({ id: 7 })
})

it('prepare/incoming/outgoing map URI dự án và giữ nguyên data', async () => {
  writeFileSync(join(root, 'b.ts'), 'function caller() { callee() }\n')
  const text = 'function callee() {}\n'
  const data = { id: 7, nested: { from: 'server' } }
  const rawItem = (name: string, uri: string, payload: unknown) => ({ name, kind: 12, uri, range, selectionRange: range, detail: 'chi tiết', data: payload })
  const uriA = pathToFileURL(realpathSync.native(join(root, 'a.ts'))).href
  const uriB = pathToFileURL(realpathSync.native(join(root, 'b.ts'))).href
  child.replies.set('textDocument/prepareCallHierarchy', [rawItem('callee', uriA, data)])
  child.replies.set('callHierarchy/incomingCalls', [
    { from: rawItem('caller', uriB, { id: 8 }), fromRanges: [range] },
    { from: rawItem('unsafe', pathToFileURL(join(root, '..', 'outside.ts')).href, { id: 9 }), fromRanges: [range] }
  ])
  child.replies.set('callHierarchy/outgoingCalls', [{ to: rawItem('calleeOut', uriB, data), fromRanges: [range] }])
  const opening = lsp.open(root, 'a.ts', text)
  child.ready({ callHierarchyProvider: true })
  await opening

  expect(await lsp.callHierarchyPrepare(root, 'a.ts', text, -1, 0)).toEqual([])
  const prepared = await lsp.callHierarchyPrepare(root, 'a.ts', text, 0, 1)
  expect(prepared).toEqual([{ name: 'callee', kind: 12, file: 'a.ts', range, selectionRange: range, detail: 'chi tiết', data }])
  const item = prepared![0]
  expect(await lsp.callHierarchyIncoming(root, 'a.ts', text, 0, 1, item)).toEqual([
    { from: { name: 'caller', kind: 12, file: 'b.ts', range, selectionRange: range, detail: 'chi tiết', data: { id: 8 } }, fromRanges: [range] }
  ])
  expect(await lsp.callHierarchyOutgoing(root, 'a.ts', text, 0, 1, item)).toEqual([
    { from: { name: 'calleeOut', kind: 12, file: 'b.ts', range, selectionRange: range, detail: 'chi tiết', data }, fromRanges: [range] }
  ])

  const incoming = child.requests.find((request) => request.method === 'callHierarchy/incomingCalls')?.params?.item
  expect(incoming?.uri).toBe(uriA)
  expect(incoming?.data).toEqual(data)
  expect(incoming).not.toHaveProperty('file')
  expect(child.requests.find((request) => request.method === 'callHierarchy/outgoingCalls')?.params?.item?.uri).toBe(uriA)
})

it('trả kết quả rỗng và không gửi request khi server thiếu callHierarchyProvider', async () => {
  const opening = lsp.open(root, 'a.ts', 'a')
  child.ready({ callHierarchyProvider: false })
  await opening
  const item: LspCallHierarchyItem = { name: 'x', kind: 12, file: 'a.ts', range, selectionRange: range, data: { id: 1 } }

  expect(await lsp.callHierarchyPrepare(root, 'a.ts', 'a', 0, 0)).toEqual([])
  expect(await lsp.callHierarchyIncoming(root, 'a.ts', 'a', 0, 0, item)).toEqual([])
  expect(await lsp.callHierarchyOutgoing(root, 'a.ts', 'a', 0, 0, item)).toEqual([])
  const methods = child.requests.map((request) => request.method)
  expect(methods).not.toContain('textDocument/prepareCallHierarchy')
  expect(methods).not.toContain('callHierarchy/incomingCalls')
  expect(methods).not.toContain('callHierarchy/outgoingCalls')
})
