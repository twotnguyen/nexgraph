import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { replaceText, searchText } from '../src/main/search/text-search'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ng-search-'))
  mkdirSync(join(root, 'src'))
  mkdirSync(join(root, 'build'))
  mkdirSync(join(root, 'node_modules'))
  writeFileSync(join(root, '.gitignore'), 'secret.ts\n')
  writeFileSync(join(root, 'src/a.ts'), 'const total = price * qty\nfunction totalOf() { return total }\r\n')
  writeFileSync(join(root, 'src/b.py'), 'TOTAL = 1\nsubtotal = 2\n')
  writeFileSync(join(root, 'secret.ts'), 'total\n')
  writeFileSync(join(root, 'node_modules/x.js'), 'total\n')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

it('tìm theo chữ, bỏ tệp .gitignore và thư mục sinh ra; whole word và hoa thường', async () => {
  const any = await searchText(root, { query: 'total' })
  expect(any.files.map((f) => f.file).sort()).toEqual(['src/a.ts', 'src/b.py'])
  const word = await searchText(root, { query: 'total', wholeWord: true, caseSensitive: true })
  expect(word.files).toEqual([{ file: 'src/a.ts', matches: [
    { line: 1, column: 7, length: 5, preview: 'const total = price * qty', previewStart: 0 },
    { line: 2, column: 29, length: 5, preview: 'function totalOf() { return total }', previewStart: 0 }
  ] }])
  const py = await searchText(root, { query: 'total', include: '*.py' })
  expect(py.files.map((f) => f.file)).toEqual(['src/b.py'])
  await expect(searchText(root, { query: '(', regex: true })).rejects.toMatchObject({ code: 'bad_param' })
})

it('thay bằng regex có nhóm, chữ thường giữ $ nguyên văn, giữ CRLF của tệp', async () => {
  const done = await replaceText(root, { query: 'total(Of)?', regex: true, caseSensitive: true }, 'sum$1', ['src/a.ts'])
  expect(done).toEqual({ files: 1, replacements: 3, skipped: [] })
  expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe('const sum = price * qty\r\nfunction sumOf() { return sum }\r\n')
  await replaceText(root, { query: 'TOTAL', caseSensitive: true }, '$cost', ['src/b.py'])
  expect(readFileSync(join(root, 'src/b.py'), 'utf8')).toBe('$cost = 1\nsubtotal = 2\n')
  // Tệp không được chọn thì không đổi.
  expect(readFileSync(join(root, 'secret.ts'), 'utf8')).toBe('total\n')
})
