// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mountOverflowWidgets, overflowWidgetsHost } from '../src/renderer/src/features/editor/overflowWidgets'

// BUG-AB: monaco 0.57 không còn CSS định vị `.overflowingContentWidgets`, nên phải cấp
// `overflowWidgetsDomNode` riêng ở 0,0 của container editor để gốc toạ độ widget tràn không phụ
// thuộc bố cục bên ngoài.
describe('khung chứa widget tràn của Monaco', () => {
  it('tạo khung 0×0 ở gốc container, không cắt widget con và mang class monaco-editor', () => {
    const node = overflowWidgetsHost()
    expect(node.className).toContain('monaco-editor')
    expect(node.style.position).toBe('absolute')
    expect(node.style.top).toBe('0px')
    expect(node.style.left).toBe('0px')
    expect(node.style.width).toBe('0px')
    expect(node.style.height).toBe('0px')
    expect(node.style.overflow).toBe('visible')
  })

  it('mỗi editor một khung riêng để gỡ editor không mất widget của editor khác', () => {
    expect(overflowWidgetsHost()).not.toBe(overflowWidgetsHost())
  })

  it('gắn khung vào container và nâng container tĩnh lên relative để khung nằm đúng gốc editor', () => {
    const container = document.createElement('div')
    const host = overflowWidgetsHost()
    const detach = mountOverflowWidgets(container, host)
    expect(host.parentElement).toBe(container)
    expect(container.style.position).toBe('relative')

    detach()
    expect(host.parentElement).toBeNull()
    expect(container.style.position).toBe('')
  })

  it('không đổi position của container đã định vị, và không khôi phục nhầm khi dispose', () => {
    const fixed = document.createElement('div')
    fixed.style.position = 'absolute'
    const host = overflowWidgetsHost()
    const detach = mountOverflowWidgets(fixed, host)
    expect(fixed.style.position).toBe('absolute')
    detach()
    expect(fixed.style.position).toBe('absolute')
  })
})

// Nguyên nhân gốc của hover lệch (đo trên app thật): khối `prefers-reduced-motion` đặt
// `transition-duration: .01ms !important` cho `*`, nên mọi thay đổi `height` của widget Monaco bị
// hoãn sang frame sau. Monaco phồng `.monaco-resizable-hover` bằng chiều cao editor rồi ĐỌC
// getBoundingClientRect() ngay trong cùng task: với transition > 0, lần đọc đầu trả về chiều cao CŨ
// (đang phồng) ⇒ `top = neo - chiều cao editor` ⇒ hover lệch đúng một chiều cao editor và bị cắt.
// Vì vậy cây editor phải được miễn trừ khỏi hiệu ứng chuyển động toàn cục.
describe('CSS: cây Monaco miễn nhiễm transition khi giảm chuyển động', () => {
  const css = readFileSync(resolve(__dirname, '../src/renderer/src/styles.css'), 'utf8')

  const blockOf = (selectorStart: string): string => {
    const at = css.indexOf(selectorStart)
    expect(at, `không thấy khối ${selectorStart}`).toBeGreaterThan(-1)
    const open = css.indexOf('{', at)
    let depth = 0
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') {
        depth--
        if (depth === 0) return css.slice(open + 1, i)
      }
    }
    throw new Error(`khối ${selectorStart} không đóng`)
  }

  it('khối reduced-motion của app vẫn đặt transition > 0 cho * (lý do phải miễn trừ)', () => {
    const block = blockOf('@media (prefers-reduced-motion: reduce)')
    // Không khoá nguyên văn `.01ms`: điều cần bảo vệ là luật toàn cục CÓ transition dương
    // (nếu sau này đổi thành 0s thì miễn trừ cây editor là thừa và test phải báo).
    const star = /\*,\s*\*::before,\s*\*::after\s*\{([^}]*)\}/.exec(block)
    expect(star, 'không thấy luật * trong khối reduced-motion').not.toBeNull()
    const duration = /transition-duration:\s*([\d.]+)\s*(ms|s)\s*!important/.exec(star![1])
    expect(duration, 'luật * phải đặt transition-duration có đơn vị').not.toBeNull()
    const milliseconds = Number(duration![1]) * (duration![2] === 's' ? 1000 : 1)
    expect(milliseconds).toBeGreaterThan(0)
  })

  it('khối reduced-motion miễn trừ toàn bộ cây .monaco-editor khỏi transition và animation', () => {
    const block = blockOf('@media (prefers-reduced-motion: reduce)')
    const at = block.indexOf('.monaco-editor,')
    expect(at).toBeGreaterThan(-1)
    const rule = block.slice(at, block.indexOf('}', at) + 1)
    expect(rule).toMatch(/\.monaco-editor\s*\*/)
    expect(rule).toMatch(/transition-duration:\s*0s\s*!important/)
    expect(rule).toMatch(/animation-duration:\s*0s\s*!important/)
  })
})
