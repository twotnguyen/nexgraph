import { spawn } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SessionSpec } from '../src/main/agent/session'
import { nexConfig } from '../src/main/agent/nex/config'
import { createNexSession } from '../src/main/agent/nex/runtime'
import { NexSidecar } from '../src/main/agent/nex/sidecar'

// Binary sống nhưng không bao giờ báo ready — ca timeout của review #66 Important 3.
const HANG = `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
if (process.env.FAKE_NEX_PID) writeFileSync(process.env.FAKE_NEX_PID, String(process.pid))
setInterval(() => {}, 1000)
`

function fixture(): { bin: string; dir: string; spawnImpl?: typeof spawn } {
  const dir = mkdtempSync(join(tmpdir(), 'n1a1-hang-'))
  const script = join(dir, 'hang-nex.mjs')
  writeFileSync(script, HANG)
  if (process.platform === 'win32') {
    const cmd = join(dir, 'hang-nex.cmd')
    writeFileSync(cmd, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`)
    return { bin: cmd, dir, spawnImpl: ((file: string, args: string[], opts: object) => spawn(file, args, { ...opts, shell: true })) as typeof spawn }
  }
  const bin = join(dir, 'hang-nex')
  writeFileSync(bin, HANG)
  chmodSync(bin, 0o755)
  return { bin, dir }
}

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true } catch { return false }
}
const waitGone = async (pid: number, ms = 8_000): Promise<void> => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (!alive(pid)) return
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  throw new Error(`tiến trình ${pid} vẫn sống`)
}

const configFor = (root: string) => nexConfig({ root, engine: { command: 'engine', args: [] }, dataDir: join(root, '.nexgraph'), provider: { label: 'QA', model: 'gpt' } })

describe('NexSidecar dọn tiến trình khi khởi động lỗi', () => {
  it('binary sống mà không ready: start reject và child bị kill, không còn tiến trình', async () => {
    const { bin, dir, spawnImpl } = fixture()
    const root = mkdtempSync(join(tmpdir(), 'n1a1-hang-project-'))
    const pidFile = join(dir, 'pid.txt')
    const sidecar = new NexSidecar({
      bin, dataDir: join(dir, 'nex'), projectKey: 'p1', cwd: root, config: () => configFor(root),
      spawnImpl, startupTimeoutMs: 1_500, env: { FAKE_NEX_PID: pidFile }
    })
    await expect(sidecar.start()).rejects.toThrow('Hết thời gian chờ')
    const pid = Number(readFileSync(pidFile, 'utf8'))
    expect(pid).toBeGreaterThan(0)
    await waitGone(pid)
    expect(sidecar.status).toBe('failed')
  }, 30_000)

  it('spawn lỗi (binary không tồn tại) reject nhanh và không treo tới hạn', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'n1a1-hang-'))
    const root = mkdtempSync(join(tmpdir(), 'n1a1-hang-project-'))
    const sidecar = new NexSidecar({
      bin: join(dir, 'missing-nex'), dataDir: join(dir, 'nex'), projectKey: 'p2', cwd: root,
      config: () => configFor(root), startupTimeoutMs: 5_000
    })
    const started = Date.now()
    await expect(sidecar.start()).rejects.toThrow('Không chạy được tiến trình Nex')
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(sidecar.status).toBe('failed')
  }, 30_000)

  it('createNexSession dọn sidecar khi start lỗi', async () => {
    const { bin, dir, spawnImpl } = fixture()
    const root = mkdtempSync(join(tmpdir(), 'n1a1-hang-project-'))
    const pidFile = join(dir, 'pid.txt')
    const spec = { cwd: root, model: { provider: 'qa', id: 'gpt' }, projectId: 'p3' } as unknown as SessionSpec
    let failure: Error | null = null
    try {
      await createNexSession(spec, {
        dataDir: dir, isPackaged: false, resourcesPath: '', binPath: bin, startupTimeoutMs: 1_000,
        engineCommand: () => ({ command: 'engine', args: [] }),
        getProvider: async () => ({ id: 'qa', label: 'QA', baseUrl: 'https://ai.test/v1', apiKey: 'unused', model: 'gpt' }),
        env: { FAKE_NEX_PID: pidFile }
      })
    } catch (error) { failure = error as Error }
    expect(failure?.message).toContain('Hết thời gian chờ')
    const pid = Number(readFileSync(pidFile, 'utf8'))
    await waitGone(pid)
  }, 30_000)
})
