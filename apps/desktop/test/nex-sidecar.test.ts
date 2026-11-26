import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NexSidecar, resolveNexBinary } from '../src/main/agent/nex/sidecar'
import { nexConfig } from '../src/main/agent/nex/config'

const FAKE = `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
const log = process.env.FAKE_NEX_LOG
if (log) appendFileSync(log, 'launch\\n')
if (process.env.FAKE_NEX_DUMP) writeFileSync(process.env.FAKE_NEX_DUMP, JSON.stringify({
  home: process.env.HOME, configDir: process.env.OPENCODE_CONFIG_DIR,
  hasPassword: !!process.env.OPENCODE_SERVER_PASSWORD, leaked: process.env.OPENAI_API_KEY ?? null,
  providerKey: process.env.NEXGRAPH_NEX_PROVIDER_API_KEY ?? null
}))
const mode = process.env.FAKE_NEX_MODE || 'stay'
const server = createServer((req, res) => {
  if (req.url === '/api/info') { res.setHeader('content-type', 'application/json'); res.end('{"ok":true}') }
  else { res.statusCode = 404; res.end('{}') }
})
server.listen(0, '127.0.0.1', () => {
  console.log('server listening on http://127.0.0.1:' + server.address().port)
  if (mode === 'exit') setTimeout(() => process.exit(1), 80)
})
`

function fixture(): { bin: string; dir: string; spawnImpl?: typeof spawn } {
  const dir = mkdtempSync(join(tmpdir(), 'n1a1-sidecar-'))
  const script = join(dir, 'fake-nex.mjs')
  writeFileSync(script, FAKE)
  // Windows không chạy được script có shebang: dùng .cmd gọi node và spawn qua shell.
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

const config = (root: string) => nexConfig({
  root, engine: { command: 'engine', args: [] }, dataDir: join(root, '.nexgraph'),
  provider: { label: 'QA', model: 'gpt-6-luna' }
})

const waitFor = async (predicate: () => boolean, ms = 8000): Promise<void> => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  throw new Error('timeout')
}

describe('NexSidecar', () => {
  it('khởi động server giả qua NEXGRAPH_NEX_OPENCODE_BIN, cô lập HOME, không chuyển key lạ sang tiến trình con', async () => {
    const { bin, dir, spawnImpl } = fixture()
    const root = mkdtempSync(join(tmpdir(), 'n1a1-project-'))
    const dump = join(dir, 'env.json')
    const sidecar = new NexSidecar({
      bin, dataDir: join(dir, 'nex'), projectKey: 'p1', cwd: root, config: () => config(root),
      spawnImpl,
      env: { FAKE_NEX_DUMP: dump, NEXGRAPH_NEX_PROVIDER_API_KEY: 'sk-provider-sentinel' },
      envSource: { ...process.env, OPENAI_API_KEY: 'sk-parent-must-not-leak' }
    })
    const ready = await sidecar.start()
    expect(ready.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(sidecar.isRunning).toBe(true)
    const env = JSON.parse(readFileSync(dump, 'utf8')) as Record<string, unknown>
    expect(String(env.home)).toContain(join('nex', 'p1', 'home'))
    expect(String(env.configDir)).toContain(join('.config', 'opencode'))
    expect(env.hasPassword).toBe(true)
    expect(env.leaked).toBeNull()
    expect(env.providerKey).toBe('sk-provider-sentinel')
    // Cấu hình trên đĩa đúng v2 và không chứa key provider.
    const written = JSON.parse(readFileSync(join(dir, 'nex', 'p1', 'home', '.config', 'opencode', 'opencode.json'), 'utf8')) as Record<string, unknown>
    expect(written).toHaveProperty('mcp.servers.nexgraph')
    expect(JSON.stringify(written)).not.toContain('sk-provider-sentinel')
    await sidecar.stop()
    expect(existsSync(dump)).toBe(true)
    expect(sidecar.status).toBe('stopped')
  }, 30_000)

  it('khởi động lại có giới hạn khi tiến trình chết liên tục', async () => {
    const { bin, dir, spawnImpl } = fixture()
    const root = mkdtempSync(join(tmpdir(), 'n1a1-project-'))
    const log = join(dir, 'launches.txt')
    const sidecar = new NexSidecar({
      bin, dataDir: join(dir, 'nex'), projectKey: 'p2', cwd: root, config: () => config(root),
      spawnImpl, env: { FAKE_NEX_MODE: 'exit', FAKE_NEX_LOG: log }, maxRestarts: 2
    })
    await sidecar.start()
    await waitFor(() => sidecar.status === 'failed')
    const launches = readFileSync(log, 'utf8').trim().split('\n').length
    expect(launches).toBe(3) // lần đầu + 2 lần khởi động lại, không lặp vô hạn
    await sidecar.stop()
  }, 30_000)

  it('tìm binary theo thứ tự env → bản đóng gói → ~/.opencode', () => {
    // join() theo hệ đang chạy: Windows dùng dấu \ nên không so chuỗi posix cứng.
    const packaged = join('/res', 'opencode', 'opencode')
    const dev = join('/home', '.opencode', 'bin', 'opencode')
    const exists = (path: string) => path === '/env/opencode' || path === packaged || path === dev
    expect(resolveNexBinary({ env: { NEX_OPENCODE_BIN: '/env/opencode' }, isPackaged: true, resourcesPath: '/res', home: '/home', platform: 'darwin', exists })).toBe('/env/opencode')
    expect(resolveNexBinary({ env: {}, isPackaged: true, resourcesPath: '/res', home: '/home', platform: 'darwin', exists })).toBe(packaged)
    expect(resolveNexBinary({ env: {}, isPackaged: false, home: '/home', platform: 'linux', exists: (path) => path === dev })).toBe(dev)
    expect(resolveNexBinary({ env: {}, isPackaged: false, home: '/home', platform: 'win32', exists: (path) => path.endsWith('opencode.exe') })).toBe(join('/home', '.opencode', 'bin', 'opencode.exe'))
    expect(resolveNexBinary({ env: {}, isPackaged: false, home: '/nope', exists: () => false })).toBeNull()
  })
})
