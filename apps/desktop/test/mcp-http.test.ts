import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { McpHttpManager, mcpStdioConfig } from '../src/main/mcp-http'

const fake = {
  command: process.execPath,
  args: [fileURLToPath(new URL('./fixtures/fake-engine.mjs', import.meta.url))]
}
let mgr: McpHttpManager

afterEach(async () => mgr?.stopAll())

describe('McpHttpManager', () => {
  it('starts one HTTP server per project with a key that the server accepts', async () => {
    mgr = new McpHttpManager(() => fake, '/data')
    const { url, key } = await mgr.start('p1', '/Đồ án/demo')
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect((await fetch(url, { headers: { 'X-API-Key': key } })).status).toBe(200)
    expect((await fetch(url)).status).toBe(401)
    const argv = ((await (await fetch(url, { headers: { 'X-API-Key': key } })).json()) as { argv: string[] }).argv
    expect(argv).toEqual(['mcp', '--project', '/Đồ án/demo', '--data-dir', '/data', '--http', '--port', '0'])
    expect(mgr.status('p1')).toEqual({ url })
    expect(await mgr.start('p1', '/Đồ án/demo')).toEqual({ url, key }) // đang chạy: trả lại phiên cũ
  })

  it('reuses a stored key and reports null after stop', async () => {
    mgr = new McpHttpManager(() => fake, '/data', { load: () => 'a'.repeat(64), save: () => {} })
    expect((await mgr.start('p1', '/x')).key).toBe('a'.repeat(64))
    await mgr.stop('p1')
    expect(mgr.status('p1')).toBeNull()
  })
})

describe('McpHttpManager: port and shutdown', () => {
  it('keeps the same URL across restarts and falls back when the port is taken', async () => {
    mgr = new McpHttpManager(() => fake, '/data')
    const first = await mgr.start('p1', '/x')
    await mgr.stop('p1')
    expect((await mgr.start('p1', '/x')).url).toBe(first.url)
    const other = new McpHttpManager(() => fake, '/data', undefined, { load: () => Number(new URL(first.url).port), save: () => {} })
    const taken = await other.start('p2', '/y') // cổng đang bị p1 giữ: lấy cổng khác
    expect(taken.url).not.toBe(first.url)
    await other.stopAll()
  })

  it('kills a server that ignores SIGTERM so quitting never hangs', async () => {
    process.env.FAKE_MCP_IGNORE_TERM = '1'
    try {
      mgr = new McpHttpManager(() => fake, '/data', undefined, undefined, 300)
      await mgr.start('p1', '/x')
      const t = Date.now()
      await mgr.stop('p1')
      expect(Date.now() - t).toBeLessThan(3000)
    } finally {
      delete process.env.FAKE_MCP_IGNORE_TERM
    }
  })
})

describe('mcpStdioConfig', () => {
  it('builds an mcpServers JSON block for the engine command', () => {
    const cfg = JSON.parse(mcpStdioConfig({ command: 'uv', args: ['run', 'nexgraph-engine'] }, '/Đồ án/demo', '/data'))
    expect(cfg).toEqual({ mcpServers: { nexgraph: { command: 'uv',
      args: ['run', 'nexgraph-engine', 'mcp', '--project', '/Đồ án/demo', '--data-dir', '/data'] } } })
  })
})
