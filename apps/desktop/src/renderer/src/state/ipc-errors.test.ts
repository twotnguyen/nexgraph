import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { uiEn } from '../strings'
import { codeErrors, errorText } from './errorText'
import { setLocale } from './locale'

/**
 * Main không biết ngôn ngữ UI: câu lỗi tiếng Việt trả qua IPC chỉ dịch được nếu
 * lỗi mang `code` (renderer tra `codeErrors`) hoặc câu đó có trong từ điển
 * (`knownErrors`). Test này chốt lớp lỗi ở các tệp biên IPC: thêm câu Việt mới
 * mà quên mã lỗi thì UI English lại hiện tiếng Việt.
 */
const MAIN = fileURLToPath(new URL('../../../main/', import.meta.url))
/** Tệp trả lỗi trực tiếp cho renderer (IPC/handler) hoặc dựng thông báo trạng thái. */
const BOUNDARY = [
  'ipc.ts', 'app/ipc.ts', 'platform/ipc-context.ts',
  // Handler IPC chia theo tính năng (ADR 0026 pha 2): mọi `features/<x>/ipc.ts` đều là tệp biên.
  ...readdirSync(join(MAIN, 'features')).map((feature) => `features/${feature}/ipc.ts`),
  'platform/ipc-result.ts', 'platform/engine/api.ts', 'features/agent/session.ts', 'platform/engine/launcher.ts', 'platform/engine/supervisor.ts'
]
const VIETNAMESE = /[ÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬĐÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴàáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/
/** Lời gọi dựng lỗi/thông báo đi ra renderer. */
const ERROR_CALL = /(?:new\s+\w*Error|fail|Object\.assign\(new Error)\s*\(/g
/** Lời gọi lỗi có mã: `new UserError('code', 'câu')`, `fail('code', …)`. */
const CODED_CALL = /(?:new\s+\w*Error|fail)\s*\(\s*'([a-z][a-z0-9_]+)'\s*,\s*[`']/g

/** Mọi tệp main (đệ quy): mã lỗi có câu Việt ở đâu cũng phải dịch được ở renderer. */
function mainSources(dir = MAIN): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...mainSources(path))
    else if (entry.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(entry) && !/^smoke/.test(entry)) out.push(path)
  }
  return out
}

function callArgument(text: string, at: number): string {
  let depth = 0
  for (let i = at; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')' && --depth === 0) return text.slice(at + 1, i)
  }
  return text.slice(at + 1)
}

/** `engine_unavailable`, `bad_param`… (không phải câu) hoặc một trường `.code`. */
const CODE = /['"`][a-z][a-z0-9_]{2,}['"`]|\.code\b|\bcode:/
/** Ngoại lệ có lý do: lời gọi tự mang khoá dịch chứ không dùng mã lỗi. */
const ALLOWED = [{ file: 'platform/engine/launcher.ts', why: 'fail(message, messageKey, vars): renderer dịch bằng messageKey của trạng thái engine' }]

describe('câu lỗi main trả qua IPC dịch được ở renderer', () => {
  it('mọi câu tiếng Việt trong lời gọi lỗi ở tệp biên đều đi kèm mã lỗi', () => {
    const hits: string[] = []
    for (const name of BOUNDARY) {
      if (ALLOWED.some((rule) => rule.file === name)) continue
      const text = readFileSync(`${MAIN}${name}`, 'utf8')
      for (const match of text.matchAll(ERROR_CALL)) {
        const argument = callArgument(text, match.index + match[0].length - 1)
        const literals = [...argument.matchAll(/'((?:[^'\\]|\\.)*)'/g)].filter((item) => VIETNAMESE.test(item[1]))
        if (!literals.length) continue
        const before = argument.slice(0, literals[0].index)
        if (CODE.test(before)) continue
        const line = text.slice(0, match.index).split('\n').length
        hits.push(`${name}:${line} — ${match[0]}${argument.trim().slice(0, 90).replace(/\s+/g, ' ')}`)
      }
    }
    expect(hits, 'thêm mã lỗi (code) để renderer dịch qua codeErrors; câu Việt trần không dịch được').toEqual([])
  })


  it('mọi mã lỗi main có câu Việt cố định đều có bản Anh (I3)', () => {
    const missing: string[] = []
    for (const file of mainSources()) {
      const name = file.slice(MAIN.length).replace(/\\/g, '/')
      if (ALLOWED.some((rule) => rule.file === name)) continue
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(CODED_CALL)) {
        const [code] = [match[1]]
        const message = callArgument(text, match.index + match[0].length - 1)
        if (!VIETNAMESE.test(message)) continue
        const key = codeErrors[code]
        const line = text.slice(0, match.index).split('\n').length
        if (key === undefined) missing.push(`${name}:${line} — ${code} chưa có trong codeErrors`)
        else if (uiEn[key] === undefined) missing.push(`${name}:${line} — ${code} → thiếu bản Anh cho "${key}"`)
      }
    }
    expect(missing, 'thêm codeErrors + uiEn cho mã lỗi mới; câu Việt trần không dịch được ở UI English').toEqual([])
  })

  it('filesystem_error (câu có biến) dịch được sang EN, VI giữ câu cụ thể', () => {
    setLocale('en')
    expect(errorText({ code: 'filesystem_error', message: 'Không thể tạo tệp: không có quyền truy cập' }))
      .toBe('Could not complete the file operation: check permissions and the path.')
    setLocale('vi')
    expect(errorText({ code: 'filesystem_error', message: 'Không thể tạo tệp: không có quyền truy cập' }))
      .toBe('Không thể tạo tệp: không có quyền truy cập')
  })

  it('mỗi mã lỗi trong codeErrors có bản Anh', () => {
    const missing = Object.entries(codeErrors).filter(([, key]) => uiEn[key] === undefined).map(([code, key]) => `${code} — ${key}`)
    expect(missing, 'câu VI của mã lỗi phải có bản Anh trong uiEn').toEqual([])
  })

  it('lỗi có mã nhưng câu lạ vẫn dịch theo mã (fallback thông điệp cũ)', () => {
    setLocale('en')
    expect(errorText({ code: 'engine_unavailable', message: 'Engine chưa sẵn sàng.' })).toBe('The engine is not ready yet.')
    expect(errorText({ code: 'consent_required', message: 'câu mới chưa có trong từ điển' })).toBe('Sending data to the AI provider has not been approved')
    expect(errorText({ code: 'internal', message: 'Máy chủ nội bộ gặp lỗi. Vui lòng thử lại.' })).toBe('The local server encountered an error. Please try again.')
    setLocale('vi')
  })

  it('mã lỗi engine (#48/#52) dịch được cả hai chiều: câu Anh của nguồn URL và câu Việt của CSDL', () => {
    setLocale('vi')
    expect(errorText({ code: 'blocked_private_ip', message: 'Blocked private/internal IP: 127.0.0.1' }))
      .toBe('URL nguồn trỏ tới địa chỉ IP riêng hoặc nội bộ nên bị chặn.')
    expect(errorText({ code: 'dns_failed', message: 'DNS resolution failed for example.test' }))
      .toBe('Không phân giải được tên máy chủ của URL nguồn.')
    setLocale('en')
    expect(errorText({ code: 'graph_busy', message: 'Đồ thị đang được cập nhật bởi tiến trình khác. Thử lại sau.' }))
      .toBe('The graph is being updated by another process. Try again later.')
    expect(errorText({ code: 'graph_readonly', message: 'Không ghi được CSDL đồ thị: tệp đang chỉ đọc hoặc thiếu quyền ghi.' }))
      .toBe('Could not write the graph database: the file is read-only or write permission is missing.')
    expect(errorText({ code: 'schema_outdated', message: 'câu cũ khác' }))
      .toBe('The graph database is older than the app. Reopen the project with the app to upgrade it.')
    setLocale('vi')
  })

  it('mã lạ vẫn giữ câu gốc của main', () => {
    expect(errorText({ code: 'something_new', message: 'Lỗi mới của engine' })).toBe('Lỗi mới của engine')
  })
})
