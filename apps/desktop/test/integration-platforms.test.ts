import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
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
/** Mọi dạng đường dẫn gốc xuất hiện trong nội dung → <root>, để snapshot giống nhau trên macOS và Windows. */
const norm = (text: string, r: string, fileUrl: string): string => text
  .replaceAll(fileUrl, 'file://<root>')
  .replaceAll(JSON.stringify(r).slice(1, -1), '<root>')
  .replaceAll(r, '<root>')
  .replaceAll('\\"<root>\\"', '<root>') // sh() bọc "..." khi gốc có \ (Windows), trong chuỗi JSON thành \"...\"
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
      part: p.part, path: rel(p.path), status: p.status, after: norm(p.after, root, pathToFileURL(root).href)
    }))]))
    expect(all).toMatchSnapshot()
  })

  it('mỗi nền tảng: ghi rồi plan lại là up_to_date; gỡ thì chỉ còn JSON {} và không còn thư mục rỗng', () => {
    for (const agent of AGENT_IDS) {
      const dir = realpathSync.native(mkdtempSync(join(tmpdir(), `ng-plat-${agent}-`)))
      applyPlatform(agent, dir, cmd, dataDir, { strict: true })
      expect(files(dir).length, agent).toBeGreaterThan(0)
      expect(planPlatform(agent, dir, cmd, dataDir, { strict: true }).every((p) => p.status === 'up_to_date'), agent).toBe(true)
      expect(planUninstall(agent, dir, cmd, dataDir).every((p) => p.status === 'delete' || p.status === 'remove'), agent).toBe(true)
      applyUninstall(agent, dir, cmd, dataDir)
      expect(files(dir).filter((f) => readFileSync(join(dir, f), 'utf8') !== '{}\n'), agent).toEqual([])
      expect(existsSync(dir), agent).toBe(true) // dọn thư mục rỗng dừng ở gốc dự án
      const dirs = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => statSync(join(dir, f)).isDirectory())
      expect(dirs.filter((d) => readdirSync(join(dir, d)).length === 0), agent).toEqual([])
      expect(planUninstall(agent, dir, cmd, dataDir).every((p) => p.status === 'up_to_date'), agent).toBe(true)
    }
  })

  it('Gemini: MCP và hook cùng .gemini/settings.json, xem trước phần sau gồm phần trước, ghi ra một tệp đủ cả hai', () => {
    const [mcp, , , hook] = planPlatform('gemini', root, cmd, dataDir)
    expect(mcp.path).toBe(hook.path)
    expect(mcp.status).toBe('new')
    expect(hook.status).toBe('add')
    const merged = JSON.parse(hook.after)
    expect(merged.mcpServers.nexgraph).toEqual({ command: cmd.command, args: ['mcp', '--project', root, '--data-dir', dataDir],
      env: { PYTHONPATH: '', PYTHONHOME: '', PYTHONNOUSERSITE: '1' } })
    expect(merged.hooks.BeforeTool[0].hooks[0].command).toContain('hook-guard gemini')
    applyPlatform('gemini', root, cmd, dataDir)
    expect(JSON.parse(readFileSync(join(root, '.gemini', 'settings.json'), 'utf8'))).toEqual(merged)
  })

  it.skipIf(process.platform === 'win32')('đường dẫn có $, `, " không bị shell diễn giải trong lệnh hook', () => {
    const evil = join(root, 'x$(touch p)`id`"q')
    mkdirSync(evil)
    const hook = planPlatform('claude', evil, cmd, dataDir).find((p) => p.part === 'hook')!
    const command: string = JSON.parse(hook.after).hooks.PreToolUse[0].hooks[0].command
    const argv = execFileSync('sh', ['-c', `printf '%s\\n' ${command.replace('/Apps/NexGraph/engine ', '')}`], { encoding: 'utf8' }).split('\n')
    expect(argv).toContain(evil)
    expect(argv).toContain(dataDir)
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
      command: `/Apps/NexGraph/engine hook-guard read --project ${/[\s\\]/.test(root) ? `"${root}"` : root} --data-dir "/data dir" --strict` })
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

  it('chuẩn hoá đường dẫn gốc kiểu Windows giống macOS', () => {
    const sample = (r: string, url: string, quoted: string) => JSON.stringify({
      args: ['mcp', '--project', r], command: `/e hook-guard read --project ${quoted} --data-dir "/data dir"`, plugin: [`${url}/.kilo/plugins/nexgraph.js`]
    }, null, 2) + `\nargs = [${JSON.stringify(r)}]\n`
    const win = 'C:\\Users\\Tinh\\AppData\\Local\\Temp\\ng-plat-1'
    const mac = '/private/var/folders/x/T/ng-plat-1'
    expect(norm(sample(win, 'file:///C:/Users/Tinh/AppData/Local/Temp/ng-plat-1', `"${win}"`), win, 'file:///C:/Users/Tinh/AppData/Local/Temp/ng-plat-1'))
      .toBe(norm(sample(mac, `file://${mac}`, mac), mac, `file://${mac}`))
  })

  it('hook của người dùng nằm chung nhóm với hook NexGraph được giữ khi ghi lại và khi gỡ', () => {
    for (const [agent, rel] of [['claude', '.claude/settings.json'], ['codebuddy', '.codebuddy/settings.json'], ['gemini', '.gemini/settings.json']] as const) {
      const dir = realpathSync.native(mkdtempSync(join(tmpdir(), `ng-plat-mix-${agent}-`)))
      applyPlatform(agent, dir, cmd, dataDir)
      const file = join(dir, rel)
      const settings = JSON.parse(readFileSync(file, 'utf8'))
      const event = Object.keys(settings.hooks)[0]
      const logger = { type: 'command', command: 'my-audit-logger' }
      settings.hooks[event][0].hooks.push(logger)
      writeFileSync(file, JSON.stringify(settings))
      applyPlatform(agent, dir, cmd, dataDir, { strict: true })
      const hasLogger = (f: string) => JSON.stringify(JSON.parse(readFileSync(f, 'utf8'))).includes('my-audit-logger')
      expect(hasLogger(file), agent).toBe(true)
      expect(planPlatform(agent, dir, cmd, dataDir, { strict: true }).every((p) => p.status === 'up_to_date'), agent).toBe(true)
      applyUninstall(agent, dir, cmd, dataDir)
      const left = JSON.parse(readFileSync(file, 'utf8')).hooks[event]
      expect(left, agent).toEqual([{ ...settings.hooks[event][0], hooks: [logger] }])
    }
  })

  it('JSON có BOM vẫn đọc được', () => {
    writeFileSync(join(root, '.mcp.json'), '\uFEFF{"mcpServers":{"other":{"command":"o"}}}')
    const p = planPlatform('claude', root, cmd, dataDir).find((x) => x.part === 'mcp')!
    expect(p.status).toBe('add')
    expect(Object.keys(JSON.parse(p.after).mcpServers)).toEqual(['other', 'nexgraph'])
  })

  it('tệp CRLF: khối chèn vào cũng dùng CRLF; gỡ trả lại đúng tệp cũ', () => {
    const file = join(root, 'AGENTS.md')
    writeFileSync(file, 'Đầu.\r\nCuối.\r\n')
    applyPlatform('agents', root, cmd, dataDir)
    const text = readFileSync(file, 'utf8')
    expect(text.replace(/\r\n/g, '')).not.toContain('\n')
    expect(planPlatform('agents', root, cmd, dataDir).every((p) => p.status === 'up_to_date')).toBe(true)
    applyUninstall('agents', root, cmd, dataDir)
    expect(readFileSync(file, 'utf8')).toBe('Đầu.\r\nCuối.\r\n')
  })

  it('tệp JSON gốc là {} thì Gỡ giữ lại tệp {}', () => {
    writeFileSync(join(root, '.mcp.json'), '{}')
    applyPlatform('claude', root, cmd, dataDir)
    expect(planUninstall('claude', root, cmd, dataDir).find((p) => p.part === 'mcp')).toMatchObject({ status: 'remove', after: '{}\n' })
    applyUninstall('claude', root, cmd, dataDir)
    expect(readFileSync(join(root, '.mcp.json'), 'utf8')).toBe('{}\n')
  })
})
