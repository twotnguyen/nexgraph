import { relative, resolve, sep } from 'node:path'
import { existsSync, realpathSync } from 'node:fs'
import { Type } from 'typebox'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent' // chỉ kiểu: pi là ESM, không import tĩnh giá trị
import type { AgentMode } from '@nexgraph/contracts/agent-types'
import type { EngineApi } from '../../platform/engine/api'
import { FsError, isProtectedRel, readProjectFile, resolveInside, writeProjectFile } from '../../platform/project-fs'
import { TOOL_DEFS, runTool } from './tools'
import { toProjectRelative, type ApprovedWrite, type ApprovalGate, type WritePreview } from './approval'
import { registerScopedFileTools } from './file-tools'
import type { TaskExecution, ProcessInput } from './process-tools'
import { UserError } from '../../platform/user-error'

const GRAPH_TOOLS = TOOL_DEFS.map((t) => t.function.name)
export const ASK_TOOLS = ['read', 'grep', 'find', 'ls']
export const EDIT_TOOLS = [...ASK_TOOLS, 'edit', 'write', 'run_process']
const ALL_TOOLS = [...EDIT_TOOLS, ...GRAPH_TOOLS]
const ALLOWED = new Set(ALL_TOOLS)

// Hồ sơ trợ lý kiểu Wu: mỗi dự án có thể tắt bớt tool (ví dụ không cho chạy lệnh), áp dụng cho cả Pi và Gemini.
const disabledTools = new Map<string, ReadonlySet<string>>()
/** Tên mọi tool NexGraph cho trợ lý (để màn Hồ sơ liệt kê). */
export const allToolNames = (): string[] => [...ALL_TOOLS]
export function setDisabledTools(projectId: string, tools: unknown): void {
  if (!Array.isArray(tools) || tools.some((t) => typeof t !== 'string' || !ALLOWED.has(t))) throw new UserError('bad_param', 'Danh sách tool không hợp lệ')
  if (tools.length) disabledTools.set(projectId, new Set(tools as string[]))
  else disabledTools.delete(projectId)
}
export const getDisabledTools = (projectId: string): string[] => [...(disabledTools.get(projectId) ?? [])]
/** Tool được bật theo chế độ và hồ sơ của dự án. */
export const toolsFor = (mode: AgentMode, projectId?: string): string[] => {
  const off = projectId ? disabledTools.get(projectId) : undefined
  return [...(mode === 'edit' ? EDIT_TOOLS : ASK_TOOLS), ...GRAPH_TOOLS].filter((name) => !off?.has(name))
}

export type NexgraphToolCall = { toolName: string; toolCallId: string; input: unknown }
export type NexgraphToolGateResult = { block: true; reason: string } | undefined
/** Registration surface shared by Pi and the controlled Gemini MCP bridge. */
export interface NexgraphToolPort extends Pick<ExtensionAPI, 'registerTool'> {
  on(event: 'agent_start', callback: () => void): unknown
  on(event: 'tool_call', callback: (event: NexgraphToolCall) => Promise<NexgraphToolGateResult>): unknown
}
export type NexgraphToolDeps = {
  api: EngineApi
  projectId: string
  root: string
  gate: ApprovalGate
  getMode?: () => AgentMode
  getTask?: () => TaskExecution | null
  assertEditable?: (path: string) => void
  onCheckpoint?: (taskId: string) => void
  onWriteConflict?: (message: string) => void
}

export function createNexgraphExtension(deps: NexgraphToolDeps): (pi: ExtensionAPI) => void {
  return (pi) => registerNexgraphTools(pi, deps)
}

