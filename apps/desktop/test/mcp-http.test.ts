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

describe('mcpStdioConfig', () => {
  it('builds an mcpServers JSON block for the engine command', () => {
    const cfg = JSON.parse(mcpStdioConfig({ command: 'uv', args: ['run', 'nexgraph-engine'] }, '/Đồ án/demo', '/data'))
    expect(cfg).toEqual({ mcpServers: { nexgraph: { command: 'uv',
      args: ['run', 'nexgraph-engine', 'mcp', '--project', '/Đồ án/demo', '--data-dir', '/data'] } } })
  })
})
