import { Worker } from 'node:worker_threads'

type GrepInput = {
  files: { path: string; text: string }[]
  pattern: string
  ignoreCase?: boolean
  literal?: boolean
  context: number
  limit: number
}

type WorkerResult = { text?: string; invalid?: true }

function runSearchInWorker(): void {
  const { parentPort, workerData } = require('node:worker_threads') as typeof import('node:worker_threads')
  const { files, pattern, ignoreCase, literal, context, limit } = workerData as GrepInput
  let regex: RegExp
  try {
    const expression = literal ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern
    regex = new RegExp(expression, ignoreCase ? 'iu' : 'u')
  } catch {
    parentPort?.postMessage({ invalid: true } satisfies WorkerResult)
    return
  }
  const output: string[] = []
  let totalBytes = 0
  let matches = 0
  let truncated = false
  for (const file of files) {
    const lines = file.text.split(/\r?\n/)
    if (lines.at(-1) === '') lines.pop()
    const visible = new Map<number, boolean>()
    for (const [index, line] of lines.entries()) {
      if (!regex.test(line)) continue
      if (matches >= limit) {
        truncated = true
        break
      }
      matches++
      visible.set(index, true)
      for (let n = Math.max(0, index - context); n <= Math.min(lines.length - 1, index + context); n++) {
        if (!visible.has(n)) visible.set(n, false)
      }
    }
    for (const index of Array.from(visible.keys()).sort((a, b) => a - b)) {
      const hit = visible.get(index)
      const line = lines[index].length > 500 ? lines[index].slice(0, 500) + '…' : lines[index]
      const text = hit ? `${file.path}:${index + 1}: ${line}` : `${file.path}-${index + 1}- ${line}`
      totalBytes += Buffer.byteLength(text) + 1
      if (totalBytes > 50 * 1024) {
        truncated = true
        break
      }
      output.push(text)
    }
    if (truncated) break
  }
  const text = output.join('\n') || 'Không tìm thấy kết quả.'
  parentPort?.postMessage({ text: text + (truncated ? '\n[Kết quả đã rút gọn.]' : '') } satisfies WorkerResult)
}

/** Regex của model chạy có giới hạn thời gian; worker chỉ nhận văn bản đã qua bộ lọc. */
export function grepText(input: GrepInput, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  const worker = new Worker(`(${runSearchInWorker.toString()})()`, {
    eval: true,
    workerData: input,
    env: {},
    resourceLimits: { maxOldGenerationSizeMb: 128 }
  })
  return new Promise<string>((resolve, reject) => {
    let settled = false
    const finish = (error: string | undefined, text?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      void worker.terminate()
      if (error) reject(new Error(error))
      else resolve(text ?? '')
    }
    const abort = () => finish('Đã dừng tìm kiếm')
    const timer = setTimeout(() => finish('Mẫu tìm kiếm vượt quá thời gian xử lý'), 2_000)
    signal?.addEventListener('abort', abort, { once: true })
    worker.once('error', () => finish('Không thể xử lý mẫu tìm kiếm'))
    worker.once('exit', () => finish('Không thể xử lý mẫu tìm kiếm'))
    worker.once('message', ({ text, invalid }: WorkerResult) => {
      if (invalid || text === undefined) return finish('Mẫu tìm kiếm không hợp lệ')
      finish(undefined, text)
    })
  })
}
