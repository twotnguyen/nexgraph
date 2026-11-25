import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { relPosix, toPosix } from './scanPaths'

/**
 * LIC-3 (ADR 0025): chuỗi người dùng thấy không được nêu tên dự án nguồn.
 * Quét i18n VI+EN, `shared/**` (chuỗi hiển thị), nhãn menu native và màn Giấy phép.
 * Ngoại lệ có lý do: màn Giấy phép, tên nhà cung cấp "OpenCode Zen/Go", ID nền tảng nội bộ.
 *
 * Chỉ quét literal chuỗi (không quét tên biến/khoá không trích dẫn hay comment), nên
 * `openCode:` hay ghi chú kỹ thuật không bị báo nhầm. Đường dẫn luôn chuẩn hoá "/" để
 * CI Windows không đỏ oan (review #57 C1).
 */
const APP = fileURLToPath(new URL('../../../../', import.meta.url))
const FORBIDDEN = /graphify|opencode/i
const ALLOWED: { file?: RegExp; value?: RegExp; why: string }[] = [
  { value: /OpenCode (Zen|Go)/i, why: 'tên nhà cung cấp dịch vụ trong danh sách đăng nhập (ADR 0025 §1)' },
  { file: /^src\/shared\/integration-types\.ts$/, value: /^opencode$/, why: 'ID nền tảng nội bộ cho khoá cấu hình MCP, không hiển thị' },
  { file: /^src\/renderer\/src\/screens\/LicensesScreen\.tsx$/, why: 'màn Giấy phép mã nguồn mở — nơi duy nhất được nêu tên nguồn' }
]

type SourceFile = { file: string; text: string }
type Violation = { file: string; line: number; value: string }

/** Literal chuỗi một nháy, hai nháy hoặc template (bỏ qua escape). */
const LITERAL = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g

function scanSourceNames(files: SourceFile[]): Violation[] {
  const found: Violation[] = []
  for (const source of files) {
    const file = toPosix(source.file)
    for (const match of source.text.matchAll(LITERAL)) {
      const value = match[2]
      if (!FORBIDDEN.test(value)) continue
      if (ALLOWED.some((rule) => (!rule.file || rule.file.test(file)) && (!rule.value || rule.value.test(value)))) continue
      const line = source.text.slice(0, match.index).split('\n').length
      found.push({ file, line, value })
    }
  }
  return found
}

function sources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...sources(path))
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(path)
  }
  return out
}

/** Mọi tệp có chuỗi người dùng thấy trong phạm vi quét. */
function displaySources(): SourceFile[] {
  const targets = [
    join(APP, 'src/renderer/src/strings.ts'),
    ...readdirSync(join(APP, 'src/renderer/src/i18n')).filter((name) => /^uiEn-.*\.ts$/.test(name)).map((name) => join(APP, 'src/renderer/src/i18n', name)),
    join(APP, 'src/main/app-menu-labels.ts'),
    ...sources(join(APP, 'src/shared')),
    join(APP, 'src/renderer/src/screens/LicensesScreen.tsx')
  ]
  return targets.map((path) => ({ file: relPosix(APP, path), text: readFileSync(path, 'utf8') }))
}

describe('quét tên nguồn trong chuỗi hiển thị (LIC-3)', () => {
  it('i18n VI+EN, shared và nhãn menu không chứa graphify/opencode (trừ ngoại lệ có lý do)', () => {
    const violations = scanSourceNames(displaySources())
    expect(violations.map((v) => `${v.file}:${v.line} ${v.value}`)).toEqual([])
  })

  it('bộ quét bắt được vi phạm và chuẩn hoá đường dẫn "\\" của Windows sang "/"', () => {
    const violations = scanSourceNames([
      { file: 'src\\renderer\\src\\strings.ts', text: "const a = 'NexGraph'\nconst b = 'Mở OpenCode'\n" },
      { file: 'src\\shared\\api.ts', text: '// Graphify trong comment không tính\nconst c = `dùng Graphify`\n' }
    ])
    expect(violations).toEqual([
      { file: 'src/renderer/src/strings.ts', line: 2, value: 'Mở OpenCode' },
      { file: 'src/shared/api.ts', line: 2, value: 'dùng Graphify' }
    ])
    expect(violations.every((v) => !v.file.includes('\\'))).toBe(true)
  })

  it('ngoại lệ: tên nhà cung cấp OpenCode Zen/Go và ID nền tảng nội bộ', () => {
    expect(scanSourceNames([{ file: 'src/renderer/src/i18n/uiEn-screens.ts', text: "'OpenCode Zen: dùng API key'" }])).toEqual([])
    expect(scanSourceNames([{ file: 'src/shared/integration-types.ts', text: "'opencode'" }])).toEqual([])
    // Cùng chữ "OpenCode" nhưng không phải tên nhà cung cấp thì vẫn báo.
    expect(scanSourceNames([{ file: 'src/renderer/src/strings.ts', text: "'Kết nối OpenCode'" }])).toHaveLength(1)
  })
})
