import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// DSK-03: cờ lint chỉ được nằm trong ci.yml trước đây nên không ai chạy lại được bằng một lệnh.
// Test này đọc ci.yml và package.json gốc để bắt hai bên lệch nhau (thêm/bớt --skip mà quên đồng bộ).
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8')
const scripts = (): Record<string, string> => (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts
const lintCommands = () => Object.entries(scripts())
  .filter(([name]) => name === 'lint' || name.startsWith('lint:'))
  .map(([, command]) => command)
  .join(' && ')
const ci = read('.github/workflows/ci.yml')

describe('script lint ở gốc chạy đúng như CI', () => {
  it('có lint, lint:engine và lint:desktop', () => {
    const names = Object.keys(scripts())
    expect(names).toEqual(expect.arrayContaining(['lint', 'lint:engine', 'lint:desktop']))
    expect(scripts().lint).toContain('lint:engine')
    expect(scripts().lint).toContain('lint:desktop')
  })

  it('lint:engine dùng đúng lệnh ruff của CI', () => {
    expect(ci).toContain('uvx ruff@0.14.0 check --select E9,F63,F7,F82 engine/src/nexgraph_engine engine/tests')
    const ruff = /uvx ruff@[\d.]+ check --select [\w,]+ engine\/src\/nexgraph_engine engine\/tests/.exec(ci)?.[0]
    expect(ruff).toBeTruthy()
    expect(lintCommands()).toContain(ruff as string)
  })

  it('lint:desktop dùng đúng phiên bản Biome và mọi cờ --skip của CI', () => {
    expect(lintCommands()).toContain('@biomejs/biome@2.3.0')
    expect(lintCommands()).toContain('lint')
    expect(lintCommands()).toContain('--diagnostic-level=error')
    expect(lintCommands()).toContain('apps/desktop/src')
    const skips = [...new Set(ci.match(/--skip=[\w/]+/g) ?? [])]
    expect(skips.length).toBeGreaterThan(0)
    for (const skip of skips) expect(lintCommands()).toContain(skip)
  })

  // e2e/ (spec Playwright) được lint ở máy qua `lint:desktop`, không phải script `lint` riêng: `lint` giữ nguyên
  // chuỗi lint:engine && lint:desktop để không mất cổng ruff. ci.yml hiện chỉ lint `apps/desktop/src` nên e2e/
  // chưa có cổng CI (đợi X1); test chỉ đòi local phủ mọi đường dẫn CI lint nên vẫn đúng khi CI mở rộng.
  it('lint:desktop phủ thêm e2e/ ngoài phạm vi Biome của CI', () => {
    expect(scripts()['lint:desktop']).toContain('apps/desktop/e2e')
    const biomeStep = ci.slice(ci.indexOf('npx --yes @biomejs/biome'))
    const ciPaths = [...new Set(biomeStep.slice(0, biomeStep.indexOf('\n\n')).match(/apps\/desktop\/[\w/-]+/g) ?? [])]
    expect(ciPaths.length).toBeGreaterThan(0)
    for (const path of ciPaths) expect(lintCommands()).toContain(path)
  })

  it('không bật format khi Biome format sẽ đổi hàng loạt tệp', () => {
    const names = Object.keys(scripts())
    expect(names).not.toContain('format')
    expect(names).not.toContain('format:check')
  })
})
