import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { AcpClient, safeGeminiMessage } from '../src/main/features/agent/gemini/acp-client'

class Child extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdin = new PassThrough()
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  kill = vi.fn(() => {
    this.signalCode = 'SIGTERM'
    queueMicrotask(() => this.emit('exit'))
    return true
  })
  send(value: unknown): void {
    this.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...(value as object) }) + '\n')
  }
}
const fixture = (handlers: ConstructorParameters<typeof AcpClient>[1] = {}) => {
  const child = new Child()
  const client = new AcpClient(child as unknown as ChildProcessWithoutNullStreams, handlers)
  return { child, client }
}

describe('Gemini bounded ACP transport', () => {
  it('assembles split UTF-8 frames and handles interleaved requests and notifications', async () => {
    const update = vi.fn()
    const permission = vi.fn(async () => ({ outcome: { outcome: 'cancelled' } }))
    const { child, client } = fixture({ onNotification: update, onRequest: permission })
    const frames: string[] = []
    child.stdin.on('data', (value) => frames.push(String(value)))
    const reply = client.request<{ text: string }>('session/prompt', {})
    child.send({ id: 'permission', method: 'session/request_permission', params: { sessionId: 'private' } })
    child.send({ method: 'session/update', params: { text: 'đang đọc' } })
    const frame = Buffer.from(
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: { text: 'Tiếng Việt' } }) + '\n'
    )
    const split = frame.indexOf(Buffer.from('ế')) + 1
    child.stdout.write(frame.subarray(0, split))
    child.stdout.write(frame.subarray(split))
    await expect(reply).resolves.toEqual({ text: 'Tiếng Việt' })
    await vi.waitFor(() => expect(permission).toHaveBeenCalledOnce())
    expect(update).toHaveBeenCalledWith('session/update', { text: 'đang đọc' })
    expect(frames.join('')).toContain('cancelled')
    await client.close()
    expect(child.kill).toHaveBeenCalled()
  })
  it('cancels pending requests, ignores late replies and bounds both request directions', async () => {
    const { child, client } = fixture()
    const abort = new AbortController()
    const cancelled = client.request('first', {}, { signal: abort.signal })
    abort.abort()
    await expect(cancelled).rejects.toMatchObject({ code: 'cancelled' })
    child.send({ id: 1, result: 'late' })
    const timed = client.request('second', {}, { timeoutMs: 5 })
    await expect(timed).rejects.toMatchObject({ code: 'timeout' })
    const waiting = Array.from({ length: 64 }, () => client.request('wait', {}).catch((error) => error.code))
    await expect(client.request('overflow', {})).rejects.toMatchObject({ code: 'too_many_requests' })
    await client.close()
    expect(await Promise.all(waiting)).toHaveLength(64)
    const server = fixture({ onRequest: () => new Promise(() => {}) })
    for (let id = 0; id < 65; id++)
      server.child.send({ id: `server-${id}`, method: 'session/request_permission', params: {} })
    expect(server.client.closed()).toBe(true)
    await server.client.close()
  })
  it.each([
    ['malformed JSON', Buffer.from('{no}\n')],
    ['malformed UTF-8', Buffer.from([0xc3, 0x28, 10])],
    ['oversized frame', Buffer.alloc(8 * 1024 * 1024 + 1, 120)],
    ['invalid protocol', Buffer.from('{"jsonrpc":"1.0","id":1,"result":0}\n')]
  ])('closes on %s without hanging outstanding work', async (_name, frame) => {
    const { child, client } = fixture({
      onClose: () => {
        throw new Error('consumer failure')
      }
    })
    const pending = client.request('pending', {}).catch((error) => error.code)
    child.stdout.write(frame)
    expect(await pending).toBeTruthy()
    expect(client.closed()).toBe(true)
    await client.close()
  })
  it('limits duplicate server ids and rejects unsupported methods without leaking errors', async () => {
    const { child, client } = fixture({ onRequest: () => new Promise(() => {}) })
    child.send({ id: 'same', method: 'fs/read_text_file', params: {} })
    child.send({ id: 'same', method: 'fs/read_text_file', params: {} })
    expect(client.closed()).toBe(true)
    await client.close()
    const denied = fixture()
    const sent: string[] = []
    denied.child.stdin.on('data', (data) => sent.push(String(data)))
    denied.child.send({ id: 'fs', method: 'fs/read_text_file', params: { path: 'secret' } })
    await vi.waitFor(() => expect(sent.join('')).toContain('-32000'))
    expect(sent.join('')).not.toContain('secret')
    await denied.client.close()
  })
  it('emits browser authorization ephemerally and sanitizes stderr including its final UTF-8 tail', async () => {
    const stderr = vi.fn()
    const auth = vi.fn()
    const { child, client } = fixture({ onStderr: stderr, onAuthUrl: auth })
    const url =
      'https://accounts.google.com/o/oauth2/v2/auth?state=private-state&code_challenge=private-challenge'
    child.stderr.write(url + '\nrefresh_token=private-refresh Bearer private-bearer\n')
    const tail = Buffer.from('lỗi cuối')
    child.stderr.write(tail.subarray(0, tail.length - 1))
    child.stderr.end(tail.subarray(tail.length - 1))
    await vi.waitFor(() => expect(stderr.mock.calls.flat().join('')).toContain('lỗi cuối'))
    expect(auth).toHaveBeenCalledWith(url)
    expect(stderr.mock.calls.flat().join('')).not.toMatch(
      /private-state|private-challenge|private-refresh|private-bearer/
    )
    const response = client.request('authenticate', {})
    child.send({
      id: 1,
      error: { code: -32000, message: `${url} access_token=private-access code_verifier=private-verifier` }
    })
    await expect(response).rejects.toThrow('[đã ẩn]')
    await client.close()
    expect(safeGeminiMessage('id_token=private-id client_secret=private-client')).not.toContain('private-')
  })
})