export function registerNexgraphTools(pi: NexgraphToolPort, deps: NexgraphToolDeps): void {
    for (const { function: f } of TOOL_DEFS) {
      pi.registerTool({
        name: f.name,
        label: f.name,
        description: f.description,
        parameters: Type.Unsafe(f.parameters),
        async execute(_id, params) {
          const text = await runTool(deps.api, deps.projectId, f.name, JSON.stringify(params))
          return { content: [{ type: 'text', text }], details: {} }
        }
      })
    }
    registerScopedFileTools(pi, deps.root, () => deps.api.aiSourceExcludes(deps.projectId))
    pi.registerTool({
      name: 'run_process', label: 'Chạy kiểm thử hoặc lệnh dự án',
      description: 'Run an installed executable with structured arguments in a project directory. Requires explicit task permission to execute repository code. Commands have bounded time and output. Use project test, typecheck, lint or build scripts. Never install, publish, push, upload or download.',
      parameters: Type.Object({
        executable: Type.String(), args: Type.Array(Type.String()),
        cwd: Type.Optional(Type.String({ description: 'Directory relative to project root, default .' })),
        timeoutMs: Type.Optional(Type.Number({ minimum: 100, maximum: 300000 }))
      }),
      async execute(id, input: ProcessInput) {
        if (deps.getMode?.() !== 'edit') throw new Error('Chế độ hiện tại chỉ cho phép đọc')
        const task = deps.getTask?.()
        if (!task) throw new Error('Không có tác vụ đang hoạt động')
        const result = await task.run(input, id)
        if (result.checkpointPaths?.length) deps.onCheckpoint?.(task.taskId)
        if (result.exitCode !== 0 || result.timedOut || result.cancelled) throw new Error(JSON.stringify(result))
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result }
      }
    })

    // Ghi đè write/edit dựng sẵn của pi (registry đặt tool extension LÊN TRÊN builtin cùng tên:
    // agent-session.ts _refreshToolRegistry — builtin trước, extension sau). Execute revalidate đúng
    // bản xem trước đã duyệt (gate gắn kèm quyết định) và ghi qua writeProjectFile nguyên tử của
    // NexGraph; pi không tự ghi qua fs.write nữa nên symlink tráo tệp sau preview không ghi ra ngoài.
    const approvedWrites = new Map<string, ApprovedWrite>()
    // Mỗi lượt agent_start là một generation: bản duyệt của lượt trước không còn giá trị.
    pi.on('agent_start', () => { approvedWrites.clear() })
    pi.registerTool({
      name: 'write',
      label: 'write',
      description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
      promptSnippet: 'Create or overwrite files',
      promptGuidelines: ['Use write only for new files or complete rewrites.'],
      parameters: Type.Object({
        path: Type.String({ description: 'Path to the file to write (relative or absolute)' }),
        content: Type.String({ description: 'Content to write to the file' })
      }),
      execute: (id, params) => executeApprovedWrite(deps, approvedWrites, id, params)
    })
    pi.registerTool({
      name: 'edit',
      label: 'edit',
      description: 'Make precise file edits with exact text replacement, including multiple disjoint edits in one call',
      promptSnippet: 'Make precise file edits with exact text replacement, including multiple disjoint edits in one call',
      promptGuidelines: [
        'Use edit for targeted changes. Batch changes to one file in a single call.',
        'Each edits[].oldText must exactly and uniquely match the original file. Keep matches short and non-overlapping; merge nearby changes without including large unchanged regions.'
      ],
      parameters: Type.Object({
        path: Type.String({ description: 'Path to the file to edit (relative or absolute)' }),
        edits: Type.Array(Type.Object({
          oldText: Type.String({ description: 'Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.' }),
          newText: Type.String({ description: 'Replacement text for this targeted edit.' })
        }), { description: 'One or more targeted replacements. Each edit is matched against the original file, not incrementally.' })
      }),
      execute: (id, params) => executeApprovedWrite(deps, approvedWrites, id, params)
    })

    // Dùng đúng allowlist cho cả tool do mô hình gọi trực tiếp.
    pi.on('tool_call', async (event) => {
      if (!ALLOWED.has(event.toolName)) return { block: true, reason: `Tool "${event.toolName}" không được phép dùng trong NexGraph` }
      if (disabledTools.get(deps.projectId)?.has(event.toolName)) return { block: true, reason: `Hồ sơ trợ lý đang dùng đã tắt tool "${event.toolName}"` }
      const writing = event.toolName === 'write' || event.toolName === 'edit'
      const duplicate = { block: true as const, reason: 'Mã thao tác ghi bị trùng' }
      if (writing && approvedWrites.has(event.toolCallId)) return duplicate
      try {
        if ((writing || event.toolName === 'run_process') && deps.getMode && deps.getMode() !== 'edit') {
          return { block: true, reason: 'Chế độ hiện tại chỉ cho phép đọc' }
        }
        if (PATH_TOOLS.has(event.toolName)) {
          const blocked = pinPath(deps.root, event.toolName, event.input)
          if (blocked) return { block: true, reason: blocked }
        }
        if (event.toolName !== 'write' && event.toolName !== 'edit') return
        const d = await deps.gate.check(event.toolName, event.input)
        if (!d.allow) return { block: true, reason: d.reason || 'Thao tác bị từ chối' }
        if (d.approved) {
          if (approvedWrites.has(event.toolCallId)) return duplicate
          if (approvedWrites.size >= 64) return { block: true, reason: 'Quá nhiều thao tác ghi đang chờ thực thi' }
          approvedWrites.set(event.toolCallId, d.approved)
        }
        return undefined
      } catch {
        return { block: true, reason: 'Cổng duyệt gặp lỗi nên thao tác bị từ chối' }
      }
    })
}

