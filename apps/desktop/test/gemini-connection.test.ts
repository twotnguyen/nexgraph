import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GeminiConnectionManager } from '../src/main/gemini/connection'
const roots: string[] = [],
  managers: GeminiConnectionManager[] = []
const fixtureFile = fileURLToPath(new URL('./fixtures/gemini-acp.mjs', import.meta.url))
const command = { executable: process.execPath, args: [fixtureFile] }
async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'nexgraph-antigravity-connection-'))
  roots.push(dataDir)
  const notify = vi.fn()
  const manager = new GeminiConnectionManager({ dataDir, command, notify })
  managers.push(manager)
  return { dataDir, notify, manager }
}
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown()))
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true })
})
const models = (current = 'gemini-3-pro') => ({
  configOptions: [
    {
      id: 'model',
      category: 'model',
      type: 'select',
      currentValue: current,
      options: [
        { value: 'gemini-3-pro', name: 'Gemini 3 Pro' },
        { value: 'gemini-3-flash', name: 'Gemini 3 Flash' }
      ]
    }
  ]
})
describe('official Google connection lifecycle', () => {
  it('discovers actual model choices, configures model by advertised configId and closes native sessions', async () => {
    const { manager, dataDir, notify } = await fixture(),
      old = manager.connectionIdentity()
    expect((await manager.login()).authenticated).toBe(true)
    expect(manager.connectionIdentity()).not.toBe(old)
    expect(notify.mock.calls.some(([event]) => event.type === 'auth_url')).toBe(true)
    expect((await manager.models()).map((model) => model.id)).toEqual(['gemini-3-pro', 'gemini-3-flash'])
    await manager.selectModel('gemini-3-flash')
    const client = await manager.createClient(dataDir)
    const created = await client.request<{ sessionId: string }>('session/new', {
      cwd: client.sessionCwd,
      mcpServers: []
    })
    await manager.configureSession(client, created.sessionId, created)
    expect(manager.selectedModel()).toBe('gemini-3-flash')
    await client.close()
    const log = await readFile(join(client.sessionCwd, '..', '..', 'fixture-methods.log'), 'utf8')
    expect(log).toContain('session/set_config_option')
    expect(log).toContain('session/close')
    expect(log).not.toContain('auth/logout')
    await expect(manager.selectModel('invented')).rejects.toThrow()
  }, 20000)
  it('retains local history scope on shutdown/restart and rotates it on explicit local disconnect', async () => {
    const { manager, dataDir } = await fixture()
    await manager.login()
    await manager.models()
    await manager.selectModel('gemini-3-flash')
    const id = manager.connectionIdentity()
    await manager.shutdown()
    const restored = new GeminiConnectionManager({ dataDir, command, notify: vi.fn() })
    managers.push(restored)
    expect(restored.connectionIdentity()).toBe(id)
    expect(restored.selectedModel()).toBe('gemini-3-flash')
    expect((await restored.models()).length).toBe(2)
    await restored.disconnect()
    expect(restored.connectionIdentity()).not.toBe(id)
    expect((await restored.status()).authenticated).toBe(false)
  }, 20000)
  it('cancels browser auth, sanitizes failures, and leaves native auth state untouched on forget', async () => {
    const { manager, dataDir } = await fixture()
    const client = await manager.createClient(dataDir)
    const home = join(client.sessionCwd, '..', '..')
    await client.close()
    await writeFile(join(home, 'pending-auth'), '')
    const login = manager.login()
    await vi.waitFor(async () => expect((await manager.status()).state).toBe('authenticating'))
    manager.cancelLogin()
    expect((await login).authenticated).toBe(false)
    await rm(join(home, 'pending-auth'))
    await writeFile(join(home, 'deny-auth'), '')
    const failed = await manager.login()
    expect(failed.error).not.toContain('fixture-private')
    await rm(join(home, 'deny-auth'))
    expect((await manager.login()).authenticated).toBe(true)
    const id = manager.connectionIdentity()
    await manager.forget()
    expect(manager.connectionIdentity()).not.toBe(id)
    expect(await readFile(join(home, 'native-store', 'fixture-session'), 'utf8')).toBe(
      'opaque native auth fixture'
    )
  }, 20000)
  it('adopts actual initial model but preserves an explicit choice', async () => {
    const { manager } = await fixture()
    manager.rememberSession(models('gemini-3-flash'))
    expect(manager.selectedModel()).toBe('gemini-3-flash')
    await manager.selectModel('gemini-3-pro')
    manager.rememberSession(models('gemini-3-flash'))
    expect(manager.selectedModel()).toBe('gemini-3-pro')
  })
})
