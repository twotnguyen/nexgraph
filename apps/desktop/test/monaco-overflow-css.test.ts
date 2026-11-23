import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// UI-05 (lỗi B): monaco-editor 0.57 không kèm CSS định vị `.overflowingContentWidgets`. Khung chứa
// đứng yên ở cuối editor (position: static) nên widget con neo vào `.monaco-editor` thay vì khung
// chứa: hover được tính `top` theo khung chứa nhưng vẽ lệch đúng bằng chiều cao editor, ra ngoài
// khung nhìn. Test này ghim bất biến "khung chứa widget tràn phải được định vị" và việc CSS đó
// được nạp cùng module editor.
const dir = fileURLToPath(new URL('../src/renderer/src/components/editor/', import.meta.url))
const read = (file: string) => readFileSync(join(dir, file), 'utf8')

describe('CSS widget tràn của Monaco', () => {
  it('định vị .overflowingContentWidgets để hover không vẽ ra ngoài khung nhìn', () => {
    const css = read('monaco.css')
    const rule = /\.monaco-editor\s+\.overflowingContentWidgets\s*\{([^}]*)\}/.exec(css)
    expect(rule).not.toBeNull()
    expect(rule?.[1]).toMatch(/position:\s*absolute/)
  })

  it('monaco.ts nạp monaco.css để luật trên có hiệu lực ở mọi editor', () => {
    expect(read('monaco.ts')).toMatch(/^import '\.\/monaco\.css'$/m)
  })
})
