import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { AGENT_IDS } from '../src/shared/integration-types'
import { agentsMdBlock, applyPlatform, applyUninstall, planPlatform, planUninstall } from '../src/main/integrations'

const cmd = { command: '/Apps/NexGraph/engine', args: [] as string[] }
const dataDir = '/data dir'
let root: string
beforeEach(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ng-plat-')))
})
const rel = (p: string): string => relative(root, p).replace(/\\/g, '/')
const files = (dir: string): string[] => readdirSync(dir, { recursive: true, encoding: 'utf8' })
  .filter((f) => statSync(join(dir, f)).isFile()).map((f) => f.replace(/\\/g, '/')).sort()

describe('21 nền tảng', () => {
  it('đủ 21 nền tảng, mỗi nền tảng có ít nhất khối quy tắc hoặc skill', () => {
    expect(AGENT_IDS).toHaveLength(21)
    for (const agent of AGENT_IDS) {
      const parts = planPlatform(agent, root, cmd, dataDir).map((p) => p.part)
      expect(parts.some((p) => p === 'rules' || p === 'skill'), agent).toBe(true)
    }
  })

  it('snapshot nội dung từng nền tảng trên dự án trống', () => {
    const all = Object.fromEntries(AGENT_IDS.map((agent) => [agent, planPlatform(agent, root, cmd, dataDir).map((p) => ({
      part: p.part, path: rel(p.path), status: p.status, after: p.after.replaceAll(root, '<root>')
    }))]))
    expect(all).toMatchSnapshot()
  })

  it('mỗi nền tảng: ghi rồi plan lại là up_to_date; gỡ thì không còn tệp nào', () => {
    for (const agent of AGENT_IDS) {
      const dir = realpathSync.native(mkdtempSync(join(tmpdir(), `ng-plat-${agent}-`)))
      applyPlatform(agent, dir, cmd, dataDir, { strict: true })
      expect(files(dir).length, agent).toBeGreaterThan(0)
      expect(planPlatform(agent, dir, cmd, dataDir, { strict: true }).every((p) => p.status === 'up_to_date'), agent).toBe(true)
      expect(planUninstall(agent, dir, cmd, dataDir).every((p) => p.status === 'delete' || p.status === 'remove'), agent).toBe(true)
      applyUninstall(agent, dir, cmd, dataDir)
      expect(files(dir), agent).toEqual([])
      expect(planUninstall(agent, dir, cmd, dataDir).every((p) => p.status === 'up_to_date'), agent).toBe(true)
    }
  })

  it('Gemini: MCP và hook cùng .gemini/settings.json, xem trước phần sau gồm phần trước, ghi ra một tệp đủ cả hai', () => {
    const [mcp, , , hook] = planPlatform('gemini', root, cmd, dataDir)
    expect(mcp.path).toBe(hook.path)
    expect(mcp.status).toBe('new')
    expect(hook.status).toBe('add')
    const merged = JSON.parse(hook.after)
    expect(merged.mcpServers.nexgraph).toEqual({ command: cmd.command, args: ['mcp', '--project', root, '--data-dir', dataDir] })
    expect(merged.hooks.BeforeTool[0].hooks[0].command).toContain('hook-guard gemini')
    applyPlatform('gemini', root, cmd, dataDir)
    expect(JSON.parse(readFileSync(join(root, '.gemini', 'settings.json'), 'utf8'))).toEqual(merged)
  })

  it('Claude: giữ hook của người dùng và của công cụ khác; strict thêm --strict; gỡ chỉ bỏ mục NexGraph', () => {
    const settings = join(root, '.claude', 'settings.json')
    mkdirSync(join(root, '.claude'))
    const mine = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }
    const other = { matcher: 'Read|Glob', hooks: [{ type: 'command', command: 'graphify hook-guard read' }] }
    writeFileSync(settings, JSON.stringify({ model: 'x', hooks: { PreToolUse: [mine, other], Stop: [] } }))
    const hook = planPlatform('claude', root, cmd, dataDir, { strict: true }).find((p) => p.part === 'hook')!
    expect(hook.status).toBe('add')
    const pre = JSON.parse(hook.after).hooks.PreToolUse
    expect(pre.slice(0, 2)).toEqual([mine, other])
    expect(pre.slice(2).map((g: { matcher: string }) => g.matcher)).toEqual(['Bash|Grep', 'Read|Glob'])
    expect(pre[3].hooks[0]).toEqual({ type: 'command', timeout: 10,
      command: `/Apps/NexGraph/engine hook-guard read --project ${root.includes(' ') ? `"${root}"` : root} --data-dir "/data dir" --strict` })
    applyPlatform('claude', root, cmd, dataDir, { strict: true })
    expect(planPlatform('claude', root, cmd, dataDir).find((p) => p.part === 'hook')!.status).toBe('update') // bỏ strict
    applyUninstall('claude', root, cmd, dataDir)
    expect(JSON.parse(readFileSync(settings, 'utf8'))).toEqual({ model: 'x', hooks: { PreToolUse: [mine, other], Stop: [] } })
  })

  it('gỡ khối AGENTS.md: giữ nguyên từng byte ngoài khối; tệp chỉ còn khối thì xoá', () => {
    const file = join(root, 'AGENTS.md')
    writeFileSync(file, `Đầu.\r\n${agentsMdBlock()}Cuối.\r\n`)
    const rules = planUninstall('codex', root, cmd, dataDir).find((p) => p.part === 'rules')!
    expect(rules).toMatchObject({ status: 'remove', after: 'Đầu.\r\nCuối.\r\n' })
    applyUninstall('codex', root, cmd, dataDir)
    expect(readFileSync(file, 'utf8')).toBe('Đầu.\r\nCuối.\r\n')
    writeFileSync(file, agentsMdBlock())
    expect(planUninstall('agents', root, cmd, dataDir).find((p) => p.part === 'rules')!.status).toBe('delete')
  })

  it('gỡ MCP: giữ server khác; skill người dùng tự viết không bị xoá', () => {
    writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'o' }, nexgraph: { command: 'n' } } }))
    mkdirSync(join(root, '.claude', 'skills', 'nexgraph'), { recursive: true })
    writeFileSync(join(root, '.claude', 'skills', 'nexgraph', 'SKILL.md'), '# của tôi\n')
    const plans = planUninstall('claude', root, cmd, dataDir)
    expect(plans.find((p) => p.part === 'mcp')).toMatchObject({ status: 'remove' })
    expect(plans.find((p) => p.part === 'skill')).toMatchObject({ status: 'invalid' })
    applyUninstall('claude', root, cmd, dataDir)
    expect(JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8'))).toEqual({ mcpServers: { other: { command: 'o' } } })
    expect(readFileSync(join(root, '.claude', 'skills', 'nexgraph', 'SKILL.md'), 'utf8')).toBe('# của tôi\n')
  })

  it('phần invalid không chặn các phần khác khi ghi', () => {
    writeFileSync(join(root, '.mcp.json'), '{ // chú thích\n}')
    const plans = applyPlatform('claude', root, cmd, dataDir)
    expect(plans.find((p) => p.part === 'mcp')!.status).toBe('invalid')
    expect(readFileSync(join(root, '.mcp.json'), 'utf8')).toBe('{ // chú thích\n}')
    expect(files(root)).toContain('CLAUDE.md')
  })
})
