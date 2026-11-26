import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import type { SessionSpec } from '../src/main/features/agent/session'
import { nexConfig } from '../src/main/features/agent/nex/config'
import { createNexSession } from '../src/main/features/agent/nex/runtime'
import { NexSidecar } from '../src/main/features/agent/nex/sidecar'

// Nex gọi `<bin> serve …` trong cwd. Với Node thật, `serve` là tệp script, không cần shell.
const SERVER_WITH_WORKER = `
if (process.argv[2] === 'worker') {
  process.on('SIGTERM', () => {})
  require('node:fs').writeFileSync('pids.json', JSON.stringify([process.ppid, process.pid]))
  if (process.env.FAKE_NEX_READY === '1') {
    const server = require('node:http').createServer((_req, res) => res.end('{}'))
    server.listen(0, '127.0.0.1', () => console.log('server listening on http://127.0.0.1:' + server.address().port))
  }
} else {
  require('node:child_process').spawn(process.execPath, [__filename, 'worker'], { stdio: ['ignore', 'inherit', 'ignore'], windowsHide: true })
}
setInterval(() => {}, 1000)
`

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'n1a1-hang-'))
  const root = mkdtempSync(join(dir, 'project '))
  writeFileSync(join(root, 'serve'), SERVER_WITH_WORKER)
  const pidFile = join(root, 'pids.json')
  const pids = (): [number, number] => JSON.parse(readFileSync(pidFile, 'utf8'))
  onTestFinished(async () => {
    // Chỉ dọn sau assertion, kể cả khi mã cũ để lại tiến trình trong lần chạy đỏ.
    if (existsSync(pidFile)) {
      for (const pid of pids()) {
        if (Number.isSafeInteger(pid) && pid > 0 && alive(pid)) {
          process.kill(pid, 'SIGKILL')
          await waitGone(pid)
        }
      }
    }
    rmSync(dir, { recursive: true, force: true })
  })
  return { dir, root, pids }
}

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}
const waitGone = async (pid: number, ms = 8_000): Promise<void> => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (!alive(pid)) return
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  throw new Error(`tiến trình ${pid} vẫn sống`)
}

async function expectTreeGone([parent, worker]: [number, number]): Promise<void> {
  expect(parent).toBeGreaterThan(0)
  expect(worker).toBeGreaterThan(0)
  expect(worker).not.toBe(parent)
  expect(alive(parent), `sidecar ${parent} vẫn sống`).toBe(false)
  await waitGone(worker)
}

const configFor = (root: string) => nexConfig({ root, engine: { command: 'engine', args: [] }, dataDir: join(root, '.nexgraph'), provider: { label: 'QA', model: 'gpt' } })

describe('NexSidecar dọn cây tiến trình', () => {
  it('binary sống mà không ready: start reject và child bị kill, không còn tiến trình', async () => {
    const { dir, root, pids } = fixture()
    const sidecar = new NexSidecar({
      bin: process.execPath, dataDir: join(dir, 'nex'), projectKey: 'p1', cwd: root, config: () => configFor(root),
      startupTimeoutMs: 1_500
    })
    await expect(sidecar.start()).rejects.toThrow('Hết thời gian chờ')
    await expectTreeGone(pids())
    expect(sidecar.status).toBe('failed')
  }, 30_000)

  it('stop sau khi ready dọn cả sidecar lẫn worker', async () => {
    const { dir, root, pids } = fixture()
    const sidecar = new NexSidecar({
      bin: process.execPath, dataDir: join(dir, 'nex'), projectKey: 'p1', cwd: root, config: () => configFor(root),
      env: { FAKE_NEX_READY: '1' }
    })
    await sidecar.start()
    await sidecar.stop()
    await expectTreeGone(pids())
    expect(sidecar.status).toBe('stopped')
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
    const { dir, root, pids } = fixture()
    const spec = { cwd: root, model: { provider: 'qa', id: 'gpt' }, projectId: 'p3' } as unknown as SessionSpec
    await expect(createNexSession(spec, {
      dataDir: dir, isPackaged: false, resourcesPath: '', binPath: process.execPath, startupTimeoutMs: 1_000,
      engineCommand: () => ({ command: 'engine', args: [] }),
      getProvider: async () => ({ id: 'qa', label: 'QA', baseUrl: 'https://ai.test/v1', apiKey: 'unused', model: 'gpt' })
    })).rejects.toThrow('Hết thời gian chờ')
    await expectTreeGone(pids())
  }, 30_000)
})
