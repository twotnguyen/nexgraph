import { chmodSync, statSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { fsHandlers, readProjectFile, resolveInside, writeProjectFile } from '../src/main/fs/project-fs'
import { toIpcResult } from '../src/main/ipc-result'

let root: string
let outsideDir: string
beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'ng-fs-'))
  root = join(base, 'proj')
  outsideDir = join(base, 'outside')
  mkdirSync(root)
  mkdirSync(outsideDir)
})

describe('project-fs', () => {
  it('chặn .. và đường dẫn tuyệt đối', () => {
    expect(() => resolveInside(root, '../x')).toThrow(expect.objectContaining({ code: 'outside_project' }))
    expect(() => resolveInside(root, '/etc/hosts')).toThrow(expect.objectContaining({ code: 'outside_project' }))
  })
  it('chặn symlink trỏ ra ngoài', async () => {
    symlinkSync(outsideDir, join(root, 'link'))
    await expect(writeProjectFile(root, 'link/a.txt', 'x', { eol: '\n', bom: false }))
      .rejects.toMatchObject({ code: 'outside_project' })
    expect(existsSync(join(outsideDir, 'a.txt'))).toBe(false)
  })
  it('chặn symlink treo, kể cả ở giữa đường dẫn và ở chính tệp cần ghi', async () => {
    // symlink treo ở thành phần giữa: ghi qua nó sẽ tạo tệp ngoài dự án
    symlinkSync(join(outsideDir, 'missing'), join(root, 'skills'))
    await expect(writeProjectFile(root, 'skills/nexgraph/SKILL.md', 'x', { eol: '\n', bom: false }))
      .rejects.toMatchObject({ code: 'outside_project' })
    expect(() => resolveInside(root, 'skills/nexgraph/SKILL.md')).toThrow(expect.objectContaining({ code: 'outside_project' }))
    expect(existsSync(join(outsideDir, 'missing'))).toBe(false)
    // symlink treo trực tiếp là tệp đích
    symlinkSync(join(outsideDir, 'gone.md'), join(root, 'AGENTS.md'))
    await expect(writeProjectFile(root, 'AGENTS.md', 'x', { eol: '\n', bom: false }))
      .rejects.toMatchObject({ code: 'outside_project' })
    expect(existsSync(join(outsideDir, 'gone.md'))).toBe(false)
    // đường dẫn chưa có thật (không symlink) vẫn được coi là tệp mới hợp lệ
    expect(resolveInside(root, 'new/deep/a.txt').endsWith(join('proj', 'new', 'deep', 'a.txt'))).toBe(true)
  })
  it('tạo thư mục cha còn thiếu khi ghi tệp mới', async () => {
    await writeProjectFile(root, 'new/dir/a.txt', 'x', { eol: '\n', bom: false })
    expect(readFileSync(join(root, 'new/dir/a.txt'), 'utf8')).toBe('x')
  })
  it('giữ CRLF và BOM khi ghi lại', async () => {
    writeFileSync(join(root, 'a.cs'), '﻿a\r\nb\r\n')
    const f = await readProjectFile(root, 'a.cs')
    expect(f).toMatchObject({ text: 'a\nb\n', eol: '\r\n', bom: true, readOnly: false })
    await writeProjectFile(root, 'a.cs', 'a\nc\n', { eol: f.eol, bom: f.bom })
    expect(readFileSync(join(root, 'a.cs'), 'utf8')).toBe('﻿a\r\nc\r\n')
  })
  it('tệp không phải UTF-8 và tệp > 5 MB mở chỉ đọc', async () => {
    writeFileSync(join(root, 'b.bin'), Buffer.from([0xff, 0xfe, 0x00, 0x80]))
    expect(await readProjectFile(root, 'b.bin')).toMatchObject({ readOnly: true, reason: 'not_text' })
    writeFileSync(join(root, 'big.txt'), 'a'.repeat(5 * 1024 * 1024 + 1))
    expect(await readProjectFile(root, 'big.txt')).toMatchObject({ readOnly: true, reason: 'too_large' })
  })
  it('báo file_not_found khi tệp không tồn tại', async () => {
    await expect(readProjectFile(root, 'nope.ts')).rejects.toMatchObject({ code: 'file_not_found' })
  })
  it('báo conflict khi tệp đổi trên đĩa', async () => {
    writeFileSync(join(root, 'c.ts'), '1')
    const f = await readProjectFile(root, 'c.ts')
    writeFileSync(join(root, 'c.ts'), '2')
    utimesSync(join(root, 'c.ts'), new Date(), new Date(Date.now() + 5000))
    await expect(writeProjectFile(root, 'c.ts', '3', { eol: '\n', bom: false, expectedMtimeMs: f.mtimeMs }))
      .rejects.toMatchObject({ code: 'conflict' })
    expect(readFileSync(join(root, 'c.ts'), 'utf8')).toBe('2')
  })
  it('không để lại tệp tạm khi đổi tên lỗi', async () => {
    mkdirSync(join(root, 'd')) // đích là thư mục có sẵn → rename lỗi
    await expect(writeProjectFile(root, 'd', 'x', { eol: '\n', bom: false })).rejects.toBeDefined()
    expect(readdirSync(root).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('không để lại tệp tạm khi thư mục đích chỉ đọc', async () => {
    mkdirSync(join(root, 'ro'))
    chmodSync(join(root, 'ro'), 0o555)
    try {
      await expect(writeProjectFile(root, 'ro/a.txt', 'x', { eol: '\n', bom: false })).rejects.toBeDefined()
      expect(readdirSync(join(root, 'ro'))).toEqual([])
    } finally {
      chmodSync(join(root, 'ro'), 0o755)
    }
  })
  it('FsError.code đi qua toIpcResult thành error.code', async () => {
    const r = await toIpcResult(() => writeProjectFile(root, '../x', 'x', { eol: '\n', bom: false }))
    expect(r).toMatchObject({ ok: false, error: { code: 'outside_project' } })
  })
  it('không ghi đè tệp chỉ đọc (not_text, too_large)', async () => {
    const bin = Buffer.from([0xff, 0xfe, 0x00, 0x80])
    writeFileSync(join(root, 'b.bin'), bin)
    await expect(writeProjectFile(root, 'b.bin', 'x', { eol: '\n', bom: false })).rejects.toMatchObject({ code: 'not_text' })
    expect(readFileSync(join(root, 'b.bin'))).toEqual(bin)
    writeFileSync(join(root, 'big.txt'), 'a'.repeat(5 * 1024 * 1024 + 1))
    await expect(writeProjectFile(root, 'big.txt', 'x', { eol: '\n', bom: false })).rejects.toMatchObject({ code: 'too_large' })
    await expect(writeProjectFile(root, 'new.txt', 'a'.repeat(5 * 1024 * 1024 + 1), { eol: '\n', bom: false }))
      .rejects.toMatchObject({ code: 'too_large' })
  })
  it.skipIf(process.platform === 'win32')('giữ quyền thực thi khi ghi lại', async () => {
    writeFileSync(join(root, 'run.sh'), 'a', { mode: 0o755 })
    chmodSync(join(root, 'run.sh'), 0o755)
    await writeProjectFile(root, 'run.sh', 'b', { eol: '\n', bom: false })
    expect(statSync(join(root, 'run.sh')).mode & 0o777).toBe(0o755)
  })
})

describe('fsHandlers qua toIpcResult', () => {
  const h = fsHandlers(async () => [{ project_id: 'p1', path: root }])
  it('ghi ngoài gốc dự án trả outside_project', async () => {
    expect(await toIpcResult(() => h.write('p1', '../x', 'x', { eol: '\n', bom: false })))
      .toMatchObject({ ok: false, error: { code: 'outside_project' } })
  })
  it('projectId lạ trả unknown_project', async () => {
    expect(await toIpcResult(() => h.read('nope', 'a.ts'))).toMatchObject({ ok: false, error: { code: 'unknown_project' } })
  })
  it('đọc ghi đúng gốc của dự án', async () => {
    await toIpcResult(() => h.write('p1', 'a.ts', 'hi', { eol: '\n', bom: false }))
    expect(await toIpcResult(() => h.read('p1', 'a.ts'))).toMatchObject({ ok: true, data: { text: 'hi' } })
  })
})
