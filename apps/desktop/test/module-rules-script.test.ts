import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEPENDENCY_CRUISER, IMPORT_LINTER, parseDepcruise, parseImportLinter } from '../../../tools/ci/module-rules.mjs'

// ADR 0026 pha 0: luật phụ thuộc module chạy cùng một lệnh ở máy và CI, công cụ ghim đúng phiên bản.
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8')
const scripts = (): Record<string, string> => (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts

describe('script luật phụ thuộc module', () => {
  it('pnpm rules:report / rules:strict gọi cùng script, CI chạy rules:strict (ADR 0026 pha 4e)', () => {
    expect(scripts()['rules:report']).toBe('node tools/ci/module-rules.mjs')
    expect(scripts()['rules:strict']).toBe('node tools/ci/module-rules.mjs --strict')
    const ci = read('.github/workflows/ci.yml')
    expect(ci).toMatch(/^\s+- run: pnpm rules:strict\s*$/m)
    expect(ci).not.toMatch(/^\s+- run: pnpm rules:report\s*$/m)
  })

  it('ghim phiên bản chính xác của công cụ', () => {
    expect(IMPORT_LINTER).toMatch(/^import-linter==\d+\.\d+(\.\d+)?$/)
    expect(DEPENDENCY_CRUISER).toMatch(/^dependency-cruiser@\d+\.\d+\.\d+$/)
  })

  it('đọc tổng kết import-linter', () => {
    const out = [
      'Analyzed 246 files, 862 dependencies.',
      '- nexgraph_engine.store.search -> nexgraph_engine.query.terms (l.8)',
      '-   nexgraph_engine.memory -> graphify.reflect (l.18)',
      'Contracts: 1 kept, 2 broken.',
    ].join('\n')
    expect(parseImportLinter(out)).toEqual({ kept: 1, broken: 2, violations: 2 })
    expect(parseImportLinter('Traceback: lỗi cấu hình')).toBeNull()
  })

  it('đọc tổng kết dependency-cruiser khi có và không có vi phạm', () => {
    expect(parseDepcruise('x 18 dependency violations (12 errors, 6 warnings). 606 modules, 2160 dependencies cruised.')).toEqual({
      violations: 18, errors: 12, warnings: 6, modules: 606,
    })
    expect(parseDepcruise('✔ no dependency violations found (606 modules, 2160 dependencies cruised)')).toEqual({
      violations: 0, errors: 0, warnings: 0, modules: 606,
    })
    expect(parseDepcruise('npm ERR! 404')).toBeNull()
  })
})
