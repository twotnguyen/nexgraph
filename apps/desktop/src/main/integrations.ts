import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { AgentId, IntegrationPlan, SkillTarget } from '../shared/integration-types'
import { skillMarkdown } from './agent/skill'
import type { EngineCommand } from './engine/launcher'
import { resolveInside } from './fs/project-fs'

export type { AgentId, IntegrationPlan, SkillTarget }

type Json = Record<string, unknown>
const OPENCODE_CONFIG_PATHS = [join('.opencode', 'opencode.jsonc'), join('.opencode', 'opencode.json'), 'opencode.jsonc', 'opencode.json']
const openCodeConfigFile = (root: string): string =>
  resolveInside(root, OPENCODE_CONFIG_PATHS.find((path) => existsSync(join(root, path))) ?? 'opencode.json')

// Đối chiếu nguồn chính thức và giới hạn schema: docs/install-notes.md §Tích hợp trợ lý AI.
const SPECS: Record<'claude' | 'cursor' | 'vscode' | 'opencode', { file: (root: string) => string; key: string; entry: (cmd: EngineCommand, args: string[]) => Json }> = {
  claude: { file: (r) => join(r, '.mcp.json'), key: 'mcpServers', entry: (c, a) => ({ type: 'stdio', command: c.command, args: a }) },
  cursor: { file: (r) => join(r, '.cursor', 'mcp.json'), key: 'mcpServers', entry: (c, a) => ({ type: 'stdio', command: c.command, args: a }) },
  vscode: { file: (r) => join(r, '.vscode', 'mcp.json'), key: 'servers', entry: (c, a) => ({ type: 'stdio', command: c.command, args: a }) },
  opencode: {
    file: openCodeConfigFile,
    key: 'mcp',
    entry: (c, a) => ({ type: 'local', command: [c.command, ...a] })
  }
}

const invalid = (agent: AgentId, path: string, snippet: string): IntegrationPlan => ({ agent, path, exists: true, status: 'invalid', after: '', snippet })
const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v)
const tomlStr = (s: string): string => JSON.stringify(s) // JSON basic string là TOML basic string hợp lệ với đường dẫn thường gặp

/** Nội dung block AGENTS.md: skillMarkdown bỏ frontmatter (frontmatter chỉ có nghĩa với SKILL.md). */
export function agentsMdBlock(): string {
  const body = skillMarkdown().replace(/^---\n[\s\S]*?\n---\n/, '')
  return `<!-- nexgraph:start -->\n${body.trimEnd()}\n<!-- nexgraph:end -->\n`
}
const AGENTS_BLOCK_RE = /<!-- nexgraph:start -->\r?\n[\s\S]*?<!-- nexgraph:end -->\r?\n?/

const SKILL_RELS: Record<SkillTarget, string> = { claude: '.claude/skills/nexgraph/SKILL.md', 'agents-md': 'AGENTS.md' }
const SKILL_CONTENT: Record<SkillTarget, () => string> = { claude: skillMarkdown, 'agents-md': agentsMdBlock }

export function planSkill(target: SkillTarget, projectPath: string): IntegrationPlan {
  // resolveInside chặn mọi symlink (kể cả treo, kể cả symlink trung gian) thoát khỏi dự án; tệp ghi vào realpath.
  const path = resolveInside(projectPath, SKILL_RELS[target])
  const agent: AgentId = target === 'claude' ? 'skill-claude' : 'agents-md'
  const content = SKILL_CONTENT[target]()
  if (!existsSync(path)) return { agent, path, exists: false, status: 'new', after: content, snippet: content }
  const text = readFileSync(path, 'utf8')
  if (text === content) return { agent, path, exists: true, status: 'up_to_date', after: text, snippet: content }
  if (target === 'agents-md') {
    // Chỉ thay khối giữa hai dòng đánh dấu; phần ngoài khối giữ nguyên từng byte (apply tính lại từ đĩa).
    const after = AGENTS_BLOCK_RE.test(text) ? text.replace(AGENTS_BLOCK_RE, () => content) : `${text.endsWith('\n') ? text : `${text}\n`}${content}`
    return { agent, path, exists: true, status: after === text ? 'up_to_date' : AGENTS_BLOCK_RE.test(text) ? 'update' : 'add', after, snippet: content }
  }
  // SKILL.md đã có nội dung khác: không ghi đè skill của người dùng (spec §5.5), giữ trạng thái invalid để dán tay.
  return invalid(agent, path, content)
}

