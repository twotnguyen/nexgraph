import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { applyIntegration, planIntegration } from '../src/main/integrations'

const cmd = { command: '/Apps/NexGraph/engine', args: [] as string[] }
const dataDir = '/data dir'
let root: string
beforeEach(() => {
  root = join(mkdtempSync(join(tmpdir(), 'ng-int-')), 'Đồ án', 'demo app')
  mkdirSync(join(root, '.cursor'), { recursive: true })
})
const args = (r: string): string[] => ['mcp', '--project', r, '--data-dir', dataDir]

describe('integrations', () => {
  it('tệp chưa có: status new, nội dung đúng định dạng từng agent; plan không ghi', () => {
    const p = planIntegration('claude', root, cmd, dataDir)
    expect(p).toMatchObject({ path: join(root, '.mcp.json'), exists: false, status: 'new' })
    expect(JSON.parse(p.after)).toEqual({ mcpServers: { nexgraph: { type: 'stdio', command: '/Apps/NexGraph/engine', args: args(root) } } })
    expect(JSON.parse(planIntegration('vscode', root, cmd, dataDir).after).servers.nexgraph.type).toBe('stdio')
    expect(JSON.parse(planIntegration('opencode', root, cmd, dataDir).after).mcp.nexgraph)
      .toEqual({ type: 'local', command: ['/Apps/NexGraph/engine', ...args(root)] })
    expect(existsSync(join(root, '.mcp.json'))).toBe(false)
  })

  it('tệp đã có server khác: giữ nguyên mọi khoá và thứ tự, chỉ thêm nexgraph', () => {
    writeFileSync(join(root, '.mcp.json'), '{"$schema":"x","mcpServers":{"other":{"command":"o"}},"extra":[1,2]}')
    const p = applyIntegration('claude', root, cmd, dataDir)
    expect(p.status).toBe('add')
    const after = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8'))
    expect(Object.keys(after)).toEqual(['$schema', 'mcpServers', 'extra'])
    expect(after.mcpServers.other).toEqual({ command: 'o' })
    expect(Object.keys(after.mcpServers)).toEqual(['other', 'nexgraph'])
  })

  it('đã cài đúng: up_to_date và không ghi lại tệp; lệnh cũ khác: update', () => {
    applyIntegration('claude', root, cmd, dataDir)
    const file = join(root, '.mcp.json')
    const old = new Date(2020, 0, 1)
    utimesSync(file, old, old)
    expect(applyIntegration('claude', root, cmd, dataDir).status).toBe('up_to_date')
    expect(statSync(file).mtime.getTime()).toBe(old.getTime())
    expect(planIntegration('claude', root, { command: '/new/engine', args: [] }, dataDir).status).toBe('update')
  })

  it('JSON hỏng hoặc có chú thích: invalid, apply ném invalid_config, tệp không đổi một byte', () => {
    const text = '{ // ghi chú\n "mcpServers": {} }'
    writeFileSync(join(root, '.cursor/mcp.json'), text)
    expect(planIntegration('cursor', root, cmd, dataDir).status).toBe('invalid')
    expect(() => applyIntegration('cursor', root, cmd, dataDir)).toThrow(expect.objectContaining({ code: 'invalid_config' }))
    expect(readFileSync(join(root, '.cursor/mcp.json'), 'utf8')).toBe(text)
  })

  it('khoá chứa có nhưng không phải object (mcpServers: []): invalid', () => {
    writeFileSync(join(root, '.mcp.json'), '{"mcpServers":[]}')
    expect(planIntegration('claude', root, cmd, dataDir).status).toBe('invalid')
  })

  it('ghi tạo thư mục cha còn thiếu', () => {
    applyIntegration('vscode', root, cmd, dataDir)
    expect(existsSync(join(root, '.vscode', 'mcp.json'))).toBe(true)
  })
})
