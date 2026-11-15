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

export function createNexgraphExtension(deps: { api: EngineApi; projectId: string; gate: ApprovalGate }): (pi: ExtensionAPI) => void {
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
        const d = await deps.gate.check(event.toolName, event.input)
        return d.allow ? undefined : { block: true, reason: d.reason }
      } catch {
        return { block: true, reason: 'Cổng duyệt gặp lỗi nên thao tác bị từ chối' }
      }
    })
  }
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

type Edit = { oldText: string; newText: string }

/**
 * Áp dụng edits[] như tool edit của pi (coding-agent/src/core/tools/edit-diff.ts:343-405): mọi oldText khớp trên bản gốc,
 * không rỗng, xuất hiện đúng một lần, không chồng nhau, kết quả phải khác bản gốc.
 * shortcut: chỉ khớp chính xác, không có khớp mờ (dấu nháy/gạch Unicode) của pi; edit cần khớp mờ sẽ bị từ chối ở bước xem trước.
 */
function applyEdits(before: string, edits: Edit[]): string {
  const found = edits.map((e, i) => {
    if (typeof e?.oldText !== 'string' || typeof e.newText !== 'string' || e.oldText === '') throw new Error(`edits[${i}] không hợp lệ`)
    const at = before.indexOf(e.oldText)
    if (at === -1) throw new Error(`Không tìm thấy edits[${i}]`)
    if (before.indexOf(e.oldText, at + 1) !== -1) throw new Error(`edits[${i}] xuất hiện nhiều lần`)
    return { at, end: at + e.oldText.length, newText: e.newText }
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
    before = f.text
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
