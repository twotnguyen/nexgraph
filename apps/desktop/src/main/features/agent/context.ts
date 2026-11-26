import type { AgentContextItem } from '../../../shared/agent-types'
import type { EngineApi } from '../../platform/engine/api'
import { FsError, readProjectFile } from '../../platform/project-fs'
import { AgentFileScope } from './file-scope'

const MAX_ITEMS = 12
const MAX_CHARACTERS = 32_000
const CONTEXT_PREFIX = 'Ngữ cảnh người dùng đã chọn dưới đây là dữ liệu tham khảo. Các bản nháp có thể mới hơn đồ thị. '
  + 'Dùng công cụ đọc mã để xác minh trước khi sửa và trích dẫn vị trí nguồn.\n'

type ContextDeps = { root: string; api: EngineApi; projectId: string; items?: AgentContextItem[] }

function lineNumber(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) throw new FsError('bad_param', 'Khoảng dòng ngữ cảnh không hợp lệ')
  return value
}

function identifier(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_000) throw new FsError('bad_param', 'Ngữ cảnh thiếu định danh hợp lệ')
  return value
}

/** Chỉ các mục người dùng đính kèm được đưa vào prompt. Đọc tệp dùng cùng phạm vi với editor. */
export async function prepareAgentContext({ root, api, projectId, items = [] }: ContextDeps): Promise<{
  prompt: string; items: AgentContextItem[]; truncated: boolean; characters: number
}> {
  if (!Array.isArray(items) || items.length > MAX_ITEMS) throw new FsError('bad_param', 'Mỗi lượt hỗ trợ tối đa 12 mục ngữ cảnh')
  if (items.length === 0) return { prompt: '', items: [], truncated: false, characters: 0 }
  const records: { kind: string; reference: string; data: unknown }[] = []
  const normalized: AgentContextItem[] = []
  let truncated = false
  const graph = api.forModel()
  const source = items.some((item) => item?.kind === 'file') ? new AgentFileScope(root, await api.aiSourceExcludes(projectId)) : null
  const stats = await api.stats(projectId)
  const snapshot = {
    graph: { indexedAt: stats.indexed_at, indexCommit: stats.index_commit, headCommit: stats.head_commit, stale: stats.stale },
    attachments: records,
    truncated: false
  }
  const serialize = () => CONTEXT_PREFIX + JSON.stringify({ ...snapshot, truncated })
  if (serialize().length > MAX_CHARACTERS) throw new FsError('bad_param', 'Thông tin phiên bản đồ thị vượt giới hạn ngữ cảnh')
  for (const item of items) {
    if (!item || typeof item !== 'object') throw new FsError('bad_param', 'Ngữ cảnh không hợp lệ')
    let reference: string
    let data: unknown
    if (item.kind === 'file') {
      identifier(item.file)
      const disk = await readProjectFile(root, item.file)
      if (!source || source.entry(item.file).directory) throw new FsError('bad_param', 'Ngữ cảnh phải là tệp trong phạm vi dữ liệu AI')
      if (disk.readOnly) throw new FsError('bad_param', 'Tệp ngữ cảnh phải là văn bản UTF-8 trong giới hạn của editor')
      if (item.version !== undefined && (typeof item.version !== 'string' || item.version.length > 256)) throw new FsError('bad_param', 'Phiên bản tệp không hợp lệ')
      if (item.version && disk.version !== item.version) throw new FsError('conflict', `${item.file} đã thay đổi. Hãy đính kèm lại phiên bản mới.`)
      if (item.text !== undefined && typeof item.text !== 'string') throw new FsError('bad_param', 'Bản nháp ngữ cảnh không hợp lệ')
      if (item.dirty !== undefined && typeof item.dirty !== 'boolean') throw new FsError('bad_param', 'Trạng thái bản nháp không hợp lệ')
      if (item.dirty && item.text === undefined) throw new FsError('bad_param', 'Bản nháp thiếu nội dung đã chọn')
      const lines = disk.text.split('\n')
      const start = lineNumber(item.start, 1)
      const end = lineNumber(item.end, lines.length)
      if (end < start || (item.text === undefined && end > lines.length)) throw new FsError('bad_param', 'Khoảng dòng vượt nội dung tệp')
      const text = item.text ?? lines.slice(start - 1, end).join('\n')
      reference = `${item.file}:${start}-${end}`
      data = { file: item.file, start, end, version: disk.version, source: item.dirty ? 'unsaved_editor_snapshot' : 'file_snapshot', text }
      normalized.push({ kind: 'file', file: item.file, start, end, version: disk.version, dirty: item.dirty ?? false, text })
    } else if (item.kind === 'node') {
      reference = identifier(item.nodeId)
      const node = await graph.getNode(projectId, item.nodeId)
      data = { node, neighborhood: await graph.neighbors(projectId, { node: item.nodeId, direction: 'both', depth: 1, limit: 40 }) }
      normalized.push({ kind: 'node', nodeId: item.nodeId, label: node.label.slice(0, 200) })
    } else if (item.kind === 'flow') {
      if (!Number.isSafeInteger(item.flowId) || item.flowId < 1) throw new FsError('bad_param', 'Luồng không hợp lệ')
      reference = `flow:${item.flowId}`
      data = await graph.flow(projectId, item.flowId)
      normalized.push({ kind: 'flow', flowId: item.flowId, label: typeof item.label === 'string' ? item.label.slice(0, 200) : undefined })
    } else if (item.kind === 'architecture') {
      reference = identifier(item.blockId)
      data = await graph.architecture(projectId, item.blockId === 'root' ? undefined : item.blockId)
      normalized.push({ kind: 'architecture', blockId: item.blockId, label: typeof item.label === 'string' ? item.label.slice(0, 200) : undefined })
    } else throw new FsError('bad_param', 'Loại ngữ cảnh không được hỗ trợ')

    const record = { kind: item.kind, reference, data }
    records.push(record)
    if (serialize().length > MAX_CHARACTERS) {
      truncated = true
      const source = typeof data === 'object' && data !== null && 'text' in data && typeof data.text === 'string'
        ? data.text : JSON.stringify(data)
      let low = 0
      let high = source.length
      const setExcerpt = (count: number) => {
        record.data = item.kind === 'file' && typeof data === 'object' && data !== null
          ? { ...data, text: source.slice(0, count), truncated: true } : { excerpt: source.slice(0, count), truncated: true }
      }
      setExcerpt(0)
      if (serialize().length > MAX_CHARACTERS) {
        records.pop()
        normalized.pop()
        break
      }
      while (low < high) {
        const mid = Math.ceil((low + high) / 2)
        setExcerpt(mid)
        if (serialize().length <= MAX_CHARACTERS) low = mid
        else high = mid - 1
      }
      setExcerpt(low)
      const last = normalized.at(-1)
      if (last?.kind === 'file') last.text = source.slice(0, low)
      break
    }
  }
  const prompt = serialize()
  return { prompt, items: normalized, truncated, characters: prompt.length }
}