/**
 * Execute write/edit an toàn: consume đúng bản duyệt (toolCallId trùng với tool_call hook đã lưu),
 * revalidate tại thời điểm ghi — đường dẫn canonical sau realpath lại phải trùng đường dẫn đã duyệt
 * (kể cả khi tệp khác có cùng nội dung). Dịch vụ tệp đối chiếu phiên bản đã duyệt,
 * hoặc yêu cầu tệp vẫn chưa tồn tại, rồi ghi đúng `after` của bản xem trước.
 */
async function executeApprovedWrite(
  deps: { root: string; getMode?: () => AgentMode; getTask?: () => TaskExecution | null; assertEditable?: (path: string) => void; onCheckpoint?: (taskId: string) => void; onWriteConflict?: (message: string) => void },
  approvedWrites: Map<string, ApprovedWrite>,
  toolCallId: string,
  params: unknown
): Promise<{ content: { type: 'text'; text: string }[]; details: Record<string, never> }> {
  const snap = approvedWrites.get(toolCallId)
  if (!snap) throw new Error('Không còn bản duyệt khớp cho thao tác này; hãy chạy lại từ đầu')
  approvedWrites.delete(toolCallId)
  const p = (params as { path?: unknown } | null)?.path
  if (typeof p !== 'string') throw new Error('Thiếu đường dẫn hợp lệ')
  const assertApprovedPath = (rel: string) => {
    const abs = resolveInside(deps.root, rel)
    if (relative(realpathSync.native(deps.root), abs).split(sep).join('/') !== snap.path) {
      throw new FsError('conflict', 'Đường dẫn đã thay đổi từ lúc xem trước duyệt')
    }
  }
  try {
    if (deps.getMode && deps.getMode() !== 'edit') throw new Error('Chế độ hiện tại chỉ cho phép đọc')
    snap.assertCurrent()
    deps.assertEditable?.(snap.path)
    assertApprovedPath(toProjectRelative(deps.root, p))
    const assertCurrent = () => {
      snap.assertCurrent()
      deps.assertEditable?.(snap.path)
      assertApprovedPath(snap.path)
    }
    const task = deps.getTask?.()
    if (deps.getTask && !task) throw new Error('Không còn tác vụ đang hoạt động')
    if (task) {
      await task.checkpoints.write(snap, assertCurrent)
      deps.onCheckpoint?.(task.taskId)
    } else await writeProjectFile(deps.root, snap.path, snap.after, {
      eol: snap.file?.eol ?? '\n',
      bom: snap.file?.bom ?? false,
      expectedVersion: snap.file?.version ?? null
    }, { assertNotCancelled: assertCurrent })
  } catch (e) {
    if (e instanceof FsError && (e.code === 'conflict' || e.code === 'outside_project' || e.code === 'protected_path')) {
      const reason = e.code === 'outside_project' ? 'Đường dẫn nằm ngoài dự án'
        : e.code === 'protected_path' ? 'Đường dẫn dẫn tới tệp hoặc thư mục được bảo vệ' : e.message
      const message = `${reason}. Chưa ghi thay đổi. Hãy đọc lại tệp và duyệt bản xem trước mới.`
      deps.onWriteConflict?.(message)
      throw new FsError('conflict', message)
    }
    throw e
  }
  return { content: [{ type: 'text', text: `Đã ghi ${snap.path}` }], details: {} }
}

// Các tool dựng sẵn của pi có trường `path` (edit/write/read bắt buộc; ls/grep/find tuỳ chọn). Đều qua resolveToCwd
// (coding-agent/src/core/tools/path-utils.ts:46-48 → utils/paths.ts:120-150) nên cùng bị viết lại.
const PATH_TOOLS = new Set(['read', 'write', 'edit', 'ls', 'grep', 'find'])
const OPTIONAL_PATH = new Set(['ls', 'grep', 'find'])
const PROTECTED_PATH = 'Đường dẫn tới tệp hoặc thư mục được bảo vệ (.git, .nexgraph, .env, khoá…), thao tác bị chặn'
// Chép từ utils/paths.ts:7 (UNICODE_SPACES); pi đổi các ký tự này thành dấu cách thường.
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/

/**
 * Trả lý do chặn (tiếng Việt) hoặc undefined. Chặn path mà pi sẽ viết lại (@, ~, file:, dấu cách Unicode) thay vì tự chuẩn hoá,
 * chặn path ngoài root. Tool đọc giữ tên alias để kiểm tra luật bỏ qua trên cả alias và đích thật.
 */
