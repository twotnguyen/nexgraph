import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { agentsMdBlock, applyIntegration, applySkill, planIntegration, planSkill } from '../src/main/integrations'
import { skillMarkdown } from '../src/main/agent/skill'

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

  it('codex: chưa có .codex/config.toml → new, TOML có lệnh engine và tham số mcp --project', () => {
    const p = planIntegration('codex', root, cmd, dataDir)
    expect(p).toMatchObject({ agent: 'codex', exists: false, status: 'new' })
    expect(p.path.replace(/\\/g, '/').endsWith('/.codex/config.toml')).toBe(true) // Windows dùng \
    expect(p.after).toBe('[mcp_servers.nexgraph]\ncommand = "/Apps/NexGraph/engine"\nargs = ["mcp", "--project", ' + JSON.stringify(root) + ', "--data-dir", ' + JSON.stringify(dataDir) + ']\n')
    expect(p.snippet).toBe(p.after)
    expect(existsSync(join(root, '.codex', 'config.toml'))).toBe(false)
  })

  it('codex: tệp TOML đã có → invalid, apply ném invalid_config, tệp không đổi một byte', () => {
    const text = '[mcp_servers.other]\ncommand = "o"\n'
    mkdirSync(join(root, '.codex'), { recursive: true })
    writeFileSync(join(root, '.codex/config.toml'), text)
    const p = planIntegration('codex', root, cmd, dataDir)
    expect(p).toMatchObject({ status: 'invalid', exists: true, after: '' })
    expect(p.snippet).toContain('[mcp_servers.nexgraph]')
    expect(() => applyIntegration('codex', root, cmd, dataDir)).toThrow(expect.objectContaining({ code: 'invalid_config' }))
    expect(readFileSync(join(root, '.codex/config.toml'), 'utf8')).toBe(text)
  })

  it('planSkill claude: chưa có → new với SKILL.md; trùng → up_to_date; khác → invalid không ghi đè', () => {
    const skill = skillMarkdown()
    const p = planSkill('claude', root)
    expect(p).toMatchObject({ agent: 'skill-claude', exists: false, status: 'new', after: skill })
    expect(p.path.replace(/\\/g, '/').endsWith('/.claude/skills/nexgraph/SKILL.md')).toBe(true) // Windows dùng \
    expect(existsSync(p.path)).toBe(false)
    applySkill('claude', root)
    expect(readFileSync(p.path, 'utf8')).toBe(skill)
    expect(planSkill('claude', root).status).toBe('up_to_date')
    writeFileSync(p.path, '# khác\n')
    const p2 = planSkill('claude', root)
    expect(p2).toMatchObject({ status: 'invalid', exists: true, after: '' }) // không ghi đè skill của người dùng (spec §5.5)
    expect(p2.snippet).toBe(skill)
    expect(() => applySkill('claude', root)).toThrow(expect.objectContaining({ code: 'invalid_config' }))
    expect(readFileSync(p.path, 'utf8')).toBe('# khác\n')
  })

  it('planSkill agents-md: chưa có → tệp chỉ gồm khối; chạy hai lần không nhân đôi; ngoài khối giữ nguyên từng byte', () => {
    expect(planSkill('agents-md', root).status).toBe('new')
    applySkill('agents-md', root)
    const file = join(root, 'AGENTS.md')
    const first = readFileSync(file, 'utf8')
    expect(first).toBe(agentsMdBlock())
    expect(first.startsWith('<!-- nexgraph:start -->')).toBe(true) // chỉ gồm khối, không frontmatter
    expect(planSkill('agents-md', root).status).toBe('up_to_date')
    expect(applySkill('agents-md', root).status).toBe('up_to_date')
    expect(readFileSync(file, 'utf8')).toBe(first)
    // tệp đã có nội dung người dùng: chỉ thêm khối, giữ từng byte
    writeFileSync(file, 'Hướng dẫn của nhóm.\n')
    expect(planSkill('agents-md', root).status).toBe('add')
    const custom = 'Hướng dẫn của nhóm.\n<!-- nexgraph:start -->\ncũ\n<!-- nexgraph:end -->\nCuối tệp.\n'
    writeFileSync(file, custom)
    applySkill('agents-md', root)
    expect(readFileSync(file, 'utf8')).toBe(`Hướng dẫn của nhóm.\n${agentsMdBlock()}Cuối tệp.\n`)
    // CRLF (Windows): marker \r?\n được nhận, byte ngoài khối (kể cả \r\n sau marker cuối) giữ nguyên; apply lần hai không nhân đôi
    const crlf = 'Hướng dẫn.\r\n<!-- nexgraph:start -->\r\ncũ\r\n<!-- nexgraph:end -->\r\nCuối tệp.\r\n'
    writeFileSync(file, crlf)
    applySkill('agents-md', root)
    const afterCrlf = `Hướng dẫn.\r\n${agentsMdBlock()}Cuối tệp.\r\n`
    expect(readFileSync(file, 'utf8')).toBe(afterCrlf)
    expect(applySkill('agents-md', root).status).toBe('up_to_date')
    expect(readFileSync(file, 'utf8')).toBe(afterCrlf)
  })

  it('codex: symlink .codex trỏ ngoài dự án (còn tồn tại hoặc treo) bị chặn, không ghi gì', () => {
    const outDir = join(tmpdir(), 'ng-int-codex-out')
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'config.toml'), '[x]\n')
    symlinkSync(outDir, join(root, '.codex'))
    expect(() => planIntegration('codex', root, cmd, dataDir)).toThrow(expect.objectContaining({ code: 'outside_project' }))
    expect(() => applyIntegration('codex', root, cmd, dataDir)).toThrow(expect.objectContaining({ code: 'outside_project' }))
    expect(readFileSync(join(outDir, 'config.toml'), 'utf8')).toBe('[x]\n')
    rmSync(join(root, '.codex'))
    symlinkSync(join(tmpdir(), 'ng-int-codex-dangling'), join(root, '.codex'))
    expect(() => planIntegration('codex', root, cmd, dataDir)).toThrow(expect.objectContaining({ code: 'outside_project' }))
  })

  it('skill: symlink thoát dự án bị chặn theo resolveInside, plan lẫn apply đều ném', () => {
    mkdirSync(join(root, '.claude'), { recursive: true })
    symlinkSync(join(tmpdir(), 'ng-int-outside'), join(root, '.claude', 'skills'))
    expect(() => planSkill('claude', root)).toThrow(expect.objectContaining({ code: 'outside_project' }))
    expect(() => applySkill('claude', root)).toThrow(expect.objectContaining({ code: 'outside_project' }))
    symlinkSync(join(tmpdir(), 'ng-int-outside'), join(root, 'AGENTS.md'))
    expect(() => planSkill('agents-md', root)).toThrow(expect.objectContaining({ code: 'outside_project' }))
  })
})
