import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// DSK-03: cờ lint chỉ được nằm trong ci.yml trước đây nên không ai chạy lại được bằng một lệnh.
// Test này đọc ci.yml và package.json gốc, bóc lệnh thành token rồi so **tập** cờ hai chiều — không
// bám chuỗi nguyên văn để CI đổi định dạng YAML (folded scalar, xuống dòng) vẫn đọc đúng nghĩa.
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8')
const scripts = (): Record<string, string> => (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts
const ci = read('.github/workflows/ci.yml')

const flat = (text: string): string => text.replace(/\s+/g, ' ')
const tokens = (text: string): string[] => text.split(/\s+/).filter(Boolean)

/** Khối `run:` của một bước CI: từ dòng chứa `marker` tới bước/job kế tiếp. */
function stepAfter(marker: string): string {
  const lines = ci.split(/\r?\n/)
  const start = lines.findIndex((line) => line.includes(marker))
  if (start < 0) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^\s{0,6}-\s/.test(line) || /^\s{0,2}\S/.test(line))
  return [lines[start], ...(end < 0 ? rest : rest.slice(0, end))].join('\n')
}

/** Lệnh ruff bóc thành token: CI viết nhiều dòng, script nối bằng `&&` — cả hai về cùng dạng. */
function ruffCommand(text: string): { version: string; select: string[]; paths: string[] } | null {
  const match = /uvx ruff@(\S+) check --select ([^\s&|]+)([^&|]*)/.exec(flat(text))
  if (!match) return null
  return {
    version: match[1],
    select: match[2].split(',').sort(),
    paths: tokens(match[3]).filter((token) => token.startsWith('engine/')).sort()
  }
}

/** Lệnh Biome: phiên bản, mức chẩn đoán, tập `--skip` và đường dẫn lint. */
function biomeCommand(text: string): { version: string; diagnosticLevel: string | null; skips: string[]; paths: string[] } | null {
  const match = /@biomejs\/biome@(\S+) lint([^&|]*)/.exec(flat(text))
  if (!match) return null
  const tail = match[2]
  return {
    version: match[1],
    diagnosticLevel: /--diagnostic-level=([^\s&|]+)/.exec(tail)?.[1] ?? null,
    skips: [...tail.matchAll(/--skip=([^\s&|]+)/g)].map((item) => item[1]).sort(),
    paths: tokens(tail).filter((token) => /^apps\/desktop\/[\w/-]+$/.test(token)).sort()
  }
}

describe('script lint ở gốc chạy đúng như CI', () => {
  it('có lint, lint:engine và lint:desktop', () => {
    const names = Object.keys(scripts())
    expect(names).toEqual(expect.arrayContaining(['lint', 'lint:engine', 'lint:desktop']))
    expect(scripts().lint).toContain('lint:engine')
    expect(scripts().lint).toContain('lint:desktop')
  })

  it('lint:engine khớp CI theo token: phiên bản, bộ luật và đường dẫn', () => {
    const fromCi = ruffCommand(stepAfter('Ruff (engine)'))
    const fromScript = ruffCommand(scripts()['lint:engine'])
    expect(fromCi).not.toBeNull()
    expect(fromScript).toEqual(fromCi)
  })

  it('lint:desktop khớp CI cả hai chiều: phiên bản, mức chẩn đoán và tập --skip bằng nhau', () => {
    const fromCi = biomeCommand(stepAfter('@biomejs/biome'))
    const fromScript = biomeCommand(scripts()['lint:desktop'])
    expect(fromCi).not.toBeNull()
    expect(fromScript?.version).toBe(fromCi?.version)
    expect(fromScript?.diagnosticLevel).toBe(fromCi?.diagnosticLevel)
    // So tập bằng nhau: thêm `--skip` riêng ở một bên (lỏng hơn CI) cũng đỏ, không chỉ thiếu cờ.
    expect(fromScript?.skips).toEqual(fromCi?.skips)
    expect(fromScript?.skips.length).toBeGreaterThan(0)
  })

  it('bóc lệnh không phụ thuộc định dạng YAML: folded scalar và xuống dòng vẫn cùng token', () => {
    const folded = 'run: >-\n  uvx ruff@0.14.0 check --select E9,F63,F7,F82\n  engine/src/nexgraph_engine engine/tests'
    expect(ruffCommand(folded)).toEqual(ruffCommand(scripts()['lint:engine']))
    expect(biomeCommand('@biomejs/biome@2.3.0 lint\n  --skip=a11y\n  apps/desktop/src')?.skips).toEqual(['a11y'])
  })

  // e2e/ (spec Playwright) được lint ở máy qua `lint:desktop`, không phải script `lint` riêng: `lint` giữ nguyên
  // chuỗi lint:engine && lint:desktop để không mất cổng ruff. ci.yml hiện chỉ lint `apps/desktop/src` nên e2e/
  // chưa có cổng CI (đợi X1); test chỉ đòi local phủ mọi đường dẫn CI lint nên vẫn đúng khi CI mở rộng.
  it('lint:desktop phủ thêm e2e/ ngoài phạm vi Biome của CI', () => {
    expect(scripts()['lint:desktop']).toContain('apps/desktop/e2e')
    const fromCi = biomeCommand(stepAfter('@biomejs/biome'))
    const fromScript = biomeCommand(scripts()['lint:desktop'])
    expect(fromCi?.paths.length).toBeGreaterThan(0)
    for (const path of fromCi?.paths ?? []) expect(fromScript?.paths).toContain(path)
  })

  it('không bật format khi Biome format sẽ đổi hàng loạt tệp', () => {
    const names = Object.keys(scripts())
    expect(names).not.toContain('format')
    expect(names).not.toContain('format:check')
  })
})
