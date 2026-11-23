import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// MIN-43 M2: timeout dài phải nằm đúng ca git thật chậm (push/fetch/pull trên Windows CI), không áp cả tệp —
// nếu áp cả tệp thì một test chậm bất thường vẫn xanh sau 30 s. Đọc mã nguồn vì không có máy Windows cục bộ.
const source = readFileSync(new URL('./git-repo.test.ts', import.meta.url), 'utf8')

describe('cấu hình timeout test git', () => {
  it('không nới testTimeout cho cả tệp', () => {
    expect(source).not.toMatch(/setConfig\(\{\s*testTimeout/)
  })

  it('ca push/fetch/pull có timeout riêng 15 s chỉ trên Windows; ca khác giữ mặc định', () => {
    expect(source).toMatch(/const WINDOWS_SLOW_GIT = process\.platform === 'win32' \? \{ timeout: 15_000 \} : \{\}/)
    expect(source).toMatch(/it\('push, fetch và pull dùng kho bare cục bộ', WINDOWS_SLOW_GIT,/)
    const others = [...source.matchAll(/^it\('([^']+)'(, [^,]+)?, async/gm)].filter((m) => m[2] !== undefined)
    expect(others.map((m) => m[1])).toEqual(['push, fetch và pull dùng kho bare cục bộ'])
  })
})
