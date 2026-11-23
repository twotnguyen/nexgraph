import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { relPosix } from './scanPaths'

/**
 * Nhãn dịch phải được đọc lúc render (`vi.*` là Proxy, `tr()` đọc `getLocale()`).
 * Chốt chuỗi đã dịch vào state/ref/lần nạp module thì đổi ngôn ngữ không đổi nhãn —
 * đúng lỗi F5.1 (Kiến trúc, Bản đồ, Luồng, picker ký hiệu). Test này quét mã nguồn
 * để bắt cả lớp lỗi, kể cả màn chưa có test riêng.
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const TRANSLATED = /(?<![\w.$])(vi\.|tr\()/
/** Gọi hàm dịch ngay trong đối số setter = chốt câu theo ngôn ngữ lúc gọi, không đổi khi người dùng đổi ngôn ngữ. */
const AT_CALL = /(?<![\w.$])(errorText|msgText|tr)\(|(?<![\w.$])(vi|en)\./
/** `setX(e?.message ?? String(e))`: chép câu thô của main vào state, không qua `errorMsg`. */
const RAW_ERROR = /\??\.message\s*\?\?\s*String\(|String\((?:e|err|error|ex)\)/
/** `setAttribute`/`setTimeout`… không phải state: tham số là hiệu ứng DOM, không phải nhãn giữ lại. */
const DOM_SETTERS = new Set(['setAttribute', 'setAttributeNS', 'setTimeout', 'setInterval', 'setImmediate', 'setProperty', 'setSelectionRange', 'setPointerCapture', 'setStart', 'setEnd'])
/** Ngoại lệ có chủ đích: dữ liệu người dùng thấy nhưng không phải nhãn UI (đã ghi rõ lý do). */
const ALLOWED: { file: string; contains: string; why: string }[] = [
  { file: 'components/agent/AgentPanel.tsx', contains: 'content: msgText(message)', why: 'nội dung bubble lỗi trong lịch sử hội thoại: đã gửi cho model, lưu chuỗi như mọi tin nhắn' },
  { file: 'components/collab/CollabUi.tsx', contains: "name || tr('Người dùng')", why: 'tên hiển thị gửi sang phiên cộng tác là dữ liệu, không phải nhãn UI' },
  { file: 'state/debugState.ts', contains: 'output: [...state.output.slice(-500)', why: 'dòng console gỡ lỗi: ghi vào buffer văn bản, không phải nhãn UI' },
  { file: 'screens/WorkspaceScreen.tsx', contains: 'vi.path.noLink', why: 'câu dựng bằng hàm dictionary vi.path.found() (không có khoá phẳng) — ghi ở REPORT F11' },
  { file: 'App.tsx', contains: "state: 'error', message: msgText(errorMsg(e))", why: 'EngineStatus.message là chuỗi theo hợp đồng IPC; các lần cập nhật sau dùng messageKey của supervisor' },
  { file: 'screens/WorkspaceScreen.tsx', contains: 'vi.search.askNone', why: 'câu dựng từ dictionary vi.search (không có khoá phẳng) — ghi ở REPORT F11' }
]

function sources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'assets') continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...sources(path))
    else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) out.push(path)
  }
  return out
}

/** Tham số của lời gọi `name(...)` bắt đầu tại `at` (index của dấu `(`). */
function callArgument(text: string, at: number): string {
  let depth = 0
  for (let i = at; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')' && --depth === 0) return text.slice(at + 1, i)
  }
  return text.slice(at + 1)
}

/** Thay lời gọi `name(...)` bằng `__NAME__` để chỉ xét các lời gọi dịch còn lộ ra ngoài. */
function stripCalls(text: string, names: string[]): string {
  let out = text
  for (const name of names) {
    for (let guard = 0; guard < 200; guard++) {
      const match = new RegExp(`(?<![\\w.$])${name}\\s*\\(`).exec(out)
      if (!match) break
      const open = match.index + match[0].length - 1
      const argument = callArgument(out, open)
      out = `${out.slice(0, match.index)}__MSG__${out.slice(open + argument.length + 2)}`
    }
  }
  return out
}

/** Khai báo cấp module: dòng bắt đầu ở cột 0, gom tới dòng cấp module kế tiếp. */
function moduleStatements(text: string): { line: number; code: string }[] {
  const lines = text.split('\n')
  const out: { line: number; code: string }[] = []
  let current: { line: number; code: string } | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() && !line.startsWith(' ') && !line.startsWith('\t')) {
      if (current) out.push(current)
      current = { line: i + 1, code: line }
    } else if (current) {
      current.code += `\n${line}`
    }
  }
  if (current) out.push(current)
  return out
}

