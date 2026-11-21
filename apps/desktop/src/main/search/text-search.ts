import { posix } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { TextSearchQuery, TextSearchResult, TextReplaceResult } from '../../shared/api'
import { AgentFileScope } from '../agent/file-scope'
import { isProtectedRel, readProjectFile, writeProjectFile } from '../fs/project-fs'

/** Thư mục sinh ra, không tìm trong đó (cùng danh sách với ô tìm tệp ⌘P). */
export const GENERATED_DIRS = ['.git/', '.nexgraph/', '.venv/', 'dist/', '.next/', '.cache/', '.turbo/', '__pycache__/']
const MAX_BYTES = 32 * 1024 * 1024
const MAX_MATCHES = 2_000

type WorkerInput = { mode: 'search' | 'replace'; files: { path: string; text: string }[]; query: TextSearchQuery; replacement?: string; limit: number }
type WorkerOutput = { invalid?: true; result?: TextSearchResult; replaced?: { path: string; text: string; count: number }[] }

// Chạy trong worker: regex do người dùng gõ có thể chạy rất lâu, không được chặn main.
function runInWorker(): void {
  const { parentPort, workerData } = require('node:worker_threads') as typeof import('node:worker_threads')
  const { mode, files, query, replacement, limit } = workerData as WorkerInput
  let regex: RegExp
  try {
    const source = query.regex ? query.query : query.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    regex = new RegExp(query.wholeWord ? `\\b(?:${source})\\b` : source, `g${query.caseSensitive ? '' : 'i'}u`)
  } catch {
    parentPort?.postMessage({ invalid: true })
    return
  }
  if (mode === 'replace') {
    // Chế độ chữ thường: $ trong chuỗi thay là ký tự thật, không phải $1/$&.
    const by = query.regex ? replacement ?? '' : (replacement ?? '').replace(/\$/g, '$$$$')
    const replaced: { path: string; text: string; count: number }[] = []
    for (const file of files) {
      const count = file.text.match(regex)?.length ?? 0
      if (count) replaced.push({ path: file.path, text: file.text.replace(regex, by), count })
    }
    parentPort?.postMessage({ replaced })
    return
  }
  const out: TextSearchResult = { files: [], truncated: false }
  let total = 0
  for (const file of files) {
    const matches: TextSearchResult['files'][number]['matches'] = []
    const lines = file.text.split('\n')
    for (const [index, line] of lines.entries()) {
      regex.lastIndex = 0
      for (let m = regex.exec(line); m; m = regex.exec(line)) {
        if (m[0].length === 0) { regex.lastIndex++; continue }
        if (total >= limit) { out.truncated = true; break }
        total++
        matches.push({ line: index + 1, column: m.index + 1, length: m[0].length, preview: line.length > 300 ? line.slice(Math.max(0, m.index - 100), m.index + 200) : line, previewStart: line.length > 300 ? Math.max(0, m.index - 100) : 0 })
      }
      if (out.truncated) break
    }
    if (matches.length) out.files.push({ file: file.path, matches })
    if (out.truncated) break
  }
  parentPort?.postMessage({ result: out })
}

function inWorker(input: WorkerInput): Promise<WorkerOutput> {
  const worker = new Worker(`(${runInWorker.toString()})()`, { eval: true, workerData: input, env: {}, resourceLimits: { maxOldGenerationSizeMb: 512 } })
  // tsconfig chưa có lib es2024 (Promise.withResolvers).
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { void worker.terminate(); reject(Object.assign(new Error('Tìm kiếm quá lâu, hãy thu hẹp mẫu hoặc phạm vi'), { code: 'timeout' })) }, 5_000)
    worker.once('message', (data: WorkerOutput) => { clearTimeout(timer); void worker.terminate(); resolve(data) })
    worker.once('error', (error) => { clearTimeout(timer); reject(error) })
  })
}

const globs = (value: string | undefined) => (value ?? '').split(',').map((g) => g.trim()).filter(Boolean)
const matches = (path: string, glob: string) => posix.matchesGlob(path, glob.includes('/') ? glob : `**/${glob}`)

/** Đọc mọi tệp văn bản trong phạm vi (theo .gitignore, bỏ thư mục sinh ra và tệp được bảo vệ, lọc include/exclude). */
async function collect(root: string, query: TextSearchQuery, only?: Set<string>): Promise<{ path: string; text: string }[]> {
  const scope = new AgentFileScope(root, GENERATED_DIRS)
  const include = globs(query.include)
  const exclude = globs(query.exclude)
  const files: { path: string; text: string }[] = []
  let bytes = 0
  for await (const entry of scope.entries(scope.entry('.'), true, { limited: false })) {
    const path = entry.relative
    if (entry.directory || isProtectedRel(path) || (only && !only.has(path))) continue
    if (include.length && !include.some((g) => matches(path, g))) continue
    if (exclude.some((g) => matches(path, g))) continue
    try {
      const data = scope.bytes(entry)
      if (data.includes(0) || bytes + data.length > MAX_BYTES) continue
      const text = new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/\r\n?/g, '\n')
      bytes += data.length
      files.push({ path, text })
    } catch {
      // Không phải UTF-8 hoặc vừa đổi: bỏ qua.
    }
  }
  return files
}

const invalid = () => Object.assign(new Error('Biểu thức chính quy không hợp lệ'), { code: 'bad_param' })

export async function searchText(root: string, query: TextSearchQuery): Promise<TextSearchResult> {
  if (!query.query) return { files: [], truncated: false }
  const out = await inWorker({ mode: 'search', files: await collect(root, query), query, limit: MAX_MATCHES })
  if (out.invalid || !out.result) throw invalid()
  return out.result
}

/** Thay trong các tệp được chọn; mỗi tệp ghi nguyên tử với phiên bản vừa đọc, tệp đổi giữa chừng thì bỏ qua. */
export async function replaceText(root: string, query: TextSearchQuery, replacement: string, files: string[]): Promise<TextReplaceResult> {
  const wanted = new Set(files)
  const out = await inWorker({ mode: 'replace', files: await collect(root, query, wanted), query, replacement, limit: MAX_MATCHES })
  if (out.invalid || !out.replaced) throw invalid()
  const result: TextReplaceResult = { files: 0, replacements: 0, skipped: [] }
  for (const item of out.replaced) {
    try {
      const disk = await readProjectFile(root, item.path)
      if (disk.readOnly || disk.text.replace(/\r\n?/g, '\n') === item.text) { result.skipped.push(item.path); continue }
      await writeProjectFile(root, item.path, item.text, { eol: disk.eol, bom: disk.bom, expectedVersion: disk.version })
      result.files++
      result.replacements += item.count
    } catch {
      result.skipped.push(item.path)
    }
  }
  return result
}
