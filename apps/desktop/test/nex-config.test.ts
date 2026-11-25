import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { nexConfig, nexProviderEnv, nexProjectKey, NEX_PROVIDER_ENV } from '../src/main/agent/nex/config'

const engine = { command: '/opt/nexgraph/engine/nexgraph-engine', args: [] as string[] }
const provider = { id: 'custom-1', label: 'NexGraph QA', baseUrl: 'https://ai.example.test/v1', apiKey: 'sk-sentinel-key', model: 'gpt-6-luna' }

describe('cấu hình Nex (OpenCode v2)', () => {
  it('dựng đúng khoá v2: providers, mcp.servers, permissions; key không nằm trong cấu hình', () => {
    const root = mkdtempSync(join(tmpdir(), 'n1a1-config-'))
    const config = nexConfig({ root, engine, dataDir: join(root, '.nexgraph'), provider })
    const text = JSON.stringify(config)
    expect(config.model).toBe('nexgraph/gpt-6-luna')
    const providers = config.providers as Record<string, { package: string; settings: Record<string, string> }>
    expect(providers.nexgraph.package).toBe('@opencode/ai/providers/openai-compatible')
    expect(providers.nexgraph.settings).toEqual({
      baseURL: `{env:${NEX_PROVIDER_ENV.baseUrl}}`,
      apiKey: `{env:${NEX_PROVIDER_ENV.apiKey}}`
    })
    const mcp = (config.mcp as { servers: Record<string, { type: string; command: string[]; cwd: string; codemode: boolean }> }).servers
    expect(mcp.nexgraph.type).toBe('local')
    expect(mcp.nexgraph.codemode).toBe(false)
    expect(mcp.nexgraph.cwd).toBe(root)
    expect(mcp.nexgraph.command.slice(-5)).toEqual(['mcp', '--project', root, '--data-dir', join(root, '.nexgraph')])
    expect(text).not.toContain(provider.apiKey)
    const rules = config.permissions as { action: string; effect: string }[]
    expect(rules.find((rule) => rule.action === 'edit')?.effect).toBe('ask')
    expect(rules.find((rule) => rule.action === 'shell')?.effect).toBe('ask')
    expect(rules.find((rule) => rule.action === 'nexgraph_*')?.effect).toBe('allow')
    // Khoá v1 không được xuất hiện: OpenCode 2 bỏ qua im lặng cấu hình sai khoá.
    expect(rules.some((rule) => rule.action === 'permission' || rule.action === 'bash')).toBe(false)
    expect(config).not.toHaveProperty('permission')
    expect(config).not.toHaveProperty('provider')
  })

  it('đưa base URL và key vào env của tiến trình con, không vào cấu hình', () => {
    const env = nexProviderEnv(provider)
    expect(env[NEX_PROVIDER_ENV.baseUrl]).toBe(provider.baseUrl)
    expect(env[NEX_PROVIDER_ENV.apiKey]).toBe(provider.apiKey)
    const root = mkdtempSync(join(tmpdir(), 'n1a1-config-'))
    expect(JSON.stringify(nexConfig({ root, engine, dataDir: join(root, '.nexgraph'), provider }))).not.toContain('sk-sentinel-key')
  })

  it('engine dev dùng đúng lệnh mcp mà app dùng, có args của launcher', () => {
    const root = '/tmp/proj'
    const config = nexConfig({
      root,
      engine: { command: 'uv', args: ['run', '--project', '/repo/engine', '--locked', 'python', '-m', 'nexgraph_engine.cli'] },
      dataDir: '/tmp/data',
      provider
    })
    const command = (config.mcp as { servers: { nexgraph: { command: string[] } } }).servers.nexgraph.command
    expect(command.slice(0, 8)).toEqual(['uv', 'run', '--project', '/repo/engine', '--locked', 'python', '-m', 'nexgraph_engine.cli'])
    expect(command.slice(8)).toEqual(['mcp', '--project', root, '--data-dir', '/tmp/data'])
  })

  it('khoá dự án chỉ chứa ký tự an toàn và không rỗng', () => {
    expect(nexProjectKey('abc-123_X.Y')).toBe('abc-123_X.Y')
    expect(nexProjectKey('a/b\\c d')).toBe('a_b_c_d')
    expect(nexProjectKey('')).toBe('project')
  })
})
