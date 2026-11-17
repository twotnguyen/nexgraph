import { chmodSync, statSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { fsHandlers, readProjectFile, resolveInside, writeProjectFile } from '../src/main/fs/project-fs'
import { toIpcResult } from '../src/main/ipc-result'

let root: string
let outsideDir: string
const directoryLink = (target: string, path: string) =>
  symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir')
const format = { eol: '\n', bom: false } as const
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
  it.skipIf(process.platform !== 'win32')('chặn dấu : của NTFS alternate data stream và đường dẫn ổ đĩa tương đối', async () => {
    writeFileSync(join(root, 'readme.txt'), 'ordinary file')
    await expect(readProjectFile(root, 'readme.txt:hidden')).rejects.toMatchObject({ code: 'outside_project' })
    await expect(writeProjectFile(root, 'readme.txt:hidden', 'stream', format)).rejects.toMatchObject({ code: 'outside_project' })
    expect(() => resolveInside(root, 'C:file.txt')).toThrow(expect.objectContaining({ code: 'outside_project' }))
  })
  it('chặn symlink trỏ ra ngoài', async () => {
    directoryLink(outsideDir, join(root, 'link'))
    await expect(writeProjectFile(root, 'link/a.txt', 'x', { eol: '\n', bom: false }))
      .rejects.toMatchObject({ code: 'outside_project' })
    expect(existsSync(join(outsideDir, 'a.txt'))).toBe(false)
  })
  it('chặn symlink thư mục treo ở giữa đường dẫn', async () => {
    // symlink treo ở thành phần giữa: ghi qua nó sẽ tạo tệp ngoài dự án
    directoryLink(join(outsideDir, 'missing'), join(root, 'skills'))
    await expect(writeProjectFile(root, 'skills/nexgraph/SKILL.md', 'x', { eol: '\n', bom: false }))
      .rejects.toMatchObject({ code: 'outside_project' })
    expect(() => resolveInside(root, 'skills/nexgraph/SKILL.md')).toThrow(expect.objectContaining({ code: 'outside_project' }))
    expect(existsSync(join(outsideDir, 'missing'))).toBe(false)
    // Đường dẫn chưa có thật vẫn được coi là tệp mới hợp lệ.
    expect(resolveInside(root, 'new/deep/a.txt').endsWith(join('proj', 'new', 'deep', 'a.txt'))).toBe(true)
  })
  it('chặn symlink tệp đích treo', async ({ skip }) => {
    try {
      symlinkSync(join(outsideDir, 'gone.md'), join(root, 'AGENTS.md'))
    } catch (error) {
      if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EPERM') throw error
      skip('Tài khoản Windows hiện tại không có quyền tạo symlink tệp.')
      return
    }
    await expect(writeProjectFile(root, 'AGENTS.md', 'x', { eol: '\n', bom: false }))
      .rejects.toMatchObject({ code: 'outside_project' })
    expect(existsSync(join(outsideDir, 'gone.md'))).toBe(false)
  })
  it('tạo thư mục cha còn thiếu khi ghi tệp mới', async () => {
    await writeProjectFile(root, 'new/dir/a.txt', 'x', { eol: '\n', bom: false })
    expect(readFileSync(join(root, 'new/dir/a.txt'), 'utf8')).toBe('x')
  })
  it('giữ CRLF và BOM khi ghi lại', async () => {
    writeFileSync(join(root, 'a.cs'), '﻿a\r\nb\r\n')
    const f = await readProjectFile(root, 'a.cs')
    expect(f).toMatchObject({ text: 'a\nb\n', eol: '\r\n', bom: true, readOnly: false })
    const receipt = await writeProjectFile(root, 'a.cs', 'a\nc\n', { eol: f.eol, bom: f.bom, expectedVersion: f.version })
    expect(readFileSync(join(root, 'a.cs'), 'utf8')).toBe('﻿a\r\nc\r\n')
    expect(receipt.version).not.toBe(f.version)
    expect(await readProjectFile(root, 'a.cs')).toMatchObject(receipt)
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

describe('deny-list tệp nhạy cảm (fs:read/write)', () => {
  const h = fsHandlers(async () => [{ project_id: 'p1', path: root }])
  const secrets = ['.env', '.env.local', '.git/config', '.nexgraph/graph.sql', 'cert.pem', 'server.key', 'id_rsa', 'id_rsa.pub', '.npmrc', '.netrc', 'credentials.json']

  it('từ chối đọc mọi tệp nhạy cảm', async () => {
    for (const rel of secrets) await expect(h.read('p1', rel)).rejects.toMatchObject({ code: 'protected_path' })
  })

  it('chặn đọc và ghi qua alias có đích canonical ở thư mục nhạy cảm', async () => {
    mkdirSync(join(root, 'src', 'id_ed25519_backup'), { recursive: true })
    const protectedDir = join(root, 'src', 'id_ed25519_backup')
    const realFile = join(protectedDir, 'data.txt')
    writeFileSync(realFile, 'FAKE_TEST_CREDENTIAL')
    directoryLink(protectedDir, join(root, 'public-looking'))
    await expect(h.read('p1', 'public-looking/data.txt')).rejects.toMatchObject({ code: 'protected_path' })
    await expect(h.write('p1', 'public-looking/data.txt', 'replacement', format)).rejects.toMatchObject({ code: 'protected_path' })
    expect(readFileSync(realFile, 'utf8')).toBe('FAKE_TEST_CREDENTIAL')
  })

  it('từ chối ghi .git/hooks/post-commit ngay cả khi đã có bản duyệt/đúng mtime', async () => {
    mkdirSync(join(root, '.git', 'hooks'), { recursive: true })
    writeFileSync(join(root, '.git', 'hooks', 'post-commit'), '#!/bin/sh\n')
    const st = statSync(join(root, '.git', 'hooks', 'post-commit'))
    for (const rel of secrets) await expect(h.write('p1', rel, 'x', { eol: '\n', bom: false, expectedMtimeMs: st.mtimeMs }))
      .rejects.toMatchObject({ code: 'protected_path' })
    expect(readFileSync(join(root, '.git', 'hooks', 'post-commit'), 'utf8')).toBe('#!/bin/sh\n')
  })

  it('không chặn tệp mã nguồn thường', async () => {
    await h.write('p1', 'src/service.ts', 'export {}', { eol: '\n', bom: false })
    expect(await h.read('p1', 'src/service.ts')).toMatchObject({ text: 'export {}' })
  })
})

describe('TOCTOU khi ghi', () => {
  it('đổi thư mục cha thành symlink giữa chừng → outside_project, không ghi ra ngoài', async () => {
    const sub = join(root, 'sub')
    const realSub = join(root, 'sub-real')
    mkdirSync(realSub)
    writeFileSync(join(realSub, 'a.txt'), 'cũ')
    directoryLink(realSub, sub)
    const outsideSub = join(outsideDir, 'sub')
    mkdirSync(outsideSub)
    const swap = () => {
      unlinkSync(sub)
      directoryLink(outsideSub, sub)
    }
    await expect(writeProjectFile(root, 'sub/a.txt', 'mới', { eol: '\n', bom: false }, swap))
      .rejects.toMatchObject({ code: 'outside_project' })
    expect(readFileSync(join(root, 'sub-real', 'a.txt'), 'utf8')).toBe('cũ')
    expect(existsSync(join(outsideSub, 'a.txt'))).toBe(false)
    expect(readdirSync(outsideSub).filter((n) => n.endsWith('.tmp'))).toEqual([])
    expect(readdirSync(realSub)).toEqual(['a.txt'])
  })

  it('báo conflict nếu BOM và CRLF đổi sau khi chuẩn bị ghi dù text và mtime vẫn giống', async () => {
    const path = join(root, 'file.ts')
    const time = new Date('2026-01-01T00:00:00Z')
    writeFileSync(path, '\uFEFFsame\r\n')
    utimesSync(path, time, time)
    const before = await readProjectFile(root, 'file.ts')
    await expect(writeProjectFile(root, 'file.ts', 'new\n', { ...format, expectedVersion: before.version }, () => {
      writeFileSync(path, 'same\n')
      utimesSync(path, time, time)
    })).rejects.toMatchObject({ code: 'conflict' })
    expect(await readProjectFile(root, 'file.ts')).toMatchObject({ text: before.text, mtimeMs: before.mtimeMs, bom: false })
    expect(readFileSync(path, 'utf8')).toBe('same\n')
    expect(readdirSync(root)).toEqual(['file.ts'])
  })

  it('báo conflict khi tệp gốc bị thay thế bằng inode khác có cùng bytes và mtime', async () => {
    const path = join(root, 'file.ts')
    const replacement = join(root, 'replacement.ts')
    const time = new Date('2026-01-01T00:00:00Z')
    writeFileSync(path, 'same')
    utimesSync(path, time, time)
    writeFileSync(replacement, 'same')
    utimesSync(replacement, time, time)
    const before = await readProjectFile(root, 'file.ts')
    await expect(writeProjectFile(root, 'file.ts', 'new', { ...format, expectedVersion: before.version }, () => {
      renameSync(replacement, path)
    })).rejects.toMatchObject({ code: 'conflict' })
    expect(await readProjectFile(root, 'file.ts')).toMatchObject({ text: before.text, mtimeMs: before.mtimeMs })
  })

  it('báo conflict khi tệp gốc bị xóa trong lúc chuẩn bị ghi và không tự tạo lại', async () => {
    const path = join(root, 'file.ts')
    writeFileSync(path, 'old')
    const before = await readProjectFile(root, 'file.ts')
    await expect(writeProjectFile(root, 'file.ts', 'new', { ...format, expectedVersion: before.version }, () => {
      unlinkSync(path)
    })).rejects.toMatchObject({ code: 'conflict' })
    expect(readdirSync(root)).toEqual([])
  })

  it('chỉ tạo tệp mới nếu đích chưa tồn tại vào đúng lúc công bố', async () => {
    const path = join(root, 'file.ts')
    let checked = false
    await expect(writeProjectFile(root, 'file.ts', 'proposed', { ...format, expectedVersion: null }, {
      assertNotCancelled: () => {
        if (checked) writeFileSync(path, 'external', { flag: 'wx' })
        checked = true
      }
    })).rejects.toMatchObject({ code: 'conflict' })
    expect(readFileSync(path, 'utf8')).toBe('external')
    expect(readdirSync(root)).toEqual(['file.ts'])
    await expect(writeProjectFile(root, 'file.ts', 'proposed', { ...format, expectedVersion: null }))
      .rejects.toMatchObject({ code: 'conflict' })
    const receipt = await writeProjectFile(root, 'fresh.ts', 'new', { ...format, expectedVersion: null })
    expect(await readProjectFile(root, 'fresh.ts')).toMatchObject({ ...receipt, text: 'new' })
  })

  it('tuần tự hai lượt ghi cùng tệp dù dùng đường dẫn qua thư mục liên kết', async () => {
    const sub = join(root, 'src')
    mkdirSync(sub)
    directoryLink(sub, join(root, 'alias'))
    writeFileSync(join(sub, 'File.ts'), 'old')
    const before = await readProjectFile(root, 'src/File.ts')
    const rel = process.platform === 'win32' ? 'alias/file.ts' : 'alias/File.ts'
    let notifyStaged!: () => void
    let releaseFirst!: () => void
    const staged = new Promise<void>((resolve) => { notifyStaged = resolve })
    const release = new Promise<void>((resolve) => { releaseFirst = resolve })
    const first = writeProjectFile(root, 'src/File.ts', 'editor', { ...format, expectedVersion: before.version }, async () => {
      notifyStaged()
      await release
    })
    await staged
    const second = expect(writeProjectFile(root, rel, 'agent', { ...format, expectedVersion: before.version }))
      .rejects.toMatchObject({ code: 'conflict' })
    try {
      await writeProjectFile(root, 'other.ts', 'independent', { ...format, expectedVersion: null })
    } finally {
      releaseFirst()
    }
    const receipt = await first
    await second
    expect(await readProjectFile(root, rel)).toMatchObject({ ...receipt, text: 'editor' })
  })

  it('hủy sau staging thì không công bố tệp và lần ghi tiếp theo vẫn chạy được', async () => {
    let cancelled = false
    const opts = { ...format, expectedVersion: null }
    await expect(writeProjectFile(root, 'file.ts', 'new', opts, {
      beforeRename: () => { cancelled = true },
      assertNotCancelled: () => { if (cancelled) throw new Error('cancelled') }
    })).rejects.toThrow('cancelled')
    expect(readdirSync(root)).toEqual([])
    await writeProjectFile(root, 'file.ts', 'after cancellation', opts)
    expect(readFileSync(join(root, 'file.ts'), 'utf8')).toBe('after cancellation')
  })
})
