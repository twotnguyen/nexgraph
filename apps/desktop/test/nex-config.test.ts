import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  nexAccountConfig, nexConfig, nexConfigFiles, nexProviderEnv, nexProjectKey, NEX_DISABLED_TOOLS, NEX_PROVIDER_ENV,
  NEX_ENABLED_TOOLS, NEX_REMOVED_PLUGINS, NEX_WEBSEARCH_PROVIDER
} from '../src/main/features/agent/nex/config'
import { NEX_INSTRUCTIONS_FILE, nexInstructions } from '../src/main/features/agent/nex/instructions'

const engine = { command: '/opt/nexgraph/engine/nexgraph-engine', args: [] as string[] }
const provider = { id: 'custom-1', label: 'NexGraph QA', baseUrl: 'https://ai.example.test/v1', apiKey: 'sk-sentinel-key', model: 'gpt-6-luna' }

describe('cấu hình Nex (OpenCode v2)', () => {
  it('dựng đúng khoá v2: providers, mcp.servers, permissions; key không nằm trong cấu hình', () => {
    const root = mkdtempSync(join(tmpdir(), 'n1a1-config-'))
    const config = nexConfig({ root, engine, dataDir: join(root, '.nexgraph'), configDir: join(root, 'config'), provider })
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
    expect(JSON.stringify(nexConfig({ root, engine, dataDir: join(root, '.nexgraph'), configDir: join(root, 'config'), provider }))).not.toContain('sk-sentinel-key')
  })

  it('engine dev dùng đúng lệnh mcp mà app dùng, có args của launcher', () => {
    const root = '/tmp/proj'
    const config = nexConfig({
      root,
      engine: { command: 'uv', args: ['run', '--project', '/repo/engine', '--locked', 'python', '-m', 'nexgraph_engine.cli'] },
      dataDir: '/tmp/data',
      configDir: '/tmp/cfg',
      provider
    })
    const command = (config.mcp as { servers: { nexgraph: { command: string[] } } }).servers.nexgraph.command
    expect(command.slice(0, 8)).toEqual(['uv', 'run', '--project', '/repo/engine', '--locked', 'python', '-m', 'nexgraph_engine.cli'])
    expect(command.slice(8)).toEqual(['mcp', '--project', root, '--data-dir', '/tmp/data'])
  })

  it('cấu hình tài khoản đã đăng nhập trỏ thẳng provider/model, không khai báo providers', () => {
    const root = '/tmp/proj-account'
    const config = nexAccountConfig({ root, engine, dataDir: '/tmp/data', configDir: '/tmp/cfg', providerID: 'github-copilot', model: 'gpt-4.1' })
    expect(config.model).toBe('github-copilot/gpt-4.1')
    expect(config).not.toHaveProperty('providers')
    expect(config).not.toHaveProperty('provider')
    const servers = (config.mcp as { servers: Record<string, { command: string[]; cwd: string }> }).servers
    expect(servers.nexgraph.cwd).toBe(root)
    expect(servers.nexgraph.command.slice(-1)).toEqual(['/tmp/data'])
    const rules = config.permissions as { action: string; effect: string }[]
    expect(rules.find((rule) => rule.action === 'edit')?.effect).toBe('ask')
  })

  it('khai tệp chỉ dẫn của Nex bằng đường dẫn tuyệt đối trong thư mục cấu hình (cả hai kiểu cấu hình)', () => {
    const configDir = join(mkdtempSync(join(tmpdir(), 'n1a1-config-')), 'config')
    const viaProvider = nexConfig({ root: '/tmp/proj', engine, dataDir: '/tmp/data', configDir, provider })
    const viaAccount = nexAccountConfig({ root: '/tmp/proj', engine, dataDir: '/tmp/data', configDir, providerID: 'github-copilot', model: 'gpt-4.1' })
    const expected = [join(configDir, NEX_INSTRUCTIONS_FILE)]
    expect(viaProvider.instructions).toEqual(expected)
    expect(viaAccount.instructions).toEqual(expected)
    // OpenCode tìm tệp bằng glob basename trong thư mục cha: tên tệp không được chứa ký tự glob.
    expect(NEX_INSTRUCTIONS_FILE).toMatch(/^[a-z0-9-]+\.md$/)
    expect(nexConfigFiles()).toEqual({ [NEX_INSTRUCTIONS_FILE]: nexInstructions() })
  })

  it('tắt hẳn tool OpenCode mà app không phục vụ được (luật cuối cùng khớp là deny trên mọi tài nguyên)', () => {
    const config = nexConfig({ root: '/tmp/proj', engine, dataDir: '/tmp/data', configDir: '/tmp/cfg', provider })
    const rules = config.permissions as { action: string; resource: string; effect: string }[]
    // Cách OpenCode 2.4.1 ẩn tool (`tool.ts` whollyDisabled): luật khớp cuối cùng, resource "*", effect "deny".
    const lastMatch = (action: string) => rules.findLast((rule) => rule.action === action || (rule.action.endsWith('*') && action.startsWith(rule.action.slice(0, -1))))
    for (const tool of NEX_DISABLED_TOOLS) expect(lastMatch(tool), tool).toMatchObject({ resource: '*', effect: 'deny' })
    for (const tool of ['read', 'glob', 'grep']) expect(lastMatch(tool)?.effect, tool).toBe('allow')
    for (const tool of ['edit', 'shell']) expect(lastMatch(tool)?.effect, tool).toBe('ask')
    expect(lastMatch('nexgraph_search')?.effect).toBe('allow')
    expect(NEX_DISABLED_TOOLS).toEqual(expect.arrayContaining(['question', 'subagent', 'execute', 'skill']))
  })

  it('gỡ plugin tool có sẵn mà app không phục vụ được, ở cả hai kiểu cấu hình; giữ plugin của tool được dùng', () => {
    const viaProvider = nexConfig({ root: '/tmp/proj', engine, dataDir: '/tmp/data', configDir: '/tmp/cfg', provider })
    const viaAccount = nexAccountConfig({ root: '/tmp/proj', engine, dataDir: '/tmp/data', configDir: '/tmp/cfg', providerID: 'github-copilot', model: 'gpt-4.1' })
    for (const config of [viaProvider, viaAccount]) {
      const plugins = config.plugins as string[]
      expect(plugins).toEqual(NEX_REMOVED_PLUGINS.map((id) => `-${id}`))
      expect(plugins).toEqual(expect.arrayContaining(['-opencode.tool.automation', '-opencode.tools', '-opencode.tool.skill']))
      // Plugin của tool Nex được dùng (read/glob/grep/edit/write/shell) không được gỡ.
      for (const kept of ['read', 'glob', 'grep', 'edit', 'write', 'shell']) expect(plugins).not.toContain(`-opencode.tool.${kept}`)
    }
  })

  it('giữ đường đọc resource MCP (nexgraph://report, god-nodes…) như Graphify cấp cho agent kết nối vào', () => {
    const config = nexConfig({ root: '/tmp/proj', engine, dataDir: '/tmp/data', configDir: '/tmp/cfg', provider })
    expect(config.plugins as string[]).not.toContain('-opencode.tools.mcp-resources')
    const rules = config.permissions as { action: string; resource: string; effect: string }[]
    for (const tool of ['opencode_list_mcp_resources', 'opencode_read_mcp_resource']) {
      // Không có luật allow thì OpenCode hỏi quyền, và onPermission của app từ chối mọi quyền ngoài edit/shell.
      expect(rules.findLast((rule) => rule.action === tool)?.effect, tool).toBe('allow')
      expect(NEX_ENABLED_TOOLS as readonly string[]).toContain(tool)
    }
    // Chỉ mở cho server nexgraph (OpenCode kiểm resource "<server>" khi liệt kê, "<server>:<uri>" khi đọc).
    expect(rules.find((rule) => rule.action === 'opencode_list_mcp_resources')?.resource).toBe('nexgraph')
    expect(rules.find((rule) => rule.action === 'opencode_read_mcp_resource')?.resource).toBe('nexgraph:*')
  })

  it('webfetch/websearch bật nhưng luôn hỏi duyệt; tìm web chọn sẵn nhà cung cấp (không mở form chọn mà app không vẽ được)', () => {
    const viaProvider = nexConfig({ root: '/tmp/proj', engine, dataDir: '/tmp/data', configDir: '/tmp/cfg', provider })
    const viaAccount = nexAccountConfig({ root: '/tmp/proj', engine, dataDir: '/tmp/data', configDir: '/tmp/cfg', providerID: 'github-copilot', model: 'gpt-4.1' })
    for (const config of [viaProvider, viaAccount]) {
      const rules = config.permissions as { action: string; resource: string; effect: string }[]
      for (const tool of ['webfetch', 'websearch']) {
        expect(rules.findLast((rule) => rule.action === tool), tool).toEqual({ action: tool, resource: '*', effect: 'ask' })
        expect(NEX_ENABLED_TOOLS as readonly string[]).toContain(tool)
        expect(NEX_DISABLED_TOOLS as readonly string[]).not.toContain(tool)
        expect(config.plugins as string[]).not.toContain(`-opencode.tool.${tool}`)
      }
      expect(config.websearch).toEqual({ provider: NEX_WEBSEARCH_PROVIDER })
    }
  })

  it('khoá dự án chỉ chứa ký tự an toàn và không rỗng', () => {
    expect(nexProjectKey('abc-123_X.Y')).toBe('abc-123_X.Y')
    expect(nexProjectKey('a/b\\c d')).toBe('a_b_c_d')
    expect(nexProjectKey('')).toBe('project')
  })
})
