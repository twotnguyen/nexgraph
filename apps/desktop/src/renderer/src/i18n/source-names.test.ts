import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { relPosix, toPosix } from './scanPaths'

/**
 * LIC-3 (ADR 0025): chuỗi người dùng thấy không được nêu tên dự án nguồn.
 * Quét i18n VI+EN, `shared/**` (chuỗi hiển thị), nhãn menu native và màn Giấy phép.
 * Ngoại lệ có lý do và đều hẹp: màn Giấy phép; mô tả nhà cung cấp "OpenCode Zen/Go" ở `uiEn-screens.ts`;
 * ID nền tảng nội bộ; đúng token tên tệp thật `.graphifyrc`.
 *
 * Chỉ quét literal chuỗi (không quét tên biến/khoá không trích dẫn hay comment), nên
 * `openCode:` hay ghi chú kỹ thuật không bị báo nhầm. Đường dẫn luôn chuẩn hoá "/" để
 * CI Windows không đỏ oan (review #57 C1).
 */
const APP = fileURLToPath(new URL('../../../../', import.meta.url))
const FORBIDDEN = /graphify|opencode/i
const ALLOWED: { file?: RegExp; value?: RegExp; why: string }[] = [
  {
    file: /^src\/renderer\/src\/i18n\/uiEn-screens\.ts$/,
    value: /^(?:Gói )?OpenCode (?:Zen|Go)\b/,
    why: 'mô tả nhà cung cấp dịch vụ "OpenCode Zen/Go" trong danh sách đăng nhập (ADR 0025 §1): neo đầu chuỗi, đúng ranh giới từ, chỉ ở tệp chứa các mô tả đó'
  },
  { file: /^\.\.\/\.\.\/packages\/contracts\/src\/integration-types\.ts$/, value: /^opencode$/, why: 'ID nền tảng nội bộ cho khoá cấu hình MCP, không hiển thị' },
  { file: /^src\/renderer\/src\/screens\/LicensesScreen\.tsx$/, why: 'màn Giấy phép mã nguồn mở — nơi duy nhất được nêu tên nguồn' }
]
/**
 * Tên tệp THẬT mà engine đọc (`graphify/rcfile.RC_FILENAME`, `index/discovery.py`): người dùng phải tự tạo
 * đúng tên này nên chỉ dẫn UI phải nêu được. ADR 0025 chỉ đổi tên hiển thị thương hiệu, không giấu đường dẫn
 * hay tên tệp thật. Chỉ khớp ĐÚNG token (không dính chữ/dấu chấm/gạch nối đằng trước, không là đầu của tên
 * dài hơn như `.graphifyrc2`, `.graphifyrc-cu`, `.graphifyrc.bak`); token bị cắt khỏi chuỗi trước khi kiểm
 * nên "Graphify" đứng riêng trong cùng chuỗi vẫn bị báo.
 */
const REAL_FILE_TOKENS: { token: RegExp; why: string }[] = [
  { token: /(?<![\w.-])\.graphifyrc(?![\w-]|\.\w)/g, why: 'tên tệp cấu hình ở gốc dự án mà engine đọc (ánh xạ đuôi tệp → ngôn ngữ)' }
]

type SourceFile = { file: string; text: string }
type Violation = { file: string; line: number; value: string }

/** Literal chuỗi một nháy, hai nháy hoặc template (bỏ qua escape). */
const LITERAL = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g

/** Chuỗi sau khi cắt các token tên tệp thật; chỉ phần còn lại mới bị kiểm tên nguồn. */
const withoutRealFileTokens = (value: string): string =>
  REAL_FILE_TOKENS.reduce((text, { token }) => text.replace(token, ' '), value)