describe('nhãn dịch không bị chốt ngoài lúc render', () => {
  const files = sources(ROOT)

  it('không có chuỗi dịch trong useState/useRef', () => {
    const hits: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/use(State|Ref)(?:<[^>]*>)?\(/g)) {
        const argument = callArgument(text, match.index + match[0].length - 1)
        if (TRANSLATED.test(argument)) {
          hits.push(`${relPosix(ROOT, file)}:${text.slice(0, match.index).split('\n').length} — use${match[1]}(... ${argument.trim().slice(0, 80)}`)
        }
      }
    }
    expect(hits, 'dịch lúc render (vi.*/tr()), không lưu chuỗi đã dịch vào state/ref').toEqual([])
  })

  it('không gọi setX(tr(...)/vi.*/en.*) — chốt chuỗi dịch vào state', () => {
    const hits: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/(?<![\w.$])set[A-Z]\w*\s*\(/g)) {
        const argument = callArgument(text, match.index + match[0].length - 1)
        if (/^\s*(tr\(|(vi|en)\.)/.test(argument)) {
          hits.push(`${relPosix(ROOT, file)}:${text.slice(0, match.index).split('\n').length} — ${match[0]}${argument.trim().slice(0, 70)}`)
        }
      }
    }
    expect(hits, 'state giữ khoá/dữ liệu rồi dịch lúc render (msg/msgText), không chốt chuỗi đã dịch').toEqual([])
  })

  it('không lưu câu đã dịch qua setter/patch: setX(errorText(...)), setX(msgText(...)), object literal có tr(...)', () => {
    const hits: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/(?<![\w.$])(set[A-Z]\w*|patch)\s*\(/g)) {
        if (DOM_SETTERS.has(match[1])) continue
        const argument = callArgument(text, match.index + match[0].length - 1)
        // `msg(...)`/`msgError(...)` chỉ giữ khoá + biến nên phần bên trong hợp lệ.
        const plain = stripCalls(argument, ['msg', 'msgError'])
        if (!AT_CALL.test(plain) && !(RAW_ERROR.test(plain) && !argument.includes('errorMsg('))) continue
        const rel = relPosix(ROOT, file)
        if (ALLOWED.some((rule) => rule.file === rel && argument.includes(rule.contains))) continue
        hits.push(`${rel}:${text.slice(0, match.index).split('\n').length} — ${match[0]}${argument.trim().slice(0, 90).replace(/\s+/g, ' ')}`)
      }
    }
    expect(hits, 'state giữ Msg (msg/errorMsg) rồi msgText lúc render; errorText/msgText/tr() trong đối số setter là dịch lúc gọi').toEqual([])
  })

  it('không ném new Error(vi.*/en.*) — lỗi mang khoá Msg để chỗ bắt dịch lúc render', () => {
    const hits: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/new\s+Error\s*\(\s*(vi|en)\./g)) {
        hits.push(`${relPosix(ROOT, file)}:${text.slice(0, match.index).split('\n').length} — ${match[0]}`)
      }
    }
    expect(hits, 'dùng msgError(khoá) (state/messages) để chỗ bắt giữ khoá và dịch lúc render').toEqual([])
  })

  it('không có const cấp module giữ chuỗi đã dịch (trừ getter/hàm đọc lúc gọi)', () => {
    const hits: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const statement of moduleStatements(text)) {
        if (!/^(export\s+)?const\s/.test(statement.code) || !TRANSLATED.test(statement.code)) continue
        // Getter (`get title() { return tr(...) }`) và hàm (`() => tr(...)`) đọc lúc gọi nên hợp lệ.
        const initializer = statement.code.slice(statement.code.indexOf('='))
        if (/\bget\s+\w+\s*\(|=>|\bfunction\b/.test(initializer)) continue
        hits.push(`${relPosix(ROOT, file)}:${statement.line} — ${statement.code.split('\n')[0].slice(0, 100)}`)
      }
    }
    expect(hits, 'nhãn cấp module đọc lúc render, hoặc dùng getter/hàm như agentProfiles/useTheme').toEqual([])
  })

  it('đường dẫn ngoại lệ viết "/" và khớp relPosix(ROOT, …) trên mọi hệ điều hành', () => {
    // Review #57 C1: `relative()` trả `\` trên Windows; luật ở đây so bằng relPosix nên ALLOWED
    // phải viết `/`, nếu không CI windows lại đỏ dù mã đúng.
    const wrong = ALLOWED.filter((rule) => rule.file.includes('\\') || relPosix(ROOT, join(ROOT, rule.file)) !== rule.file)
    expect(wrong.map((rule) => rule.file), 'ALLOWED[].file phải dùng "/" và khớp relPosix').toEqual([])
  })
})