function pinPath(root: string, tool: string, input: unknown): string | undefined {
  const i = input as { path?: unknown } | null
  if (typeof i !== 'object' || i === null) return 'Đầu vào của tool không hợp lệ'
  const p = i.path
  if (p === undefined && OPTIONAL_PATH.has(tool)) return undefined
  if (typeof p !== 'string' || p === '') return 'Thiếu đường dẫn hợp lệ'
  if (p.startsWith('@') || p.startsWith('~') || /^file:/i.test(p) || UNICODE_SPACES.test(p)) return 'Đường dẫn chứa ký tự mà pi sẽ viết lại (@, ~, file:, dấu cách Unicode), thao tác bị chặn'
  let rel: string
  try {
    rel = toProjectRelative(root, p)
  } catch {
    return 'Đường dẫn nằm ngoài dự án'
  }
  if (isProtectedRel(rel)) return PROTECTED_PATH
  let abs: string
  try {
    abs = resolveInside(root, rel)
  } catch (error) {
    if (error instanceof FsError && error.code === 'protected_path') return PROTECTED_PATH
    return 'Đường dẫn nằm ngoài dự án'
  }
  if (UNICODE_SPACES.test(abs)) return 'Đường dẫn tuyệt đối chứa dấu cách Unicode, thao tác bị chặn'
  // Không thử biến thể chính tả của tệp chưa tồn tại.
  if (tool === 'read' && !existsSync(abs)) return 'Tệp không tồn tại'
  i.path = tool === 'write' || tool === 'edit' ? abs : resolve(realpathSync.native(root), rel)
  return undefined
}

// Như normalizeToLF của pi (edit-diff.ts:11-13). before/after của bản xem trước là văn bản đã chuẩn hoá LF; UI diff hiển thị LF là chấp nhận được.
const toLF = (t: string) => t.replace(/\r\n?/g, '\n')

type Edit = { oldText: string; newText: string }

/**
 * Áp dụng edits[] như tool edit của pi (coding-agent/src/core/tools/edit-diff.ts:343-405): mọi oldText khớp trên bản gốc,
 * không rỗng, xuất hiện đúng một lần, không chồng nhau, kết quả phải khác bản gốc.
 * shortcut: chỉ khớp chính xác, không có khớp mờ (dấu nháy/gạch Unicode) của pi; edit cần khớp mờ sẽ bị từ chối ở bước xem trước.
 */
function applyEdits(before: string, edits: Edit[]): string {
  const found = edits.map((e, i) => {
    if (typeof e?.oldText !== 'string' || typeof e.newText !== 'string' || e.oldText === '') throw new Error(`edits[${i}] không hợp lệ`)
    const oldText = toLF(e.oldText)
    const at = before.indexOf(oldText)
    if (at === -1) throw new Error(`Không tìm thấy edits[${i}]`)
    if (before.indexOf(oldText, at + 1) !== -1) throw new Error(`edits[${i}] xuất hiện nhiều lần`)
    return { at, end: at + oldText.length, newText: toLF(e.newText) }
  }).sort((a, b) => a.at - b.at)
  let out = ''
  let pos = 0
  for (const f of found) {
    if (f.at < pos) throw new Error('Các edit chồng nhau')
    out += before.slice(pos, f.at) + f.newText
    pos = f.end
  }
  out += before.slice(pos)
  if (out === before) throw new Error('Edit không thay đổi nội dung')
  return out
}

export async function previewWrite(root: string, tool: 'edit' | 'write', input: unknown, assertEditable?: (path: string) => void): Promise<WritePreview> {
  const i = (input ?? {}) as { path?: unknown; content?: unknown; edits?: unknown }
  if (typeof i.path !== 'string') throw new Error('Thiếu đường dẫn tệp')
  const abs = resolveInside(root, toProjectRelative(root, i.path))
  const path = relative(realpathSync.native(root), abs).split(sep).join('/')
  assertEditable?.(path)
  let before = ''
  let file: WritePreview['file']
  try {
    const f = await readProjectFile(root, path)
    if (f.readOnly) throw new Error(`Không xem trước được tệp (${f.reason ?? 'chỉ đọc'})`)
    before = toLF(f.text)
    file = { eol: f.eol, bom: f.bom, version: f.version }
  } catch (e) {
    if (!(tool === 'write' && e instanceof FsError && e.code === 'file_not_found')) throw e
  }
  if (tool === 'write') {
    if (typeof i.content !== 'string') throw new Error('Thiếu nội dung')
    return { path, before, after: toLF(i.content), file }
  }
  if (!Array.isArray(i.edits)) throw new Error('Thiếu edits')
  return { path, before, after: applyEdits(before, i.edits as Edit[]), file }
}
