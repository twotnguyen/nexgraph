import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { LspManager } from '../src/main/lsp/manager'

// Chạy language server thật (typescript-language-server, pyright) qua Node hiện tại.
let root: string
const lsp = new LspManager()
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ng-lsp-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src/math.ts'), 'export function addTwo(a: number): number {\n  return a + 2\n}\n')
  writeFileSync(join(root, 'tsconfig.json'), '{ "compilerOptions": { "strict": true } }\n')
  writeFileSync(join(root, 'helpers.py'), 'def greet(name):\n    return "hi " + name\n')
})
afterAll(() => { lsp.stopAll(); rmSync(root, { recursive: true, force: true }) })

it('TypeScript: nhảy tới định nghĩa ở tệp khác và gợi ý thành viên', async () => {
  const text = "import { addTwo } from './math'\nconst n = addTwo(1)\nconst list = [1, 2]\nlist.\n"
  writeFileSync(join(root, 'src/main.ts'), text)
  await lsp.open(root, 'src/main.ts', text)
  // Vị trí tính từ 0 như LSP. tsserver dựng dự án bất đồng bộ sau didOpen nên chờ tới khi có kết quả.
  await vi.waitFor(async () => expect(await lsp.definition(root, 'src/main.ts', text, 1, 11)).toEqual([{ file: 'src/math.ts', line: 1, column: 17 }]), { timeout: 20_000, interval: 300 })
  const items = await lsp.completion(root, 'src/main.ts', text, 3, 5)
  expect(items.map((i) => i.label)).toContain('map')
  expect(await lsp.hover(root, 'src/main.ts', text, 1, 11)).toContain('addTwo(a: number): number')
}, 60_000)

it('Python: nhảy tới định nghĩa qua pyright', async () => {
  const text = 'from helpers import greet\nprint(greet("a"))\n'
  writeFileSync(join(root, 'app.py'), text)
  expect(await lsp.definition(root, 'app.py', text, 1, 7)).toEqual([{ file: 'helpers.py', line: 1, column: 5 }])
}, 60_000)

it('TypeScript: khai báo lùi về định nghĩa khi server thiếu declarationProvider, định nghĩa kiểu trả interface', async () => {
  writeFileSync(join(root, 'src/types.ts'), 'export interface Box {\n  value: number\n}\n')
  const text = "import { addTwo } from './math'\nimport type { Box } from './types'\nconst box: Box = { value: addTwo(1) }\n"
  writeFileSync(join(root, 'src/decl.ts'), text)
  await lsp.open(root, 'src/decl.ts', text)
  // typescript-language-server không đăng ký textDocument/declaration: như VS Code, lệnh khai báo lùi về định nghĩa thay vì báo lỗi.
  await vi.waitFor(async () => expect(await lsp.declaration(root, 'src/decl.ts', text, 2, 26)).toEqual([{ file: 'src/math.ts', line: 1, column: 17 }]), { timeout: 20_000, interval: 300 })
  expect(await lsp.declaration(root, 'src/decl.ts', text, 1, 15)).toEqual([{ file: 'src/types.ts', line: 1, column: 18 }])
  expect(await lsp.typeDefinition(root, 'src/decl.ts', text, 2, 6)).toEqual([{ file: 'src/types.ts', line: 1, column: 18 }])
}, 60_000)
