import { existsSync, mkdirSync, readFileSync, realpathSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import type { AgentId, IntegrationOptions, IntegrationPart, IntegrationPlan } from '../shared/integration-types'
import { skillMarkdown } from './agent/skill'
import type { EngineCommand } from './engine/launcher'
import { resolveInside } from './fs/project-fs'

export type { AgentId, IntegrationOptions, IntegrationPlan }

type Json = Record<string, unknown>
type Status = IntegrationPlan['status']
interface Ctx { root: string; cmd: EngineCommand; dataDir: string; strict: boolean }
/** Kết quả tính trên nội dung hiện tại của tệp (null = chưa có tệp). */
interface Result { status: Status; after: string; snippet: string }
interface Part {
  part: IntegrationPart
  rel: (root: string) => string
  install: (text: string | null, ctx: Ctx) => Result
  remove: (text: string | null, ctx: Ctx) => Result
}

const OPENCODE_CONFIG_PATHS = [join('.opencode', 'opencode.jsonc'), join('.opencode', 'opencode.json'), 'opencode.jsonc', 'opencode.json']
const openCodeConfigRel = (root: string): string => OPENCODE_CONFIG_PATHS.find((path) => existsSync(join(root, path))) ?? 'opencode.json'

const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v)
const tomlStr = (s: string): string => JSON.stringify(s) // JSON basic string là TOML basic string hợp lệ với đường dẫn thường gặp
const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`
const invalid = (snippet: string): Result => ({ status: 'invalid', after: '', snippet })
const same = (text: string, snippet: string): Result => ({ status: 'up_to_date', after: text, snippet })
const del = (snippet: string): Result => ({ status: 'delete', after: '', snippet })
/** null khi không phải object JSON (hỏng, có chú thích, mảng): không đoán, không ghi. */
const parseObject = (text: string | null): Json | null => {
  if (text === null || text.trim() === '') return {}
  try {
    const v: unknown = JSON.parse(text.replace(/^\uFEFF/, '')) // BOM do trình soạn thảo trên Windows thêm vào
    return isObject(v) ? v : null
  } catch {
    return null
  }
}
/** Ghi lại phần còn lại sau khi bỏ mục NexGraph. Tệp còn rỗng vẫn giữ là {}: không phân biệt được với tệp {} người dùng có từ trước. */
const rewrite = (root: Json, snippet: string): Result => ({ status: 'remove', after: json(root), snippet })
const mcpArgs = (c: Ctx): string[] => [...c.cmd.args, 'mcp', '--project', c.root, '--data-dir', c.dataDir]

// ---- MCP ------------------------------------------------------------------------------------------------
// Đối chiếu nguồn chính thức và giới hạn schema: docs/install-notes.md §Tích hợp trợ lý AI.
type McpAgent = 'claude' | 'cursor' | 'vscode' | 'opencode' | 'codex' | 'gemini' | 'kiro'
const MCP_JSON: Record<Exclude<McpAgent, 'codex'>, { rel: (root: string) => string; key: string; entry: (cmd: EngineCommand, args: string[]) => Json }> = {
  claude: { rel: () => '.mcp.json', key: 'mcpServers', entry: (c, a) => ({ type: 'stdio', command: c.command, args: a }) },
  cursor: { rel: () => join('.cursor', 'mcp.json'), key: 'mcpServers', entry: (c, a) => ({ type: 'stdio', command: c.command, args: a }) },
  vscode: { rel: () => join('.vscode', 'mcp.json'), key: 'servers', entry: (c, a) => ({ type: 'stdio', command: c.command, args: a }) },
  opencode: { rel: openCodeConfigRel, key: 'mcp', entry: (c, a) => ({ type: 'local', command: [c.command, ...a] }) },
  gemini: { rel: () => join('.gemini', 'settings.json'), key: 'mcpServers', entry: (c, a) => ({ command: c.command, args: a }) },
  kiro: { rel: () => join('.kiro', 'settings', 'mcp.json'), key: 'mcpServers', entry: (c, a) => ({ command: c.command, args: a }) }
}

function mcpJsonPart(agent: Exclude<McpAgent, 'codex'>): Part {
  const spec = MCP_JSON[agent]
  const snippetFor = (entry: Json, nested: boolean): string =>
    JSON.stringify({ [spec.key]: nested ? { servers: { nexgraph: entry } } : { nexgraph: entry } }, null, 2)
  // OpenCode V2 đặt server trong mcp.servers. Giữ cấu trúc V1 khi tệp đã có các server dạng trực tiếp.
  const layout = (settings: Json | undefined): { nested: boolean } => ({
    nested: agent === 'opencode' && !(settings?.servers === undefined && Object.keys(settings ?? {}).some((key) => key !== 'timeout'))
  })
  return {
    part: 'mcp',
    rel: spec.rel,
    install(text, c) {
      const entry = spec.entry(c.cmd, mcpArgs(c))
      const defaultSnippet = snippetFor(entry, agent === 'opencode')
      if (text === null) return { status: 'new', after: `${defaultSnippet}\n`, snippet: defaultSnippet }
      const root = parseObject(text)
      if (!root) return invalid(defaultSnippet)
      const settings = root[spec.key]
      if (settings !== undefined && !isObject(settings)) return invalid(defaultSnippet)
      const { nested } = layout(settings)
      const snippet = snippetFor(entry, nested)
      const container = nested ? settings?.servers : settings
      if (container !== undefined && !isObject(container)) return invalid(snippet)
      const current = container?.nexgraph
      const legacyNexgraph = nested ? settings?.nexgraph : undefined
      if (legacyNexgraph === undefined && isDeepStrictEqual(current, entry)) return same(text, snippet)
      // Gán vào đối tượng có sẵn: khoá cũ giữ nguyên giá trị và thứ tự, nexgraph thêm cuối (hoặc thay tại chỗ).
      const servers = { ...container, nexgraph: entry }
      root[spec.key] = nested ? { ...settings, servers } : servers
      // Cấu hình lẫn hai dạng chỉ giữ một mục NexGraph để OpenCode không nhận cùng server hai lần.
      if (legacyNexgraph !== undefined) delete (root[spec.key] as Json).nexgraph
      return { status: current === undefined && legacyNexgraph === undefined ? 'add' : 'update', after: json(root), snippet }
    },
    remove(text, c) {
      const snippet = snippetFor(spec.entry(c.cmd, mcpArgs(c)), agent === 'opencode')
      if (text === null) return same('', snippet)
      const root = parseObject(text)
      const settings = root?.[spec.key]
      if (!root || (settings !== undefined && !isObject(settings))) return invalid(snippet)
      if (!isObject(settings)) return same(text, snippet)
      const holders = [settings, ...(isObject(settings.servers) ? [settings.servers] : [])].filter((h) => 'nexgraph' in h)
      if (holders.length === 0) return same(text, snippet)
      for (const h of holders) delete h.nexgraph
      if (isObject(settings.servers) && Object.keys(settings.servers).length === 0) delete settings.servers
      if (Object.keys(settings).length === 0) delete root[spec.key]
      return rewrite(root, snippet)
    }
  }
}

/** Codex đọc TOML; NexGraph chỉ tạo `.codex/config.toml` khi chưa có, không phân tích/sửa TOML hiện có (nguồn: install-notes.md). */
const codexPart: Part = {
  part: 'mcp',
  rel: () => join('.codex', 'config.toml'),
  install(text, c) {
    const snippet = `[mcp_servers.nexgraph]\ncommand = ${tomlStr(c.cmd.command)}\nargs = [${mcpArgs(c).map(tomlStr).join(', ')}]\n`
    return text === null ? { status: 'new', after: snippet, snippet } : text === snippet ? same(text, snippet) : invalid(snippet)
  },
  remove(text, c) {
    const snippet = codexPart.install(null, c).snippet
    if (text === null || !text.includes('[mcp_servers.nexgraph]')) return same(text ?? '', snippet)
    return text === snippet ? del(snippet) : invalid(snippet) // tệp có thêm mục khác: gỡ bằng tay
  }
}

// ---- Khối "hỏi graph trước" và tệp quy tắc ----------------------------------------------------------------
const rulesBody = (): string => skillMarkdown().replace(/^---\n[\s\S]*?\n---\n/, '').trimEnd()
/** Khối giữa hai marker trong tệp dùng chung (AGENTS.md, CLAUDE.md, GEMINI.md…): skillMarkdown bỏ frontmatter. */
export function agentsMdBlock(): string {
  return `<!-- nexgraph:start -->\n${rulesBody()}\n<!-- nexgraph:end -->\n`
}
const BLOCK_RE = /<!-- nexgraph:start -->\r?\n[\s\S]*?<!-- nexgraph:end -->\r?\n?/

function blockPart(rel: string): Part {
  return {
    part: 'rules',
    rel: () => rel,
    install(text) {
      if (text === null) return { status: 'new', after: agentsMdBlock(), snippet: agentsMdBlock() }
      // Chỉ thay khối giữa hai dòng đánh dấu; phần ngoài khối giữ nguyên từng byte. Khối theo kiểu xuống dòng của tệp.
      const eol = text.includes('\r\n') ? '\r\n' : '\n'
      const content = agentsMdBlock().replace(/\n/g, eol)
      const has = BLOCK_RE.test(text)
      const after = has ? text.replace(BLOCK_RE, () => content) : `${text.endsWith('\n') || text === '' ? text : `${text}${eol}`}${content}`
      return { status: after === text ? 'up_to_date' : has ? 'update' : 'add', after, snippet: content }
    },
    remove(text) {
      const content = agentsMdBlock()
      if (text === null || !BLOCK_RE.test(text)) return same(text ?? '', content)
      const after = text.replace(BLOCK_RE, '')
      return after.trim() === '' ? del(content) : { status: 'remove', after, snippet: content }
    }
  }
}

/** Tệp mang tên nexgraph do NexGraph sở hữu hoàn toàn (quy tắc .mdc, steering, plugin): ghi đè khi khác, gỡ thì xoá. */
function ownedPart(part: IntegrationPart, rel: string, content: () => string): Part {
  return {
    part,
    rel: () => rel,
    install(text) {
      const c = content()
      return text === null ? { status: 'new', after: c, snippet: c } : text === c ? same(text, c) : { status: 'update', after: c, snippet: c }
    },
    remove: (text) => (text === null ? same('', content()) : del(content()))
  }
}
const withFrontmatter = (front: string) => (): string => `---\n${front}\n---\n\n${rulesBody().trimStart()}\n`

// ---- Skill ----------------------------------------------------------------------------------------------
const SKILL_NAME_RE = /^---\r?\n(?:.*\r?\n)*?name:\s*nexgraph\s*\r?\n/
function skillPart(dir: string): Part {
  return {
    part: 'skill',
    rel: () => join(dir, 'nexgraph', 'SKILL.md'),
    install(text) {
      const content = skillMarkdown()
      if (text === null) return { status: 'new', after: content, snippet: content }
      // SKILL.md đã có nội dung khác: không ghi đè skill của người dùng (spec §5.5), giữ trạng thái invalid để dán tay.
      return text === content ? same(text, content) : invalid(content)
    },
    remove(text) {
      const content = skillMarkdown()
      if (text === null) return same('', content)
      return SKILL_NAME_RE.test(text) ? del(content) : invalid(content)
    }
  }
}

// ---- Hook nhắc dùng graph ---------------------------------------------------------------------------------
// Bọc "..." (sh, Git Bash, cmd đều hiểu). POSIX: escape $ ` " \ để đường dẫn không bị shell diễn giải; Windows giữ \ của đường dẫn.
const sh = (s: string): string => !/[\s"'$`\\&|;<>()*?]/.test(s) ? s
  : `"${process.platform === 'win32' ? s : s.replace(/[$`"\\]/g, '\\$&')}"`
const guardCommand = (c: Ctx, kind: string, strict: boolean): string =>
  [c.cmd.command, ...c.cmd.args, 'hook-guard', kind, '--project', c.root, '--data-dir', c.dataDir].map(sh).join(' ') + (strict ? ' --strict' : '')
/** Lệnh của NexGraph: hook-guard có --project (lệnh của công cụ khác không có). */
const isOurCommand = (h: unknown): boolean =>
  isObject(h) && typeof h.command === 'string' && h.command.includes(' hook-guard ') && h.command.includes(' --project ')
const hasOurs = (list: unknown[]): boolean => list.some((g) => isObject(g) && Array.isArray(g.hooks) && g.hooks.some(isOurCommand))
/** Bỏ từng lệnh NexGraph, giữ lệnh khác cùng nhóm; nhóm chỉ bị bỏ khi không còn lệnh nào (như vendor `_strip_graphify_hooks`). */
const stripOurs = (list: unknown[]): unknown[] => list.flatMap((g) => {
  if (!isObject(g) || !Array.isArray(g.hooks) || !g.hooks.some(isOurCommand)) return [g]
  const kept = g.hooks.filter((h) => !isOurCommand(h))
  return kept.length ? [{ ...g, hooks: kept }] : []
})

function hooksPart(rel: string, event: 'PreToolUse' | 'BeforeTool', groups: (c: Ctx) => Json[]): Part {
  const snippetOf = (c: Ctx): string => JSON.stringify({ hooks: { [event]: groups(c) } }, null, 2)
  const load = (text: string | null): { root: Json; list: unknown[] } | null => {
    const root = parseObject(text)
    const hooks = root?.hooks
    if (!root || (hooks !== undefined && !isObject(hooks))) return null
    const list = isObject(hooks) ? hooks[event] : undefined
    if (list !== undefined && !Array.isArray(list)) return null
    return { root, list: list ?? [] }
  }
  return {
    part: 'hook',
    rel: () => rel,
    install(text, c) {
      const snippet = snippetOf(c)
      const loaded = load(text)
      if (!loaded) return invalid(snippet)
      const { root, list } = loaded
      const next = [...stripOurs(list), ...groups(c)]
      if (text !== null && isDeepStrictEqual(next, list)) return same(text, snippet)
      root.hooks = { ...(root.hooks as Json | undefined), [event]: next }
      return { status: text === null ? 'new' : hasOurs(list) ? 'update' : 'add', after: json(root), snippet }
    },
    remove(text, c) {
      const snippet = snippetOf(c)
      if (text === null) return same('', snippet)
      const loaded = load(text)
      if (!loaded) return invalid(snippet)
      const { root, list } = loaded
      if (!hasOurs(list)) return same(text, snippet)
      const hooks = root.hooks as Json
      const kept = stripOurs(list)
      if (kept.length) hooks[event] = kept
      else delete hooks[event]
      if (Object.keys(hooks).length === 0) delete root.hooks
      return rewrite(root, snippet)
    }
  }
}
// Claude Code và CodeBuddy: matcher và timeout giống bản vendor (install.py `_claude_pretooluse_hooks`).
const preToolUse = (c: Ctx): Json[] => [
  { matcher: 'Bash|Grep', hooks: [{ type: 'command', command: guardCommand(c, 'search', c.strict), timeout: 10 }] },
  { matcher: 'Read|Glob', hooks: [{ type: 'command', command: guardCommand(c, 'read', c.strict), timeout: 10 }] }
]
const beforeTool = (c: Ctx): Json[] => [{ matcher: 'read_file|list_directory', hooks: [{ type: 'command', command: guardCommand(c, 'gemini', false) }] }]

// Plugin nhắc một lần mỗi phiên trước lệnh shell đầu tiên. Không dùng dấu ` hay $(...) trong lời nhắc: nó nằm trong echo "...".
const REMINDER = 'echo "[nexgraph] Du an co do thi tri thuc NexGraph. Goi tool MCP query_graph hoac get_context cua server nexgraph de biet tep va dong can xem truoc khi grep hay doc tep tho." ; '
const OPENCODE_PLUGIN = `// NexGraph OpenCode plugin
// OpenCode 2 đọc id và setup() của default export; OpenCode 1 đọc server(). Mỗi bản bỏ qua hàm của bản kia.
// ';' thay cho '&&' vì Windows PowerShell 5.1 không nhận '&&'.
const REMINDER = ${JSON.stringify(REMINDER)};
const reminded = (globalThis.__nexgraphReminded ??= new Set());

export default {
  id: "nexgraph",
  async setup(ctx) {
    await ctx.tool.hook("execute.before", (event) => {
      if (event.tool !== "shell" || typeof event.input?.command !== "string" || reminded.has(event.sessionID)) return;
      event.input = { ...event.input, command: REMINDER + event.input.command };
      reminded.add(event.sessionID);
    });
  },
  async server({ directory }) {
    return {
      "tool.execute.before": async (input, output) => {
        if (input.tool !== "bash" || typeof output.args?.command !== "string" || reminded.has(directory)) return;
        output.args.command = REMINDER + output.args.command;
        reminded.add(directory);
      },
    };
  },
};
`
const KILO_PLUGIN = `// NexGraph Kilo plugin
// ';' thay cho '&&' vì Windows PowerShell 5.1 không nhận '&&'.
const REMINDER = ${JSON.stringify(REMINDER)};

export const NexgraphPlugin = async () => {
  let reminded = false;
  return {
    "tool.execute.before": async (input, output) => {
      if (reminded || input.tool !== "bash" || typeof output.args?.command !== "string") return;
      output.args.command = REMINDER + output.args.command;
      reminded = true;
    },
  };
};
`
const KILO_PLUGIN_REL = join('.kilo', 'plugins', 'nexgraph.js')
/** Kilo nạp plugin theo danh sách `plugin` trong `.kilo/kilo.json` (URI tệp tuyệt đối, như bản vendor). */
const kiloRegisterPart: Part = {
  part: 'hook',
  rel: () => join('.kilo', 'kilo.json'),
  install(text, c) {
    const entry = pathToFileURL(resolveInside(c.root, KILO_PLUGIN_REL)).href
    const snippet = JSON.stringify({ plugin: [entry] }, null, 2)
    const root = parseObject(text)
    if (!root || (root.plugin !== undefined && !Array.isArray(root.plugin))) return invalid(snippet)
    const list = (root.plugin as unknown[] | undefined) ?? []
    if (text !== null && list.includes(entry)) return same(text, snippet)
    root.plugin = [...list, entry]
    return { status: text === null ? 'new' : 'add', after: json(root), snippet }
  },
  remove(text, c) {
    const entry = pathToFileURL(resolveInside(c.root, KILO_PLUGIN_REL)).href
    const snippet = JSON.stringify({ plugin: [entry] }, null, 2)
    if (text === null) return same('', snippet)
    const root = parseObject(text)
    if (!root || (root.plugin !== undefined && !Array.isArray(root.plugin))) return invalid(snippet)
    const list = (root.plugin as unknown[] | undefined) ?? []
    if (!list.includes(entry)) return same(text, snippet)
    const kept = list.filter((p) => p !== entry)
    if (kept.length) root.plugin = kept
    else delete root.plugin
    return rewrite(root, snippet)
  }
}

// ---- Bảng nền tảng ----------------------------------------------------------------------------------------
// Theo `_project_install` của bản vendor (install.py:2187). AGENTS.md và .agents/skills dùng chung giữa nhiều nền tảng.
const AGENTS_MD = blockPart('AGENTS.md')
const agentsMd = (skillDir: string): Part[] => [AGENTS_MD, skillPart(skillDir)]
const PLATFORMS: Record<AgentId, Part[]> = {
  claude: [mcpJsonPart('claude'), blockPart('CLAUDE.md'), skillPart(join('.claude', 'skills')), hooksPart(join('.claude', 'settings.json'), 'PreToolUse', preToolUse)],
  codex: [codexPart, ...agentsMd(join('.codex', 'skills'))],
  gemini: [mcpJsonPart('gemini'), blockPart('GEMINI.md'), skillPart(join('.gemini', 'skills')), hooksPart(join('.gemini', 'settings.json'), 'BeforeTool', beforeTool)],
  cursor: [mcpJsonPart('cursor'), ownedPart('rules', join('.cursor', 'rules', 'nexgraph.mdc'), withFrontmatter('description: Đồ thị tri thức NexGraph của dự án\nalwaysApply: true'))],
  opencode: [mcpJsonPart('opencode'), ...agentsMd(join('.opencode', 'skills')), ownedPart('hook', join('.opencode', 'plugins', 'nexgraph.js'), () => OPENCODE_PLUGIN)],
  kilo: [...agentsMd(join('.kilo', 'skills')), ownedPart('hook', KILO_PLUGIN_REL, () => KILO_PLUGIN), kiloRegisterPart],
  aider: agentsMd(join('.aider')),
  amp: agentsMd(join('.agents', 'skills')),
  vscode: [mcpJsonPart('vscode'), blockPart(join('.github', 'copilot-instructions.md')), skillPart(join('.copilot', 'skills'))],
  claw: agentsMd(join('.openclaw', 'skills')),
  droid: agentsMd(join('.factory', 'skills')),
  trae: agentsMd(join('.trae', 'skills')),
  'trae-cn': agentsMd(join('.trae-cn', 'skills')),
  antigravity: [ownedPart('rules', join('.agents', 'rules', 'nexgraph.md'), withFrontmatter('trigger: always_on\ndescription: Đồ thị tri thức NexGraph của dự án')), skillPart(join('.agents', 'skills'))],
  hermes: agentsMd(join('.hermes', 'skills')),
  kiro: [mcpJsonPart('kiro'), ownedPart('rules', join('.kiro', 'steering', 'nexgraph.md'), withFrontmatter('inclusion: always')), skillPart(join('.kiro', 'skills'))],
  pi: [skillPart(join('.pi', 'skills'))],
  devin: [ownedPart('rules', join('.windsurf', 'rules', 'nexgraph.md'), withFrontmatter('trigger: always_on')), skillPart(join('.devin', 'skills'))],
  codebuddy: [blockPart('CODEBUDDY.md'), skillPart(join('.codebuddy', 'skills')), hooksPart(join('.codebuddy', 'settings.json'), 'PreToolUse', preToolUse)],
  kimi: [skillPart(join('.kimi', 'skills'))],
  agents: agentsMd(join('.agents', 'skills'))
}

/**
 * Tính tuần tự qua lớp phủ trong bộ nhớ: hai phần cùng một tệp (MCP + hook của Gemini) cho xem trước khớp kết quả cuối.
 * Plan không ghi gì; resolveInside chặn mọi symlink (kể cả treo, kể cả symlink trung gian) thoát khỏi dự án.
 */
function plan(agent: AgentId, parts: Part[], ctx: Ctx, mode: 'install' | 'remove'): IntegrationPlan[] {
  const overlay = new Map<string, string | null>()
  return parts.map((p) => {
    const path = resolveInside(ctx.root, p.rel(ctx.root))
    const text = overlay.has(path) ? overlay.get(path)! : existsSync(path) ? readFileSync(path, 'utf8') : null
    const r = p[mode](text, ctx)
    if (r.status !== 'up_to_date' && r.status !== 'invalid') overlay.set(path, r.status === 'delete' ? null : r.after)
    return { agent, part: p.part, path, exists: text !== null, ...r }
  })
}

/** Dọn thư mục rỗng còn lại sau khi xoá tệp (vd. `.claude/skills/nexgraph`), dừng ở gốc dự án hoặc thư mục còn tệp. */
function removeEmptyParents(path: string, root: string): void {
  const top = realpathSync.native(root) // đường dẫn trong plan đã là realpath (resolveInside)
  for (let dir = dirname(path); dir !== top && dir.startsWith(top + sep); dir = dirname(dir)) {
    try { rmdirSync(dir) } catch { return } // thư mục còn tệp khác
  }
}

/** Ghi theo thứ tự; phần invalid bị bỏ qua (dán tay), không chặn các phần khác. Tính lại từ đĩa ngay lúc ghi. */
function write(plans: IntegrationPlan[], root: string): IntegrationPlan[] {
  for (const p of plans) {
    if (p.status === 'up_to_date' || p.status === 'invalid') continue
    if (p.status === 'delete') {
      rmSync(p.path, { force: true })
      removeEmptyParents(p.path, root)
      continue
    }
    mkdirSync(dirname(p.path), { recursive: true })
    writeFileSync(p.path, p.after)
  }
  return plans
}

const partsOf = (agent: AgentId): Part[] => {
  // agent đến từ renderer qua IPC: tên lạ thì báo lỗi rõ thay vì TypeError.
  if (!Object.hasOwn(PLATFORMS, agent)) throw Object.assign(new Error(`Không có nền tảng ${String(agent)}`), { code: 'unknown_agent' })
  return PLATFORMS[agent]
}
const ctxOf = (root: string, cmd: EngineCommand, dataDir: string, opts?: IntegrationOptions): Ctx => ({ root, cmd, dataDir, strict: !!opts?.strict })
export const planPlatform = (agent: AgentId, root: string, cmd: EngineCommand, dataDir: string, opts?: IntegrationOptions): IntegrationPlan[] =>
  plan(agent, partsOf(agent), ctxOf(root, cmd, dataDir, opts), 'install')
export const applyPlatform = (agent: AgentId, root: string, cmd: EngineCommand, dataDir: string, opts?: IntegrationOptions): IntegrationPlan[] =>
  write(planPlatform(agent, root, cmd, dataDir, opts), root)
export const planUninstall = (agent: AgentId, root: string, cmd: EngineCommand, dataDir: string): IntegrationPlan[] =>
  plan(agent, partsOf(agent), ctxOf(root, cmd, dataDir), 'remove')
export const applyUninstall = (agent: AgentId, root: string, cmd: EngineCommand, dataDir: string): IntegrationPlan[] =>
  write(planUninstall(agent, root, cmd, dataDir), root)

/** Chỉ phần cấu hình MCP của một nền tảng (giữ cho các test và lệnh sao chép cấu hình cũ). */
export function planIntegration(agent: McpAgent, projectPath: string, cmd: EngineCommand, dataDir: string): IntegrationPlan {
  return plan(agent, [agent === 'codex' ? codexPart : mcpJsonPart(agent)], ctxOf(projectPath, cmd, dataDir), 'install')[0]
}

export function applyIntegration(agent: McpAgent, projectPath: string, cmd: EngineCommand, dataDir: string): IntegrationPlan {
  const p = planIntegration(agent, projectPath, cmd, dataDir)
  if (p.status === 'invalid') throw Object.assign(new Error('Tệp cấu hình hiện có không phải JSON hợp lệ'), { code: 'invalid_config' })
  return write([p], projectPath)[0]
}