function scanSourceNames(files: SourceFile[]): Violation[] {
  const found: Violation[] = []
  for (const source of files) {
    const file = toPosix(source.file)
    for (const match of source.text.matchAll(LITERAL)) {
      const value = match[2]
      if (!FORBIDDEN.test(withoutRealFileTokens(value))) continue
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
    join(APP, 'src/main/app/app-menu-labels.ts'),
    ...sources(join(APP, '../../packages/contracts/src')),
    join(APP, 'src/renderer/src/screens/LicensesScreen.tsx')
  ]
  return targets.map((path) => ({ file: relPosix(APP, path), text: readFileSync(path, 'utf8') }))
}

describe('quét tên nguồn trong chuỗi hiển thị (LIC-3)', () => {
  it('i18n VI+EN, contracts và nhãn menu không chứa graphify/opencode (trừ ngoại lệ có lý do)', () => {
    const violations = scanSourceNames(displaySources())
    expect(violations.map((v) => `${v.file}:${v.line} ${v.value}`)).toEqual([])
  })

  it('bộ quét bắt được vi phạm và chuẩn hoá đường dẫn "\\" của Windows sang "/"', () => {
    const violations = scanSourceNames([
      { file: 'src\\renderer\\src\\strings.ts', text: "const a = 'NexGraph'\nconst b = 'Mở OpenCode'\n" },
      { file: '..\\..\\packages\\contracts\\src\\api.ts', text: '// Graphify trong comment không tính\nconst c = `dùng Graphify`\n' }
    ])
    expect(violations).toEqual([
      { file: 'src/renderer/src/strings.ts', line: 2, value: 'Mở OpenCode' },
      { file: '../../packages/contracts/src/api.ts', line: 2, value: 'dùng Graphify' }
    ])
    expect(violations.every((v) => !v.file.includes('\\'))).toBe(true)
  })

  it('ngoại lệ: tên nhà cung cấp OpenCode Zen/Go và ID nền tảng nội bộ', () => {
    expect(scanSourceNames([{ file: 'src/renderer/src/i18n/uiEn-screens.ts', text: "'OpenCode Zen: dùng API key'" }])).toEqual([])
    expect(scanSourceNames([{ file: '../../packages/contracts/src/integration-types.ts', text: "'opencode'" }])).toEqual([])
    // Cùng chữ "OpenCode" nhưng không phải tên nhà cung cấp thì vẫn báo.
    expect(scanSourceNames([{ file: 'src/renderer/src/strings.ts', text: "'Kết nối OpenCode'" }])).toHaveLength(1)
  })

  it('ngoại lệ hẹp: chỉ token tên tệp thật ".graphifyrc"; "Graphify" đứng riêng vẫn bị báo (B2)', () => {
    const scan = (text: string) => scanSourceNames([{ file: 'src/renderer/src/strings.ts', text }])
    // Đúng token tên tệp (chỉ dẫn thật của hộp Tuỳ chọn index, VI + EN): được phép.
    expect(scan("'Đổi ngôn ngữ của một đuôi tệp bằng .graphifyrc ở gốc dự án, ví dụ language.inc = php'")).toEqual([])
    expect(scan("'Override the language of a file extension with .graphifyrc at the project root, for example language.inc = php'")).toEqual([])
    expect(scan("'Tạo .graphifyrc.'")).toEqual([])
    expect(scan("'Tạo (.graphifyrc), rồi index lại'")).toEqual([])
    expect(scan('`${root}/.graphifyrc`')).toEqual([])
    // Tên nguồn đứng riêng vẫn báo, kể cả khi cùng chuỗi có đúng token tên tệp.
    expect(scan("'Graphify'")).toHaveLength(1)
    expect(scan("'Dùng Graphify để lập chỉ mục'")).toHaveLength(1)
    expect(scan("'Tạo .graphifyrc cho Graphify'")).toHaveLength(1)
    expect(scan("'Tạo .graphifyrc rồi mở OpenCode'")).toHaveLength(1)
    // Không phải đúng tên tệp: vẫn báo.
    for (const text of ["'graphifyrc'", "'x.graphifyrc'", "'..graphifyrc'", "'-.graphifyrc'", "'.graphifyrc2'", "'.graphifyrcs'",
      "'.graphifyrc-cu'", "'.graphifyrc.bak'", "'.Graphifyrc'", "'.GRAPHIFYRC'"]) {
      expect(scan(text), text).toHaveLength(1)
    }
  })

  it('ngoại lệ "OpenCode Zen/Go" hẹp: neo đầu chuỗi, đúng ranh giới từ, chỉ ở uiEn-screens.ts (F1)', () => {
    const providers = 'src/renderer/src/i18n/uiEn-screens.ts'
    // Bốn chuỗi thật: khoá VI và giá trị EN của hai mô tả nhà cung cấp.
    for (const text of ["'Gói OpenCode Go: dùng API key OpenCode, model lấy từ danh mục của OpenCode'",
      "'OpenCode Go plan: use an OpenCode API key; models come from the OpenCode catalog'",
      "'OpenCode Zen: dùng API key OpenCode, tính phí theo lượng dùng'",
      "'OpenCode Zen: use an OpenCode API key; pay as you go'"]) {
      expect(scanSourceNames([{ file: providers, text }]), text).toEqual([])
    }
    // Cùng chuỗi ở tệp khác: báo (trước đây khớp chuỗi con ở mọi tệp).
    for (const file of ['src/renderer/src/strings.ts', 'src/renderer/src/i18n/uiEn-agent.ts', '../../packages/contracts/src/api.ts', 'src/main/app/app-menu-labels.ts']) {
      expect(scanSourceNames([{ file, text: "'OpenCode Zen: dùng API key'" }]), file).toHaveLength(1)
    }
    // Đúng tệp nhưng không neo đầu chuỗi hoặc sai ranh giới từ: báo.
    for (const text of ["'Kết nối OpenCode Zen'", "'Mở OpenCode'", "'OpenCode Zenith'", "'OpenCodeZen'", "'OpenCode Gone'", "'Gói OpenCode'"]) {
      expect(scanSourceNames([{ file: providers, text }]), text).toHaveLength(1)
    }
  })
})
