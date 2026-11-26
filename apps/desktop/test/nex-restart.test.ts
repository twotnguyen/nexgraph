import { spawn } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ProviderFailure } from '../src/main/features/agent/session'
import { NexClient } from '../src/main/features/agent/nex/client'
import { nexConfig } from '../src/main/features/agent/nex/config'
import { NexSession } from '../src/main/features/agent/nex/session'
import { NexSidecar } from '../src/main/features/agent/nex/sidecar'

const FAKE = `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
if (process.env.FAKE_NEX_PID) writeFileSync(process.env.FAKE_NEX_PID, String(process.pid))
if (process.env.FAKE_NEX_LOG) appendFileSync(process.env.FAKE_NEX_LOG, process.pid + '\\n')
const clients = new Set()
const broadcast = (event) => { for (const res of clients) res.write('data: ' + JSON.stringify(event) + '\\n\\n') }
const json = (res, body) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)) }
const server = createServer((req, res) => {
  const url = (req.url || '').split('?')[0]
  if (url === '/api/info') return json(res, { ok: true })
  if (url === '/api/event') {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(': hi\\n\\n'); clients.add(res); req.on('close', () => clients.delete(res)); return
  }
  if (req.method === 'POST' && url === '/api/session') return json(res, { data: { id: 'ses_local' } })
  if (req.method === 'POST' && url.endsWith('/prompt')) {
    json(res, { data: {} })
    setTimeout(() => {
      broadcast({ type: 'session.text.delta', data: { sessionID: 'ses_local', delta: 'Xin chào từ tiến trình mới' } })
      broadcast({ type: 'session.execution.succeeded', data: { sessionID: 'ses_local' } })
    }, Number(process.env.FAKE_NEX_REPLY_MS || 600))
    return
  }
  if (req.method === 'POST' && (url.endsWith('/interrupt') || url.includes('/permission/'))) { res.statusCode = 204; res.end(); return }
  res.statusCode = 404; res.end('{}')
})
server.listen(0, '127.0.0.1', () => console.log('server listening on http://127.0.0.1:' + server.address().port))
`

function fixture(): { bin: string; dir: string; spawnImpl?: typeof spawn } {
  const dir = mkdtempSync(join(tmpdir(), 'n1a1-restart-'))
  const script = join(dir, 'fake-nex.mjs')
  writeFileSync(script, FAKE)
  if (process.platform === 'win32') {
    const cmd = join(dir, 'fake-nex.cmd')
    writeFileSync(cmd, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`)
    return { bin: cmd, dir, spawnImpl: ((file: string, args: string[], opts: object) => spawn(file, args, { ...opts, shell: true })) as typeof spawn }
  }
  const bin = join(dir, 'fake-nex')
  writeFileSync(bin, FAKE)
  chmodSync(bin, 0o755)
  return { bin, dir }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const waitFor = async (predicate: () => boolean, ms = 8000): Promise<void> => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (predicate()) return
    await sleep(30)
  }
  throw new Error('timeout')
}

describe('NexSession sống qua sidecar restart', () => {
  it('lượt đang chạy kết thúc bằng lỗi rõ ràng; lượt sau nối lại URL/mật khẩu mới và có text/done', async () => {
    const { bin, dir, spawnImpl } = fixture()
    const root = mkdtempSync(join(tmpdir(), 'n1a1-restart-project-'))
    const pidFile = join(dir, 'pid.txt')
    const sidecar = new NexSidecar({
      bin, dataDir: join(dir, 'nex'), projectKey: 'p1', cwd: root,
      config: () => nexConfig({ root, engine: { command: 'engine', args: [] }, dataDir: join(root, '.nexgraph'), provider: { label: 'QA', model: 'gpt' } }),
      spawnImpl, startupTimeoutMs: 8_000, maxRestarts: 2,
      env: { FAKE_NEX_PID: pidFile, FAKE_NEX_REPLY_MS: '600' }
    })
    await sidecar.start()
    const firstUrl = sidecar.url
    const client = new NexClient({ baseUrl: () => sidecar.url, secret: () => sidecar.secret, reconnectDelayMs: 80 })
    const failures: ProviderFailure[] = []
    const session = new NexSession({
      root, client, model: { provider: 'qa', id: 'gpt' },
      watchSidecar: (listener) => sidecar.onUnexpectedExit(listener),
      onProviderFailure: (failure) => failures.push(failure)
    })
    const events: Record<string, unknown>[] = []
    session.subscribe((event) => events.push(event))

    await session.prompt('lượt 1')
    expect(events.some((event) => event.type === 'message_update')).toBe(true)
    expect(session.messages.at(-1)).toMatchObject({ role: 'assistant', stopReason: 'stop' })

    await sleep(200)
    const pid = Number(readFileSync(pidFile, 'utf8'))
    const interrupted = session.prompt('lượt đang chạy dở')
    await sleep(150)
    process.kill(pid, 'SIGKILL')
    await expect(interrupted).rejects.toThrow('khởi động lại')
    expect(failures.at(-1)?.code).toBe('ai_runtime_restarted')

    await waitFor(() => sidecar.isRunning && sidecar.url !== '' && sidecar.url !== firstUrl, 10_000)
    await sleep(1_500) // SSE nối lại cổng mới

    events.length = 0
    await session.prompt('lượt 2')
    const deltas = events.filter((event) => event.type === 'message_update').map((event) => (event.assistantMessageEvent as { delta: string }).delta)
    expect(deltas.join('')).toContain('Xin chào')
    expect(session.messages.at(-1)).toMatchObject({ role: 'assistant', stopReason: 'stop' })
    await sidecar.stop()
  }, 45_000)
})
