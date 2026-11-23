// PR #49 (N1): styles/tab-motion.css không được tái hiện BUG-B (#42c) — không transition/animation
// trên tổ tiên của .monaco-editor, và phần chuyển động còn lại phải tắt khi người dùng giảm
// chuyển động. `styles.css` đã miễn trừ cây .monaco-editor; file này phải không tạo lại vấn đề.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(__dirname, '../src/renderer/src/styles/tab-motion.css'), 'utf8')

/** CSS đã bỏ comment để không bắt nhầm chữ trong /* … *\/ là selector. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')
/** Các selector (phần trước `{`) của mọi luật trong file, bỏ khối @media. */
const selectors = [...rules.matchAll(/(^|\n)([^@{}\n][^{}]*)\{/g)]
  .map((match) => match[2].trim())
  .filter((selector) => selector && !selector.startsWith('@'))

describe('tab-motion.css: an toàn cho cây Monaco', () => {
  it('không đụng .monaco-editor hay luật toàn cục *', () => {
    for (const selector of selectors) {
      expect(selector, `selector ${selector} chạm cây editor`).not.toMatch(/\.monaco-editor/)
      expect(selector, `selector ${selector} là luật toàn cục`).not.toMatch(/(^|,)\s*\*(\s*,|$)/)
    }
  })

  it('không animate tổ tiên của editor: .canvas-wrap > * chứa .code-viewer.editor-tab', () => {
    for (const selector of selectors) {
      expect(selector, `selector ${selector} animate container của editor`).not.toContain('canvas-wrap')
    }
    expect(css).not.toMatch(/@keyframes\s+tab-panel-in/)
  })

  it('phần chuyển động còn lại tắt khi prefers-reduced-motion: reduce', () => {
    const at = css.indexOf('@media (prefers-reduced-motion: reduce)')
    expect(at, 'thiếu khối prefers-reduced-motion').toBeGreaterThan(-1)
    const block = css.slice(at)
    expect(block).toMatch(/\.workspace-shell \.ws-tabs::after/)
    expect(block).toMatch(/animation:\s*none\s*!important/)
    expect(block).toMatch(/transition:\s*none\s*!important/)
  })
})
