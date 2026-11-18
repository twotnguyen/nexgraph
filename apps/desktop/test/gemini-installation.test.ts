import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { gzipSync } from 'node:zlib'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ANTIGRAVITY_CLI_VERSION,
  ANTIGRAVITY_RELEASES,
  extractAntigravityTarGz,
  getAntigravityRelease,
  GeminiInstallation,
  verifyWindowsSignature,
  windowsSignatureEnvironment
} from '../src/main/gemini/installation'
import { buildGeminiEnvironment, prepareGeminiProfile } from '../src/main/gemini/profile'
const roots: string[] = []
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'nexgraph-google-install-'))
  roots.push(path)
  return path
}
afterEach(async () => {
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true })
})
function tar(name = 'antigravity', type = '0', payload = 'binary'): Buffer {
  const header = Buffer.alloc(512)
  header.write(name)
  header.write('0000600\0', 100)
  header.write(Buffer.byteLength(payload).toString(8).padStart(11, '0') + '\0', 124)
  header.fill(32, 148, 156)
  header.write(type, 156)
  header.write('ustar\0', 257)
  let sum = 0
  for (const value of header) sum += value
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
  const body = Buffer.alloc(Math.ceil(Buffer.byteLength(payload) / 512) * 512)
  body.write(payload)
  return gzipSync(Buffer.concat([header, body, Buffer.alloc(1024)]))
}
describe('native Google Antigravity installation and private configuration', () => {
  it('removes every case variant of inherited PowerShell module paths', () => {
    const env = windowsSignatureEnvironment({
      PSMODULEPATH: 'old-uppercase',
      PSModulePath: 'old-mixed',
      psModulePath: 'old-other',
      SystemRoot: 'C:\\Windows'
    })
    expect(Object.keys(env).filter((key) => key.toUpperCase() === 'PSMODULEPATH')).toEqual([])
    expect(env.SystemRoot).toBe('C:\\Windows')
  })
  it('pins the four official Windows/macOS artifacts and rejects unsupported platforms', () => {
    expect(ANTIGRAVITY_RELEASES).toHaveLength(4)
    for (const release of ANTIGRAVITY_RELEASES) {
      expect(release.sha512).toMatch(/^[0-9a-f]{128}$/)
      expect(release.url).toContain('/1.5.11-6132547114106880/')
    }
    expect(getAntigravityRelease('linux', 'x64')).toBeUndefined()
    expect(getAntigravityRelease('win32', 'ia32')).toBeUndefined()
  })
  it('extracts only one bounded regular binary and rejects traversal/symlinks/corruption', () => {
    expect(extractAntigravityTarGz(tar()).toString()).toBe('binary')
    for (const name of ['../outside', '/outside', 'other'])
      expect(() => extractAntigravityTarGz(tar(name))).toThrow()
    expect(() => extractAntigravityTarGz(tar('antigravity', '2'))).toThrow()
    expect(() => extractAntigravityTarGz(Buffer.from('bad'))).toThrow()
  })
  it('rejects unverified, oversized and cancelled downloads without installing', async () => {
    const fetcher = vi.fn(
      async (_url: Parameters<typeof fetch>[0]) => new Response(new Uint8Array([1, 2, 3]))
    )
    const data = await root()
    const installer = new GeminiInstallation(data, { fetch: fetcher as typeof fetch })
    await expect(installer.setup(new AbortController().signal, vi.fn())).rejects.toThrow('toàn vẹn')
    expect(installer.entry()).toBeNull()
    expect(
      (await readdir(join(data, 'tools', 'antigravity'))).filter((name) => name.startsWith('.install-'))
    ).toEqual([])
    expect(fetcher.mock.calls[0]?.[0]).toBe(getAntigravityRelease()!.url)
    const cancelled = new AbortController()
    cancelled.abort()
    await expect(installer.setup(cancelled.signal, vi.fn())).rejects.toThrow()
    const midStream = new AbortController()
    const interrupted = new GeminiInstallation(data, {
      fetch: vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                midStream.abort()
                controller.enqueue(new Uint8Array([1]))
                controller.close()
              }
            })
          )
      ) as typeof fetch
    })
    await expect(interrupted.setup(midStream.signal, vi.fn())).rejects.toThrow()
    expect(
      (await readdir(join(data, 'tools', 'antigravity'))).filter((name) => name.startsWith('.install-'))
    ).toEqual([])
    const oversized = new GeminiInstallation(await root(), {
      fetch: vi.fn(
        async () => new Response('x', { headers: { 'content-length': String(301 * 1024 * 1024) } })
      ) as typeof fetch
    })
    await expect(oversized.setup(new AbortController().signal, vi.fn())).rejects.toThrow('giới hạn')
  })
  it.skipIf(process.platform !== 'win32' || !process.env.NEXGRAPH_ANTIGRAVITY_TEST_BINARY)(
    'verifies the real Google signature despite an inherited PowerShell module path',
    async () => {
      const prior = process.env.PSModulePath
      try {
        for (const key of Object.keys(process.env))
          if (key.toUpperCase() === 'PSMODULEPATH') delete process.env[key]
        process.env.PSMODULEPATH = prior ?? 'C:\\nexgraph-nonexistent-uppercase-module-path'
        await expect(
          verifyWindowsSignature(process.env.NEXGRAPH_ANTIGRAVITY_TEST_BINARY!)
        ).resolves.toBeUndefined()
        delete process.env.PSMODULEPATH
        process.env.PSModulePath = prior ?? 'C:\\nexgraph-nonexistent-mixedcase-module-path'
        await expect(
          verifyWindowsSignature(process.env.NEXGRAPH_ANTIGRAVITY_TEST_BINARY!)
        ).resolves.toBeUndefined()
      } finally {
        if (prior === undefined) delete process.env.PSModulePath
        else process.env.PSModulePath = prior
      }
    },
    40_000
  )
  it('detects incomplete installations and requires no Node runtime', async () => {
    const installer = new GeminiInstallation(await root())
    await mkdir(installer.directory, { recursive: true })
    await writeFile(
      join(installer.directory, 'install.json'),
      JSON.stringify({ version: ANTIGRAVITY_CLI_VERSION, sha512: installer.release!.sha512 })
    )
    expect(installer.entry()).toBeNull()
    const entry = join(installer.directory, installer.release!.platform === 'win32' ? 'agy.exe' : 'agy')
    await writeFile(entry, 'native')
    expect(installer.command()).toEqual({ executable: entry, args: [] })
    const unsupported = new GeminiInstallation(await root(), { platform: 'linux' })
    expect(unsupported.platformSupported()).toBe(false)
    await expect(unsupported.setup(new AbortController().signal, vi.fn())).rejects.toThrow()
  })
  it('isolates supported configuration paths and exposes only scoped MCP with credits disabled', async () => {
    const data = await root(),
      source = await root(),
      id = randomUUID()
    const profile = await prepareGeminiProfile(data, id, source)
    const again = await prepareGeminiProfile(data, id, source)
    expect(profile.cwd).toBe(again.cwd)
    expect(profile.cwd).not.toBe(source)
    expect(profile.args).toContain('--process-per-session')
    expect(profile.args).toContain('--include-default-customizations=false')
    expect(profile.appDataDir).toBe('antigravity-cli')
    const settings = JSON.parse(await readFile(profile.settings, 'utf8'))
    expect(settings.useG1Credits).toBe(false)
    expect(settings.permissions.deny).toContain('command(*)')
    expect(JSON.parse(await readFile(profile.config, 'utf8')).userSettings.useAiCredits).toBe(false)
    const agent = await readFile(join(profile.cwd, '.agents', 'agents', 'nexgraph.md'), 'utf8')
    expect(agent).toContain('tools: []')
    expect(agent).toContain('inheritCustomizations: false')
    const env = buildGeminiEnvironment(profile, {
      HOME: 'keep-home',
      USERPROFILE: 'keep-user',
      APPDATA: 'global',
      LOCALAPPDATA: 'global',
      GEMINI_API_KEY: 'secret',
      GOOGLE_APPLICATION_CREDENTIALS: 'secret',
      NODE_OPTIONS: '--import evil',
      ANTIGRAVITY_CREDENTIAL_SCOPE: 'invented'
    })
    expect(env.HOME).toBe('keep-home')
    expect(env.USERPROFILE).toBe('keep-user')
    expect(env.APPDATA).toBe(join(profile.home, 'roaming'))
    expect(env.LOCALAPPDATA).toBe(join(profile.home, 'local'))
    expect(env).not.toHaveProperty('GEMINI_API_KEY')
    expect(env).not.toHaveProperty('NODE_OPTIONS')
    expect(env).not.toHaveProperty('ANTIGRAVITY_CREDENTIAL_SCOPE')
    await expect(prepareGeminiProfile(data, '../global', source)).rejects.toThrow()
  })
})
