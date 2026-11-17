import { isAbsolute, relative, sep } from 'node:path'
import { existsSync, realpathSync } from 'node:fs'
import { Type } from 'typebox'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent' // chỉ kiểu: pi là ESM, không import tĩnh giá trị
import type { EngineApi } from '../engine/api'
import { FsError, isProtectedRel, readProjectFile, resolveInside, writeProjectFile } from '../fs/project-fs'
import { TOOL_DEFS, runTool } from '../ai/tools'
import type { ApprovedWrite, ApprovalGate, WritePreview } from './approval'

const GRAPH_TOOLS: string[] = TOOL_DEFS.map((t) => t.function.name)
const ALLOWED = new Set([...GRAPH_TOOLS, 'read', 'grep', 'find', 'ls', 'edit', 'write', 'bash'])

export function createNexgraphExtension(deps: {
  api: EngineApi
  projectId: string
  root: string
  gate: ApprovalGate
  onWriteConflict?: (message: string) => void
}): (pi: ExtensionAPI) => void {
  return (pi) => {
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

    // Không chuẩn hoá, không tin: cổng duyệt cho qua tên lạ nên chặn ở đây trước.
    pi.on('tool_call', async (event) => {
      if (!ALLOWED.has(event.toolName)) return { block: true, reason: `Tool "${event.toolName}" không được phép dùng trong NexGraph` }
      const writing = event.toolName === 'write' || event.toolName === 'edit'
      const duplicate = { block: true, reason: 'Mã thao tác ghi bị trùng' }
      if (writing && approvedWrites.has(event.toolCallId)) return duplicate
      try {
        if (PATH_TOOLS.has(event.toolName)) {
          const blocked = pinPath(deps.root, event.toolName, event.input)
          if (blocked) return { block: true, reason: blocked }
        }
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
}

/**
 * Execute write/edit an toàn: consume đúng bản duyệt (toolCallId trùng với tool_call hook đã lưu),
 * revalidate tại thời điểm ghi — đường dẫn canonical sau realpath lại phải trùng đường dẫn đã duyệt
 * (kể cả khi tệp khác có cùng nội dung). Dịch vụ tệp đối chiếu phiên bản đã duyệt,
 * hoặc yêu cầu tệp vẫn chưa tồn tại, rồi ghi đúng `after` của bản xem trước.
 */
async function executeApprovedWrite(
  deps: { root: string; onWriteConflict?: (message: string) => void },
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
    if (relative(realpathSync(deps.root), abs).split(sep).join('/') !== snap.path) {
      throw new FsError('conflict', 'Đường dẫn đã thay đổi từ lúc xem trước duyệt')
    }
  }
  try {
    snap.assertCurrent()
    assertApprovedPath(toRel(deps.root, p))
    await writeProjectFile(deps.root, snap.path, snap.after, {
      eol: snap.file?.eol ?? '\n',
      bom: snap.file?.bom ?? false,
      expectedVersion: snap.file?.version ?? null
    }, { assertNotCancelled: () => {
      snap.assertCurrent()
      assertApprovedPath(snap.path)
    } })
  } catch (e) {
    if (e instanceof FsError && (e.code === 'conflict' || e.code === 'outside_project')) {
      const reason = e.code === 'outside_project' ? 'Đường dẫn nằm ngoài dự án' : e.message
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
// Chép từ utils/paths.ts:7 (UNICODE_SPACES); pi đổi các ký tự này thành dấu cách thường.
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/

/**
 * Trả lý do chặn (tiếng Việt) hoặc undefined. Chặn path mà pi sẽ viết lại (@, ~, file:, dấu cách Unicode) thay vì tự chuẩn hoá,
 * chặn path ngoài root, rồi ghi path tuyệt đối đã kiểm vào input: pi chạy đúng chuỗi đó (agent-loop.ts:742,770 dùng chung một args;
 * path tuyệt đối đi qua resolveToCwd nguyên vẹn, paths.ts:150).
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
    rel = toRel(root, p)
  } catch {
    return 'Đường dẫn nằm ngoài dự án'
  }
  if (isProtectedRel(rel)) return 'Đường dẫn tới tệp hoặc thư mục được bảo vệ (.git, .nexgraph, .env, khoá…), thao tác bị chặn'
  let abs: string
  try {
    abs = resolveInside(root, rel)
  } catch {
    return 'Đường dẫn nằm ngoài dự án'
  }
  if (UNICODE_SPACES.test(abs)) return 'Đường dẫn tuyệt đối chứa dấu cách Unicode, thao tác bị chặn'
  // read: path phải tồn tại. pi resolveReadPathAsync (path-utils.ts:72-101) thử biến thể dấu nháy thẳng→cong và NFD
  // khi path vắng — chặn ở đây để không bao giờ đọc tệp khác mà gate chưa kiểm (ví dụ a'b vắng nhưng a’b là symlink ngoài).
  if (tool === 'read' && !existsSync(abs)) return 'Tệp không tồn tại'
  i.path = abs
  return undefined
}

/** Đường dẫn tuyệt đối nằm trong root thì đổi sang tương đối (resolveInside từ chối tuyệt đối); ngoài root thì ném. */
function toRel(root: string, p: string): string {
  if (!isAbsolute(p)) return p
  for (const r of [root, realpathSync(root)]) {
    const rel = relative(r, p)
    if (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)) return rel
  }
  throw new FsError('outside_project', `Đường dẫn nằm ngoài dự án: ${p}`)
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

export async function previewWrite(root: string, tool: 'edit' | 'write', input: unknown): Promise<WritePreview> {
  const i = (input ?? {}) as { path?: unknown; content?: unknown; edits?: unknown }
  if (typeof i.path !== 'string') throw new Error('Thiếu đường dẫn tệp')
  const abs = resolveInside(root, toRel(root, i.path))
  const path = relative(realpathSync(root), abs).split(sep).join('/')
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
