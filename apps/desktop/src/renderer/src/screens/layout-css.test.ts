import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Hợp đồng CSS cho các sửa lỗi tràn chữ (review PR #45, mục I2/I3).
 * jsdom không tính layout nên không đo được `wordBreak` thật; bằng chứng đo nằm ở
 * ui/F5/checks.md. Test này chặn việc xoá/đè mất đúng các khai báo đã sửa.
 */
const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const css = `${read('../styles.css')}\n${read('./workspace.css')}`

/** Các rule khai báo `property` với selector khớp `pattern`. */
function declarations(property: string, pattern: RegExp): { selector: string; value: string }[] {
  const out: { selector: string; value: string }[] = []
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1].replace(/\s+/g, ' ').trim()
    if (!pattern.test(selector)) continue
    const declaration = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(rule[2])
    if (declaration) out.push({ selector, value: declaration[1].trim() })
  }
  return out
}

describe('CSS bảng Báo cáo (I2)', () => {
  it('ô đường dẫn trong bảng Báo cáo không bị .mono bẻ giữa từ', () => {
    // `.mono` đặt word-break: break-all trực tiếp trên td nên thắng giá trị thừa kế từ table.
    const cells = declarations('word-break', /\.report-view\s+td\.mono$/)
    expect(cells, 'cần rule .report-view td.mono đặt word-break: normal').not.toEqual([])
    expect(cells.map((rule) => rule.value)).toEqual(['normal'])
  })
})