export function applySkill(target: SkillTarget, projectPath: string): IntegrationPlan {
  const plan = planSkill(target, projectPath) // tính lại từ đĩa: tệp đổi từ lúc xem trước thì dùng nội dung mới nhất
  if (plan.status === 'invalid') throw Object.assign(new Error('Tệp SKILL.md đã có nội dung khác nên NexGraph không ghi đè'), { code: 'invalid_config' })
  if (plan.status === 'up_to_date') return plan
  mkdirSync(dirname(plan.path), { recursive: true })
  writeFileSync(plan.path, plan.after)
  return plan
}

/** Codex đọc TOML; NexGraph chỉ tạo `.codex/config.toml` khi chưa có, không phân tích/sửa TOML hiện có (nguồn: install-notes.md). */
function planCodex(projectPath: string, cmd: EngineCommand, dataDir: string): IntegrationPlan {
  const path = resolveInside(projectPath, join('.codex', 'config.toml'))
  const args = [...cmd.args, 'mcp', '--project', projectPath, '--data-dir', dataDir]
  const snippet = `[mcp_servers.nexgraph]\ncommand = ${tomlStr(cmd.command)}\nargs = [${args.map(tomlStr).join(', ')}]\n`
  if (!existsSync(path)) return { agent: 'codex', path, exists: false, status: 'new', after: snippet, snippet }
  return invalid('codex', path, snippet)
}

export function planIntegration(agent: AgentId, projectPath: string, cmd: EngineCommand, dataDir: string): IntegrationPlan {
  if (agent === 'codex') return planCodex(projectPath, cmd, dataDir)
  if (agent === 'skill-claude' || agent === 'agents-md') return planSkill(agent === 'skill-claude' ? 'claude' : 'agents-md', projectPath)
  const spec = SPECS[agent]
  const path = spec.file(projectPath)
  const entry = spec.entry(cmd, [...cmd.args, 'mcp', '--project', projectPath, '--data-dir', dataDir])
  const snippetFor = (nested: boolean): string =>
    JSON.stringify({ [spec.key]: nested ? { servers: { nexgraph: entry } } : { nexgraph: entry } }, null, 2)
  const defaultSnippet = snippetFor(agent === 'opencode')
  if (!existsSync(path)) {
    return { agent, path, exists: false, status: 'new', after: `${defaultSnippet}\n`, snippet: defaultSnippet }
  }
  const text = readFileSync(path, 'utf8')
  let root: unknown
  try {
    root = text.trim() === '' ? {} : JSON.parse(text)
  } catch {
    return invalid(agent, path, defaultSnippet) // JSON hỏng hoặc có chú thích: không đoán, không ghi
  }
  if (!isObject(root)) return invalid(agent, path, defaultSnippet)
  const settings = root[spec.key]
  if (settings !== undefined && !isObject(settings)) return invalid(agent, path, defaultSnippet)
  // V2 đặt server trong mcp.servers. Giữ cấu trúc V1 khi tệp đã có các server dạng trực tiếp.
  const legacy = agent === 'opencode' && settings?.servers === undefined &&
    Object.keys(settings ?? {}).some((key) => key !== 'timeout')
  const nested = agent === 'opencode' && !legacy
  const snippet = snippetFor(nested)
  const container = nested ? settings?.servers : settings
  if (container !== undefined && !isObject(container)) return invalid(agent, path, snippet)
  const current = container?.nexgraph
  const legacyNexgraph = nested ? settings?.nexgraph : undefined
  if (legacyNexgraph === undefined && isDeepStrictEqual(current, entry)) return { agent, path, exists: true, status: 'up_to_date', after: text, snippet }
  // Gán vào đối tượng có sẵn: khoá cũ giữ nguyên giá trị và thứ tự, nexgraph thêm cuối (hoặc thay tại chỗ).
  const servers = { ...container, nexgraph: entry }
  root[spec.key] = nested ? { ...settings, servers } : servers
  // Cấu hình lẫn hai dạng chỉ giữ một mục NexGraph để OpenCode không nhận cùng server hai lần.
  if (legacyNexgraph !== undefined) delete (root[spec.key] as Json).nexgraph
  return { agent, path, exists: true, status: current === undefined && legacyNexgraph === undefined ? 'add' : 'update', after: `${JSON.stringify(root, null, 2)}\n`, snippet }
}

export function applyIntegration(agent: AgentId, projectPath: string, cmd: EngineCommand, dataDir: string): IntegrationPlan {
  const plan = planIntegration(agent, projectPath, cmd, dataDir)
  if (plan.status === 'invalid') throw Object.assign(new Error('Tệp cấu hình hiện có không phải JSON hợp lệ'), { code: 'invalid_config' })
  if (plan.status === 'up_to_date') return plan
  mkdirSync(dirname(plan.path), { recursive: true })
  writeFileSync(plan.path, plan.after)
  return plan
}
