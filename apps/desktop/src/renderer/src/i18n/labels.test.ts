import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Nhãn dịch phải được đọc lúc render (`vi.*` là Proxy, `tr()` đọc `getLocale()`).
 * Chốt chuỗi đã dịch vào state/ref/lần nạp module thì đổi ngôn ngữ không đổi nhãn —
 * đúng lỗi F5.1 (Kiến trúc, Bản đồ, Luồng, picker ký hiệu). Test này quét mã nguồn
 * để bắt cả lớp lỗi, kể cả màn chưa có test riêng.
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const TRANSLATED = /(?<![\w.$])(vi\.|tr\()/

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
          hits.push(`${relative(ROOT, file)}:${text.slice(0, match.index).split('\n').length} — use${match[1]}(... ${argument.trim().slice(0, 80)}`)
        }
      }
    }
    expect(hits, 'dịch lúc render (vi.*/tr()), không lưu chuỗi đã dịch vào state/ref').toEqual([])
  })

  it('không gọi setX(tr(...)) — chốt chuỗi dịch vào state', () => {
    const hits: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/(?<![\w.$])set[A-Z]\w*\s*\(/g)) {
        const argument = callArgument(text, match.index + match[0].length - 1)
        if (/^\s*tr\(/.test(argument)) {
          hits.push(`${relative(ROOT, file)}:${text.slice(0, match.index).split('\n').length} — ${match[0]}${argument.trim().slice(0, 70)}`)
        }
      }
    }
    expect(hits, 'state giữ khoá/dữ liệu rồi dịch lúc render (msg/msgText), không chốt chuỗi đã dịch').toEqual([])
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
        hits.push(`${relative(ROOT, file)}:${statement.line} — ${statement.code.split('\n')[0].slice(0, 100)}`)
      }
    }
    expect(hits, 'nhãn cấp module đọc lúc render, hoặc dùng getter/hàm như agentProfiles/useTheme').toEqual([])
  })
})
