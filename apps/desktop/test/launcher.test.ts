import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { getHealth } from '../src/main/engine/client'
import { EngineStartError, startEngine, type EngineCommand } from '../src/main/engine/launcher'

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
})
