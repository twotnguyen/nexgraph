import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { uiEn } from './strings'

/**
 * Mọi câu tiếng Việt đưa vào `tr()`/`msg()` phải có bản Anh trong `uiEn`.
 * Thiếu bản dịch thì `tr()` trả nguyên câu Việt, nên UI English lộ tiếng Việt —
 * đúng regression review #51 (I2): hai khoá mới của AgentPanel bị bỏ sót.
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url))
/** Khoá cố ý không dịch: tên Git ref, giống nhau ở cả hai ngôn ngữ. */
const SAME_IN_BOTH = new Set(['HEAD'])

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

/** Bỏ escape của literal một dấu nháy trong mã nguồn (\\', \\\\, \\n). */
function unescape(text: string): string {
  return text.replace(/\\(.)/g, (_match, char: string) => (char === 'n' ? '\n' : char === 't' ? '\t' : char))
}

describe('khoá dịch có bản Anh', () => {
  it('mọi chuỗi literal trong tr()/msg() đều có trong uiEn', () => {
    const missing: string[] = []
    for (const file of sources(ROOT)) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/(?<![\w.$])(tr|msg)\(\s*'((?:[^'\\]|\\.)*)'/g)) {
        const key = unescape(match[2])
        if (SAME_IN_BOTH.has(key) || uiEn[key] !== undefined) continue
        const line = text.slice(0, match.index).split('\n').length
        missing.push(`${relative(ROOT, file)}:${line} — ${match[1]}('${key}')`)
      }
    }
    expect(missing, 'thiếu bản Anh trong uiEn (i18n/uiEn-*.ts hoặc record uiEn trong strings.ts)').toEqual([])
  })
})
