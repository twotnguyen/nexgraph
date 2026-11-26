import { once } from 'node:events'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { projectOperations } from '../src/main/features/files/project-operations'
import { toIpcResult } from '../src/main/platform/ipc-result'

let root: string
let outside: string
let trashed: string[]
let revealed: string[]

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'ng-fs-ops-'))
  root = join(base, 'project')
  outside = join(base, 'outside')
  mkdirSync(root)
  mkdirSync(outside)
  trashed = []
  revealed = []
})

function operations() {
  return projectOperations(async () => [{ project_id: 'p1', path: root }], {
    trashItem: async (path) => { trashed.push(path) },
    showItemInFolder: (path) => { revealed.push(path) }
  })
}

function linkDirectory(target: string, path: string) {
  symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir')
}

describe('project filesystem operations', () => {
  it('creates nested files and directories without replacing existing entries', async () => {
    const fs = operations()
    await fs.createFile('p1', 'new/deep/a.txt')
    expect(readFileSync(join(root, 'new/deep/a.txt'), 'utf8')).toBe('')
    writeFileSync(join(root, 'new/deep/a.txt'), 'keep')
    await expect(fs.createFile('p1', 'new/deep/a.txt')).rejects.toMatchObject({ code: 'conflict' })
    expect(readFileSync(join(root, 'new/deep/a.txt'), 'utf8')).toBe('keep')
    await fs.createDir('p1', 'other/nested')
    expect(statSync(join(root, 'other/nested')).isDirectory()).toBe(true)
    await expect(fs.createDir('p1', 'other/nested')).rejects.toMatchObject({ code: 'conflict' })
  })

  it('rejects root, escaping, absolute, protected, invalid and unknown-project paths', async () => {
    const fs = operations()
    for (const path of ['', '.', 'new/..']) {
      await expect(fs.createFile('p1', path)).rejects.toBeDefined()
      await expect(fs.createDir('p1', path)).rejects.toBeDefined()
      await expect(fs.rename('p1', path, 'target')).rejects.toBeDefined()
      await expect(fs.copy('p1', path, '.')).rejects.toBeDefined()
      await expect(fs.trash('p1', path)).rejects.toBeDefined()
    }
    writeFileSync(join(root, 'safe.txt'), 'keep')
    await expect(fs.rename('p1', 'safe.txt', '.')).rejects.toBeDefined()
    await expect(fs.copy('p1', 'safe.txt', '..')).rejects.toMatchObject({ code: 'outside_project' })
    await expect(fs.rename('p1', 'safe.txt', join('..', basename(dirname(root)), 'project', 'back.txt'))).rejects.toMatchObject({ code: 'outside_project' })
    expect(readFileSync(join(root, 'safe.txt'), 'utf8')).toBe('keep')
    for (const path of ['../outside/escape', join(outside, 'escape')]) {
      await expect(fs.createFile('p1', path)).rejects.toMatchObject({ code: 'outside_project' })
      await expect(fs.copy('p1', 'missing', path)).rejects.toMatchObject({ code: 'outside_project' })
    }
    await expect(fs.createFile('p1', 'new/.env.local')).rejects.toMatchObject({ code: 'protected_path' })
    await expect(fs.createDir('p1', '.git')).rejects.toMatchObject({ code: 'protected_path' })
    await expect(fs.rename('p1', 'safe.txt', 'new/.env')).rejects.toMatchObject({ code: 'protected_path' })
    await expect(fs.copy('p1', '.env', '.')).rejects.toMatchObject({ code: 'protected_path' })
    await expect(fs.createFile('p1', null as unknown as string)).rejects.toMatchObject({ code: 'bad_param' })
    await expect(fs.createFile('missing-project', 'file')).rejects.toMatchObject({ code: 'unknown_project' })
    expect(readdirSync(outside)).toEqual([])
  })

  it('rejects internal, external and dangling symlink paths for every operation', async () => {
    const fs = operations()
    mkdirSync(join(root, 'real'))
    writeFileSync(join(root, 'real/a.txt'), 'inside')
    linkDirectory(join(root, 'real'), join(root, 'alias'))
    linkDirectory(outside, join(root, 'external'))
    linkDirectory(join(outside, 'missing'), join(root, 'dangling'))
    linkDirectory(root, join(root, 'self'))
    await expect(fs.createFile('p1', 'self/new.txt')).rejects.toMatchObject({ code: 'outside_project' })
    await expect(fs.createFile('p1', 'alias/../b.txt')).rejects.toMatchObject({ code: 'outside_project' })
    await expect(fs.createFile('p1', 'external/../b.txt')).rejects.toMatchObject({ code: 'outside_project' })
    for (const path of ['alias/a.txt', 'external/a.txt', 'dangling/a.txt']) {
      await expect(fs.createFile('p1', path)).rejects.toMatchObject({ code: 'outside_project' })
      await expect(fs.rename('p1', path, 'moved')).rejects.toMatchObject({ code: 'outside_project' })
      await expect(fs.trash('p1', path)).rejects.toMatchObject({ code: 'outside_project' })
      await expect(fs.reveal('p1', path)).rejects.toMatchObject({ code: 'outside_project' })
    }
    await expect(fs.copy('p1', 'real/a.txt', 'alias')).rejects.toMatchObject({ code: 'outside_project' })
    expect(readFileSync(join(root, 'real/a.txt'), 'utf8')).toBe('inside')
    expect(readdirSync(outside)).toEqual([])
    expect(trashed).toEqual([])
    expect(revealed).toEqual([])
  })

  it('renames files and directories but never overwrites existing targets', async () => {
    const fs = operations()
    mkdirSync(join(root, 'source/empty'), { recursive: true })
    writeFileSync(join(root, 'source/a.txt'), 'original')
    writeFileSync(join(root, 'taken.txt'), 'keep')
    await expect(fs.rename('p1', 'source/a.txt', 'taken.txt')).rejects.toMatchObject({ code: 'conflict' })
    expect(readFileSync(join(root, 'taken.txt'), 'utf8')).toBe('keep')
    await fs.rename('p1', 'source/a.txt', 'source/b.txt')
    await fs.rename('p1', 'source', 'renamed')
    expect(existsSync(join(root, 'source'))).toBe(false)
    expect(readFileSync(join(root, 'renamed/b.txt'), 'utf8')).toBe('original')
    expect(statSync(join(root, 'renamed/empty')).isDirectory()).toBe(true)
    mkdirSync(join(root, 'occupied'))
    await expect(fs.rename('p1', 'renamed', 'occupied')).rejects.toMatchObject({ code: 'conflict' })
    expect(existsSync(join(root, 'renamed/b.txt'))).toBe(true)
    await expect(fs.rename('p1', 'renamed', 'renamed/empty/child')).rejects.toBeDefined()
    expect(existsSync(join(root, 'renamed/b.txt'))).toBe(true)
  })

  it('creates consistently named same-directory copies and refuses cross-directory collisions', async () => {
    const fs = operations()
    writeFileSync(join(root, 'notes.txt'), 'original')
    writeFileSync(join(root, 'notes copy.txt'), 'keep')
    writeFileSync(join(root, '.ignore'), 'hidden')
    mkdirSync(join(root, 'folder.v1'))
    mkdirSync(join(root, 'dest'))
    writeFileSync(join(root, 'dest/notes.txt'), 'other')
    expect(await fs.copy('p1', 'notes.txt', '.')).toBe('notes copy 1.txt')
    expect(await fs.copy('p1', 'notes.txt', '.')).toBe('notes copy 2.txt')
    linkDirectory(outside, join(root, 'notes copy 3.txt'))
    expect(await fs.copy('p1', 'notes.txt', '.')).toBe('notes copy 4.txt')
    expect(await fs.copy('p1', 'notes copy.txt', '.')).toBe('notes copy copy.txt')
    expect(readFileSync(join(root, 'notes copy copy.txt'), 'utf8')).toBe('keep')
    expect(await fs.copy('p1', '.ignore', '.')).toBe('.ignore copy')
    expect(await fs.copy('p1', 'folder.v1', '.')).toBe('folder.v1 copy')
    await expect(fs.copy('p1', 'notes.txt', 'dest')).rejects.toMatchObject({ code: 'conflict' })
    expect(readFileSync(join(root, 'dest/notes.txt'), 'utf8')).toBe('other')
    expect(readFileSync(join(root, 'notes copy 1.txt'), 'utf8')).toBe('original')
  })

  it('copies directories including empty folders, binary contents and permissions', async () => {
    const fs = operations()
    mkdirSync(join(root, 'src/empty'), { recursive: true })
    mkdirSync(join(root, 'dest'))
    writeFileSync(join(root, 'src/run.bin'), Buffer.from([0, 255, 42]))
    chmodSync(join(root, 'src/run.bin'), 0o755)
    expect(await fs.copy('p1', 'src', 'dest')).toBe('dest/src')
    expect(readFileSync(join(root, 'dest/src/run.bin'))).toEqual(Buffer.from([0, 255, 42]))
    expect(statSync(join(root, 'dest/src/empty')).isDirectory()).toBe(true)
    if (process.platform !== 'win32') expect(statSync(join(root, 'dest/src/run.bin')).mode & 0o777).toBe(0o755)
    await expect(fs.copy('p1', 'src', 'src/empty')).rejects.toBeDefined()
    expect(readdirSync(join(root, 'src/empty'))).toEqual([])
  })

  it('skips symlinks at every copy depth without following them, and refuses to move or trash them', async () => {
    const fs = operations()
    mkdirSync(join(root, 'src/nested'), { recursive: true })
    mkdirSync(join(root, 'dest'))
    writeFileSync(join(root, 'src/normal.txt'), 'normal')
    writeFileSync(join(outside, 'secret.txt'), 'secret')
    linkDirectory(outside, join(root, 'src/link'))
    linkDirectory(join(root, 'src'), join(root, 'src/nested/inside'))
    linkDirectory(join(outside, 'missing'), join(root, 'src/nested/dangling'))
    expect(await fs.copy('p1', 'src', 'dest')).toBe('dest/src')
    expect(readdirSync(join(root, 'dest/src')).sort()).toEqual(['nested', 'normal.txt'])
    expect(readdirSync(join(root, 'dest/src/nested'))).toEqual([])
    expect(readFileSync(join(root, 'dest/src/normal.txt'), 'utf8')).toBe('normal')
    await expect(fs.rename('p1', 'src', 'moved')).rejects.toBeDefined()
    await expect(fs.trash('p1', 'src')).rejects.toBeDefined()
    expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('secret')
    expect(existsSync(join(root, 'src/normal.txt'))).toBe(true)
  })

  it.skipIf(process.platform === 'win32')('rejects unsupported entries rather than leaving an incomplete copy', async () => {
    const fs = operations()
    mkdirSync(join(root, 'src'))
    mkdirSync(join(root, 'dest'))
    const server = createServer()
    await once(server.listen(join(root, 'src/socket')), 'listening')
    try {
      await expect(fs.copy('p1', 'src', 'dest')).rejects.toMatchObject({ code: 'bad_param' })
      expect(readdirSync(join(root, 'dest'))).toEqual([])
    } finally {
      await once(server.close(), 'close')
    }
  })

  it('refuses protected descendants even when their parent is otherwise accessible', async () => {
    const fs = operations()
    mkdirSync(join(root, 'src'))
    mkdirSync(join(root, 'dest'))
    writeFileSync(join(root, 'src/.env'), 'private')
    await expect(fs.copy('p1', 'src', 'dest')).rejects.toMatchObject({ code: 'protected_path' })
    await expect(fs.rename('p1', 'src', 'moved')).rejects.toMatchObject({ code: 'protected_path' })
    await expect(fs.trash('p1', 'src')).rejects.toMatchObject({ code: 'protected_path' })
    expect(readFileSync(join(root, 'src/.env'), 'utf8')).toBe('private')
    expect(readdirSync(join(root, 'dest'))).toEqual([])
  })

  it('MIN-38b M2 (quyết định lead): tạo, chép, đổi tên, hiện và dọn .vscode/tasks.json đều không bị chặn', async () => {
    const fs = operations()
    mkdirSync(join(root, '.vscode'))
    writeFileSync(join(root, 'tasks.json'), '{"version":"2.0.0","tasks":[]}')
    await fs.copy('p1', 'tasks.json', '.vscode')
    expect(readFileSync(join(root, '.vscode', 'tasks.json'), 'utf8')).toBe('{"version":"2.0.0","tasks":[]}')
    await fs.reveal('p1', '.vscode/tasks.json')
    expect(revealed).toEqual([join(realpathSync.native(root), '.vscode', 'tasks.json')])
    await fs.rename('p1', '.vscode/tasks.json', '.vscode/khac.json')
    expect(existsSync(join(root, '.vscode', 'tasks.json'))).toBe(false)
    await fs.createFile('p1', '.vscode/tasks.json')
    expect(readFileSync(join(root, '.vscode', 'tasks.json'), 'utf8')).toBe('')
    await fs.trash('p1', '.vscode/tasks.json')
    expect(trashed).toEqual([join(realpathSync.native(root), '.vscode', 'tasks.json')])
  })

  it('only passes validated, existing project items to the system shell', async () => {
    const fs = operations()
    writeFileSync(join(root, 'a.txt'), 'a')
    await fs.trash('p1', 'a.txt')
    await fs.reveal('p1', 'a.txt')
    await fs.reveal('p1', '.')
    expect(trashed).toEqual([join(realpathSync.native(root), 'a.txt')])
    expect(revealed).toEqual([join(realpathSync.native(root), 'a.txt'), realpathSync.native(root)])
    await expect(fs.trash('p1', 'missing')).rejects.toMatchObject({ code: 'file_not_found' })
    await expect(fs.reveal('p1', 'missing')).rejects.toMatchObject({ code: 'file_not_found' })
    expect(trashed).toHaveLength(1)
    expect(revealed).toHaveLength(2)
    expect(await toIpcResult(() => fs.createFile('p1', '.env'))).toMatchObject({
      ok: false, error: { code: 'protected_path', message: expect.any(String) }
    })
  })

  it('surfaces shell failures without exposing their absolute paths', async () => {
    writeFileSync(join(root, 'a.txt'), 'keep')
    const fs = projectOperations(async () => [{ project_id: 'p1', path: root }], {
      trashItem: async () => { throw new Error(`failed: ${root}`) },
      showItemInFolder: () => {}
    })
    const result = await toIpcResult(() => fs.trash('p1', 'a.txt'))
    expect(result).toMatchObject({ ok: false, error: { code: 'filesystem_error', message: expect.stringContaining('thùng rác') } })
    if (!result.ok) expect(result.error.message).not.toContain(root)
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('keep')
  })
})
