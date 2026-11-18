import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { getHealth } from '../src/main/engine/client'
import { EngineStartError, startEngine, type EngineCommand } from '../src/main/engine/launcher'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: vi.fn(actual.spawn) }
})

const tmp = () => mkdtempSync(join(tmpdir(), 'ng-'))
const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const fake = (): EngineCommand => ({
  command: process.execPath,
  args: [fileURLToPath(new URL('./fixtures/fake-engine.mjs', import.meta.url))]
})
const run = (mode: string, extra: Partial<Parameters<typeof startEngine>[1]> = {}) =>
  startEngine(fake(), { dataDir: tmp(), env: { ...process.env, FAKE_MODE: mode }, ...extra })
const authedHealth = async (h: { baseUrl: string; token: string }) =>
  (await (await fetch(`${h.baseUrl}/v1/health`, { headers: { Authorization: `Bearer ${h.token}` } })).json()) as {
    argv: string[]
  }

describe('startEngine', () => {
  it('resolves with baseUrl and authorised health', async () => {
    const h = await run('ok')
    try {
      expect(h.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
      expect(h.token).toMatch(/^[0-9a-f]{64}$/)
      expect((await getHealth(h)).status).toBe('ok')
    } finally {
      await h.stop()
    }
  })

  it('never puts the token in argv', async () => {
    const h = await run('ok')
    try {
      expect(JSON.stringify((await authedHealth(h)).argv)).not.toContain(h.token)
    } finally {
      await h.stop()
    }
  })

  it('ignores noise before ready', async () => {
    const h = await run('ok')
    await h.stop()
  })

  it('passes unicode data dir intact', async () => {
    const dir = join(tmp(), 'Đồ án ứng dụng', 'dữ liệu')
    const h = await run('ok', { dataDir: dir })
    try {
      expect((await authedHealth(h)).argv).toEqual(expect.arrayContaining(['serve', '--data-dir', dir, '--port', '0']))
    } finally {
      await h.stop()
    }
  })

  it('kills process on ready timeout', async () => {
    const err = await run('never-ready', { readyTimeoutMs: 300 }).catch((e) => e)
    expect(err).toBeInstanceOf(EngineStartError)
    expect(isAlive(err.pid)).toBe(false)
  })

  it('rejects with stderr tail when exiting before ready', async () => {
    const err = await run('crash-before-ready').catch((e) => e)
    expect(err).toBeInstanceOf(EngineStartError)
    expect(err.stderrTail).toContain('boom')
  })

  it('reports a failed spawn without waiting for an exit event', async () => {
    const dataDir = tmp()
    const command = join(dataDir, 'missing-engine')
    await expect(startEngine({ command, args: [] }, { dataDir })).rejects.toMatchObject({
      name: 'EngineStartError', pid: -1, message: expect.stringContaining('ENOENT')
    })
  }, 2000)

  it('reports exit after ready', async () => {
    const h = await run('crash-after-ready')
    const code = await new Promise((resolve) => h.onExit((c) => resolve(c)))
    expect(code).toBe(5)
  })

  it('stop terminates process', async () => {
    const h = await run('ok')
    await h.stop()
    expect(isAlive(h.pid)).toBe(false)
  })

  it.skipIf(process.platform !== 'win32')('stop closes engine stdin when Windows denies taskkill', async () => {
    const h = await run('ok')
    const denied = new EventEmitter() as ChildProcess
    vi.mocked(spawn).mockImplementationOnce(() => {
      queueMicrotask(() => denied.emit('exit', 1))
      return denied
    })
    await h.stop()
    expect(spawn).toHaveBeenLastCalledWith('taskkill', ['/pid', String(h.pid), '/T', '/F'], expect.anything())
    expect(isAlive(h.pid)).toBe(false)
  })

  it.skipIf(process.platform !== 'win32').each([0, 300])('stop waits for worker closure and taskkill completion delayed by %i ms', async (helperDelay) => {
    const h = await startEngine({
      command: process.execPath,
      args: [fileURLToPath(new URL('./fixtures/wrapper-engine.mjs', import.meta.url))]
    }, { dataDir: tmp() })
    const wrapper = vi.mocked(spawn).mock.results.at(-1)!.value as ChildProcess
    const wrapperClosed = new Promise<void>((resolve) => wrapper.once('close', () => resolve()))
    const helper = new EventEmitter() as ChildProcess
    let treeStopped = false
    const helperDone = new Promise<void>((resolve) => {
      vi.mocked(spawn).mockImplementationOnce(() => {
        wrapper.stdin!.end()
        setTimeout(() => {
          treeStopped = true
          helper.emit('exit', 0)
          helper.emit('close', 0)
          resolve()
        }, helperDelay)
        return helper
      })
    })
    try {
      const stopping = h.stop()
      expect(h.stop()).toBe(stopping)
      await stopping
      expect(treeStopped).toBe(true)
      const address = new URL(h.baseUrl)
      const connection = await new Promise<string>((resolve) => {
        const socket = createConnection({ host: address.hostname, port: Number(address.port) })
        socket.once('connect', () => { socket.destroy(); resolve('connected') })
        socket.once('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? 'error'))
      })
      expect(connection).toBe('ECONNREFUSED')
    } finally {
      await Promise.all([helperDone, wrapperClosed])
    }
  })
})
