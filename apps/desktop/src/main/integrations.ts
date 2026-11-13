import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { AgentId, IntegrationPlan } from '../shared/integration-types'
import type { EngineCommand } from './engine/launcher'

export type { AgentId, IntegrationPlan }

type Json = Record<string, unknown>

// Định dạng theo code-review-graph `skills.py` (MIT, commit 29d8bd94312a02dc85b2f4e3e6c97ebe7e768fb8): PLATFORMS, _build_server_entry.
const SPECS: Record<AgentId, { file: (root: string) => string; key: string; entry: (cmd: EngineCommand, args: string[]) => Json }> = {
  claude: { file: (r) => join(r, '.mcp.json'), key: 'mcpServers', entry: (c, a) => ({ type: 'stdio', command: c.command, args: a }) },
  cursor: { file: (r) => join(r, '.cursor', 'mcp.json'), key: 'mcpServers', entry: (c, a) => ({ type: 'stdio', command: c.command, args: a }) },
  vscode: { file: (r) => join(r, '.vscode', 'mcp.json'), key: 'servers', entry: (c, a) => ({ type: 'stdio', command: c.command, args: a }) },
  opencode: {
    file: (r) => (existsSync(join(r, 'opencode.jsonc')) && !existsSync(join(r, 'opencode.json')) ? join(r, 'opencode.jsonc') : join(r, 'opencode.json')),
    key: 'mcp',
    entry: (c, a) => ({ type: 'local', command: [c.command, ...a] })
  }
}

const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v)
const invalid = (agent: AgentId, path: string, snippet: string): IntegrationPlan => ({ agent, path, exists: true, status: 'invalid', after: '', snippet })

export function planIntegration(agent: AgentId, projectPath: string, cmd: EngineCommand, dataDir: string): IntegrationPlan {
  const spec = SPECS[agent]
  const path = spec.file(projectPath)
  const entry = spec.entry(cmd, [...cmd.args, 'mcp', '--project', projectPath, '--data-dir', dataDir])
  const snippet = JSON.stringify({ [spec.key]: { nexgraph: entry } }, null, 2)
  if (!existsSync(path)) {
    return { agent, path, exists: false, status: 'new', after: `${snippet}\n`, snippet }
  }
  const text = readFileSync(path, 'utf8')
  let root: unknown
  try {
    root = text.trim() === '' ? {} : JSON.parse(text)
  } catch {
    return invalid(agent, path, snippet) // JSON hỏng hoặc có chú thích: không đoán, không ghi
  }
  if (!isObject(root)) return invalid(agent, path, snippet)
  const container = root[spec.key]
  if (container !== undefined && !isObject(container)) return invalid(agent, path, snippet)
  const current = container?.nexgraph
  if (current !== undefined && isDeepStrictEqual(current, entry)) return { agent, path, exists: true, status: 'up_to_date', after: text, snippet }
  // Gán vào đối tượng có sẵn: khoá cũ giữ nguyên giá trị và thứ tự, nexgraph thêm cuối (hoặc thay tại chỗ).
  root[spec.key] = { ...(container ?? {}), nexgraph: entry }
  return { agent, path, exists: true, status: current === undefined ? 'add' : 'update', after: `${JSON.stringify(root, null, 2)}\n`, snippet }
}

export function applyIntegration(agent: AgentId, projectPath: string, cmd: EngineCommand, dataDir: string): IntegrationPlan {
  const plan = planIntegration(agent, projectPath, cmd, dataDir)
  if (plan.status === 'invalid') throw Object.assign(new Error('Tệp cấu hình hiện có không phải JSON hợp lệ'), { code: 'invalid_config' })
  if (plan.status === 'up_to_date') return plan
  mkdirSync(dirname(plan.path), { recursive: true })
  writeFileSync(plan.path, plan.after)
  return plan
}
