import { isAbsolute, relative, sep } from 'node:path'
import { realpathSync } from 'node:fs'
import { Type } from 'typebox'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent' // chỉ kiểu: pi là ESM, không import tĩnh giá trị
import type { EngineApi } from '../engine/api'
import { FsError, readProjectFile, resolveInside } from '../fs/project-fs'
import { TOOL_DEFS, runTool } from '../ai/tools'
import type { ApprovalGate } from './approval'

const GRAPH_TOOLS: string[] = TOOL_DEFS.map((t) => t.function.name)
const ALLOWED = new Set([...GRAPH_TOOLS, 'read', 'grep', 'find', 'ls', 'edit', 'write', 'bash'])

export function createNexgraphExtension(deps: { api: EngineApi; projectId: string; root: string; gate: ApprovalGate }): (pi: ExtensionAPI) => void {
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

    // Không chuẩn hoá, không tin: cổng duyệt cho qua tên lạ nên chặn ở đây trước.
    pi.on('tool_call', async (event) => {
      if (!ALLOWED.has(event.toolName)) return { block: true, reason: `Tool "${event.toolName}" không được phép dùng trong NexGraph` }
      try {
        if (PATH_TOOLS.has(event.toolName)) {
          const blocked = pinPath(deps.root, event.toolName, event.input)
          if (blocked) return { block: true, reason: blocked }
        }
        const d = await deps.gate.check(event.toolName, event.input)
        return d.allow ? undefined : { block: true, reason: d.reason || 'Thao tác bị từ chối' }
      } catch {
        return { block: true, reason: 'Cổng duyệt gặp lỗi nên thao tác bị từ chối' }
      }
    })
  }
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
  let abs: string
  try {
    abs = resolveInside(root, toRel(root, p))
  } catch {
    return 'Đường dẫn nằm ngoài dự án'
  }
  if (UNICODE_SPACES.test(abs)) return 'Đường dẫn tuyệt đối chứa dấu cách Unicode, thao tác bị chặn'
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

export async function previewWrite(root: string, tool: 'edit' | 'write', input: unknown): Promise<{ path: string; before: string; after: string }> {
  const i = (input ?? {}) as { path?: unknown; content?: unknown; edits?: unknown }
  if (typeof i.path !== 'string') throw new Error('Thiếu đường dẫn tệp')
  const rel = toRel(root, i.path)
  resolveInside(root, rel)
  let before = ''
  try {
    const f = await readProjectFile(root, rel)
    if (f.readOnly) throw new Error(`Không xem trước được tệp (${f.reason ?? 'chỉ đọc'})`)
    before = toLF(f.text)
  } catch (e) {
    if (!(tool === 'write' && e instanceof FsError && e.code === 'file_not_found')) throw e
  }
  const path = rel.split(sep).join('/')
  if (tool === 'write') {
    if (typeof i.content !== 'string') throw new Error('Thiếu nội dung')
    return { path, before, after: i.content }
  }
  if (!Array.isArray(i.edits)) throw new Error('Thiếu edits')
  return { path, before, after: applyEdits(before, i.edits as Edit[]) }
}
