import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { plural, setLocale } from '../state/locale'
import { tr, vi } from '../strings'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
/** Từ đứng sau số nhưng không phải danh từ đếm được: động từ/giới từ/đơn vị đo. */
const NOT_A_NOUN = new Set(['has', 'was', 'is', 'does', 'this', 'cross', 'plus', 'vs', 'etc', 'as', 'ms', 'px', 'kb', 'mb', 'gb'])

/** Chuỗi bản Anh: phần `enStrings` của strings.ts (kèm record `uiEn` phía sau) và các tệp uiEn-*.ts. */
function enSources(): { file: string; text: string; lineOffset: number }[] {
  const strings = readFileSync(join(ROOT, 'strings.ts'), 'utf8')
  const at = strings.indexOf('const enStrings')
  const out = [{ file: 'strings.ts', text: strings.slice(at), lineOffset: strings.slice(0, at).split('\n').length - 1 }]
  for (const entry of readdirSync(join(ROOT, 'i18n'))) {
    if (/^uiEn.*\.ts$/.test(entry)) out.push({ file: `i18n/${entry}`, text: readFileSync(join(ROOT, 'i18n', entry), 'utf8'), lineOffset: 0 })
  }
  return out
}

/** Mẫu `${n} clusters` / `{count} tools` trong literal chưa dùng cú pháp plural. */
function pluralHits(text: string): { line: number; sample: string }[] {
  const hits: { line: number; sample: string }[] = []
  // Bỏ khoá ở đầu dòng (`'khoá':`) để chỉ quét giá trị; không đổi số dòng.
  const body = text.replace(/^(\s*)'(?:[^'\\\n]|\\.)*'\s*:/gm, '$1').replace(/^(\s*)"(?:[^"\\\n]|\\.)*"\s*:/gm, '$1')
  const literals = [
    ...body.matchAll(/`(?:[^`\\]|\\.)*`/gs),
    ...body.matchAll(/'(?:[^'\\\n]|\\.)*'/g),
    ...body.matchAll(/"(?:[^"\\\n]|\\.)*"/g)
  ]
  for (const match of literals) {
    const literal = match[0]
    if (/plural/i.test(literal)) continue
    for (const word of literal.matchAll(/(?:\$\{[^}]+\}|\{[A-Za-z_]\w*\})\s+([A-Za-z][\w-]*)/g)) {
      if (!word[1].endsWith('s') || NOT_A_NOUN.has(word[1])) continue
      hits.push({ line: body.slice(0, match.index).split('\n').length, sample: literal.slice(0, 120) })
      break
    }
  }
  return hits
}

describe('số nhiều tiếng Anh', () => {
  afterEach(() => setLocale('vi'))

  it('mọi literal đếm trong chuỗi EN dùng số ít/số nhiều, không để "{n} clusters"', () => {
    const hits: string[] = []
    for (const { file, text, lineOffset } of enSources()) {
      for (const hit of pluralHits(text)) {
        hits.push(`${file}:${lineOffset + hit.line} — ${hit.sample}`)
      }
    }
    expect(hits, 'dùng plural(n, …) hoặc {n, plural, one {…} other {…}} cho danh từ đếm được').toEqual([])
  })


  it('plural() chọn dạng theo Intl.PluralRules', () => {
    setLocale('en')
    expect(plural(1, 'file', 'files')).toBe('file')
    expect(plural(0, 'file', 'files')).toBe('files')
    expect(plural(2, 'file', 'files')).toBe('files')
    // Tiếng Việt không biến đổi hình thái: luôn dùng dạng "other".
    setLocale('vi')
    expect(plural(1, 'tệp', 'tệp')).toBe('tệp')
  })

  it('tr() xử lý khối {count, plural, one {…} other {…}} trong bản Anh', () => {
    setLocale('en')
    expect(tr('{count} tệp', { count: 1 })).toBe('1 file')
    expect(tr('{count} tệp', { count: 3 })).toBe('3 files')
    // Không có vars thì giữ nguyên khối, không ném lỗi.
    expect(tr('{count} tệp')).toBe('{count} {count, plural, one {file} other {files}}')
    setLocale('vi')
    expect(tr('{count} tệp', { count: 1 })).toBe('1 tệp')
  })

  it('chuỗi đếm trong i18n EN dùng số ít khi n = 1', () => {
    setLocale('en')
    expect(vi.arch.files(1)).toBe('1 file')
    expect(vi.arch.files(2)).toBe('2 files')
    expect(vi.flows.meta(2, 1)).toBe('2 steps · 1 file')
    expect(vi.flows.meta(1, 2)).toBe('1 step · 2 files')
    expect(vi.changes.hops(1)).toBe('1 step')
    expect(vi.large.files(1)).toBe('1 file')
    expect(vi.overview.stats(1, 1, 1)).toBe('1 file · 1 node · 1 edge')
    expect(vi.overview.stats(2, 3, 4)).toBe('2 files · 3 nodes · 4 edges')
    // M1 (review #51): các chuỗi đếm từng sót "1 clusters / 1 days / 1 times…".
    expect(vi.overview.clusters(1)).toBe('Split into 1 cluster')
    expect(vi.prs.days(1)).toBe('1 day ago')
    expect(vi.memory.times(1)).toBe('1 time')
    expect(vi.chat.verified(1, 1)).toBe('1/1 citation verified')
    expect(vi.semantic.labelsDone(1)).toBe('Done: named 1 cluster.')
    expect(vi.report.benchmarkText('1', '2', '3')).toContain('~1 token.')
    expect(tr('Đã chia {n} cụm', { n: 1 })).toBe('Split into 1 cluster')
    expect(tr('{count} người tham gia', { count: 1 })).toBe('1 participant')
    expect(tr('{count} vấn đề', { count: 1 })).toBe('1 issue')
    expect(tr('tắt {count} tool', { count: 1 })).toBe('1 tool disabled')
    expect(tr('{days} ngày trước', { days: 1 })).toBe('1 day ago')
    expect(tr('{errors} lỗi, {warnings} cảnh báo', { errors: 1, warnings: 2 })).toBe('1 error, 2 warnings')
    setLocale('vi')
    expect(vi.flows.meta(2, 1)).toBe('2 bước · 1 tệp')
    expect(vi.overview.stats(1, 1, 1)).toBe('1 tệp · 1 node · 1 cạnh')
  })
})
