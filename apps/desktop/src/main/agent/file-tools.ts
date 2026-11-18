import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { basename, posix } from 'node:path'
import { Type } from 'typebox'
import { AgentFileScope } from './file-scope'
import { grepText } from './grep-search'

const MAX_RESULT_BYTES = 50 * 1024
const MAX_GREP_BYTES = 16 * 1024 * 1024
const bounded = (n: number | undefined, fallback: number, min: number, max: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback
const reply = (text: string) => ({ content: [{ type: 'text' as const, text }], details: {} })
const truncated = '[Kết quả đã rút gọn. Hãy thu hẹp phạm vi tìm kiếm.]'
const optionalPath = Type.Optional(Type.String({ description: 'Đường dẫn trong dự án (mặc định là gốc dự án)' }))
const optionalLimit = Type.Optional(Type.Number({ description: 'Số kết quả tối đa' }))

function globMatches(path: string, glob: string): boolean {
  const pattern = glob.replace(/^(?:\.\/)+/, '')
  return pattern.includes('/') ? posix.matchesGlob(path, pattern) : posix.matchesGlob(posix.basename(path), pattern)
}

function imageMime(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  const signature = bytes.toString('ascii', 0, 12)
  if (signature.startsWith('GIF87a') || signature.startsWith('GIF89a')) return 'image/gif'
  if (signature.startsWith('RIFF') && signature.slice(8) === 'WEBP') return 'image/webp'
  if (signature.startsWith('BM')) return 'image/bmp'
  return undefined
}

function asText(bytes: Buffer): string {
  if (bytes.includes(0)) throw new Error('Tệp không phải văn bản UTF-8')
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

/** Dùng cùng tên tool của Pi. Tất cả tệp đọc và mọi đường dẫn trả về đều qua chính sách của NexGraph. */
export function registerScopedFileTools(pi: ExtensionAPI, root: string, excludes: () => Promise<string[]>): void {
  const scope = async (signal?: AbortSignal) => {
    signal?.throwIfAborted()
    let files
    try {
      const rules = await excludes()
      if (!Array.isArray(rules) || rules.some((rule) => typeof rule !== 'string')) throw new Error()
      files = new AgentFileScope(root, rules)
    } catch {
      throw new Error('Không xác định được phạm vi truy cập tệp của AI')
    }
    signal?.throwIfAborted()
    return files
  }

  pi.registerTool({
    name: 'read',
    label: 'read',
    description: 'Đọc văn bản UTF-8 và ảnh trong phạm vi dự án được AI truy cập. Dùng offset/limit để đọc theo dòng.',
    promptSnippet: 'Read text and images from allowed project files',
    parameters: Type.Object({
      path: Type.String({ description: 'Đường dẫn tệp trong dự án' }),
      offset: Type.Optional(Type.Number({ description: 'Dòng bắt đầu, tính từ 1' })),
      limit: optionalLimit
    }),
    async execute(id, params, signal, onUpdate, ctx) {
      const files = await scope(signal)
      const entry = files.entry(params.path)
      if (entry.directory) throw new Error('Hãy chọn một tệp để đọc')
      let bytes
      try {
        bytes = files.bytes(entry)
      } catch {
        throw new Error('Tệp không khả dụng theo phạm vi truy cập của AI')
      }
      const mime = imageMime(bytes)
      if (!mime) asText(bytes)
      const exact = (path: string) => {
        if (path !== entry.absolute) throw new Error('Tệp không khả dụng theo phạm vi truy cập của AI')
      }
      // Giữ chia trang, cắt kết quả và xử lý ảnh của Pi; truyền bytes đã kiểm tra, không để Pi mở lại tệp.
      const { createReadToolDefinition } = await import('@earendil-works/pi-coding-agent')
      const read = createReadToolDefinition(root, { operations: {
        access: async (path) => { exact(path) },
        readFile: async (path) => { exact(path); return bytes },
        detectImageMimeType: async (path) => { exact(path); return mime }
      } })
      const offset = params.offset === undefined ? undefined : bounded(params.offset, 1, 1, Number.MAX_SAFE_INTEGER)
      const limit = params.limit === undefined ? undefined : bounded(params.limit, 2_000, 1, 2_000)
      return read.execute(id, { path: entry.absolute, offset, limit }, signal, onUpdate, ctx)
    }
  })

  pi.registerTool({
    name: 'ls',
    label: 'ls',
    description: 'Liệt kê các tệp và thư mục được phép trong thư mục đã chọn.',
    promptSnippet: 'List allowed project directory entries',
    parameters: Type.Object({ path: optionalPath, limit: optionalLimit }),
    async execute(_id, params, signal) {
      const files = await scope(signal)
      const start = files.entry(params.path ?? '.')
      if (!start.directory) throw new Error('Hãy chọn một thư mục để liệt kê')
      const limit = bounded(params.limit, 500, 1, 2_000)
      const state = { limited: false }
      const output: string[] = []
      let bytes = 0
      for await (const entry of files.entries(start, false, state, signal)) {
        const line = basename(entry.relative) + (entry.directory ? '/' : '')
        bytes += Buffer.byteLength(line) + 1
        if (output.length >= limit || bytes > MAX_RESULT_BYTES) { state.limited = true; break }
        output.push(line)
      }
      return reply(output.join('\n') + (state.limited ? `\n${truncated}` : '') || 'Không có mục nào.')
    }
  })

  pi.registerTool({
    name: 'find',
    label: 'find',
    description: 'Tìm đường dẫn tệp được phép theo glob, tương đối với thư mục tìm kiếm.',
    promptSnippet: 'Find allowed project paths by glob',
    parameters: Type.Object({ pattern: Type.String({ maxLength: 512 }), path: optionalPath, limit: optionalLimit }),
    async execute(_id, params, signal) {
      const files = await scope(signal)
      const start = files.entry(params.path ?? '.')
      if (!start.directory) throw new Error('Hãy chọn một thư mục để tìm tệp')
      const limit = bounded(params.limit, 1_000, 1, 2_000)
      const state = { limited: false }
      const output: string[] = []
      let bytes = 0
      for await (const entry of files.entries(start, true, state, signal)) {
        if (entry.directory) continue
        const path = posix.relative(start.relative || '.', entry.relative)
        if (!globMatches(path, params.pattern)) continue
        bytes += Buffer.byteLength(path) + 1
        if (output.length >= limit || bytes > MAX_RESULT_BYTES) { state.limited = true; break }
        output.push(path)
      }
      return reply(output.join('\n') + (state.limited ? `\n${truncated}` : '') || 'Không tìm thấy kết quả.')
    }
  })

  pi.registerTool({
    name: 'grep',
    label: 'grep',
    description: 'Tìm văn bản được phép theo biểu thức chính quy hoặc chuỗi. Trả về đường dẫn và số dòng.',
    promptSnippet: 'Search allowed project file contents',
    parameters: Type.Object({
      pattern: Type.String({ minLength: 1, maxLength: 2_000 }),
      path: optionalPath,
      glob: Type.Optional(Type.String({ maxLength: 512 })),
      ignoreCase: Type.Optional(Type.Boolean()),
      literal: Type.Optional(Type.Boolean()),
      context: Type.Optional(Type.Number()),
      limit: optionalLimit
    }),
    async execute(_id, params, signal) {
      const files = await scope(signal)
      const start = files.entry(params.path ?? '.')
      const state = { limited: false }
      const candidates = start.directory ? files.entries(start, true, state, signal) : [start]
      const content: { path: string; text: string }[] = []
      let bytes = 0
      for await (const entry of candidates) {
        if (entry.directory) continue
        const path = start.directory ? posix.relative(start.relative || '.', entry.relative) : basename(entry.relative)
        if (params.glob) {
          const negated = params.glob.startsWith('!')
          if (globMatches(path, negated ? params.glob.slice(1) : params.glob) === negated) continue
        }
        try {
          const data = files.bytes(entry)
          if (bytes + data.length > MAX_GREP_BYTES) { state.limited = true; break }
          const text = asText(data)
          bytes += data.length
          content.push({ path, text })
        } catch {
          // Đường dẫn đổi, hoặc tệp không đọc được như văn bản; không đưa chi tiết vào kết quả.
        }
      }
      const text = await grepText({
        files: content,
        pattern: params.pattern,
        ignoreCase: params.ignoreCase,
        literal: params.literal,
        context: bounded(params.context, 0, 0, 20),
        limit: bounded(params.limit, 100, 1, 1_000)
      }, signal)
      return reply(text + (state.limited ? `\n${truncated}` : ''))
    }
  })
}
