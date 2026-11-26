import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { canonicalPath, gitWorktreeAdd, gitWorktreeRemove, gitWorktrees, parseWorktrees } from '../src/main/features/git/worktree'

const sha = (letter: string) => letter.repeat(40)

describe('parseWorktrees', () => {
  it('đọc worktree chính, nhánh lồng, đầu tách rời, khoá và thư mục đã mất', () => {
    const raw = [
      'worktree /code/app', `HEAD ${sha('a')}`, 'branch refs/heads/main', '',
      'worktree /code/app-worktrees/feat-x', `HEAD ${sha('b')}`, 'branch refs/heads/feat/x', '',
      'worktree /code/with space/detached', `HEAD ${sha('c')}`, 'detached', 'locked usb disk', '',
      'worktree /code/app-worktrees/gone', `HEAD ${sha('d')}`, 'branch refs/heads/old', 'locked', 'prunable gitdir file points to non-existent location', '', ''
    ].join('\n')
    const flags = { detached: false, locked: false, prunable: false, main: false }
    expect(parseWorktrees(raw)).toEqual([
      { path: '/code/app', head: sha('a'), branch: 'main', ...flags, main: true },
      { path: '/code/app-worktrees/feat-x', head: sha('b'), branch: 'feat/x', ...flags },
      { path: '/code/with space/detached', head: sha('c'), branch: null, ...flags, detached: true, locked: true },
      { path: '/code/app-worktrees/gone', head: sha('d'), branch: 'old', ...flags, locked: true, prunable: true }
    ])
  })

  it('chịu được CRLF, bỏ kho bare và không coi worktree liên kết là chính', () => {
    const raw = `worktree /srv/repo.git\r\nbare\r\n\r\nworktree /srv/wt\r\nHEAD ${sha('a')}\r\nbranch refs/heads/main\r\n\r\n`
    expect(parseWorktrees(raw)).toEqual([
      { path: '/srv/wt', head: sha('a'), branch: 'main', detached: false, locked: false, prunable: false, main: false }
    ])
    expect(parseWorktrees('')).toEqual([])
  })
})

describe('canonicalPath', () => {
  it('dùng realpath native cho thư mục có thật và path native cho thư mục đã mất', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ng-path-'))
    try {
      expect(canonicalPath(join(dir, '.').split(sep).join('/'))).toBe(realpathSync.native(dir))
      const missing = join(dir, 'gone', 'sub').split(sep).join('/')
      expect(canonicalPath(missing)).toBe(join(dir, 'gone', 'sub'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

let base: string
let repo: string
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

beforeEach(() => {
  base = realpathSync.native(mkdtempSync(join(tmpdir(), 'ng-worktree-')))
  repo = join(base, 'app')
  mkdirSync(join(repo, 'sub'), { recursive: true })
  sh(repo, 'init', '-q', '-b', 'main')
  sh(repo, 'config', 'user.email', 'test@example.com')
  sh(repo, 'config', 'user.name', 'Người Thử')
  writeFileSync(join(repo, 'a.txt'), 'một\n')
  sh(repo, 'add', '.')
  sh(repo, 'commit', '-q', '-m', 'đầu tiên')
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

describe('worktree trên kho thật', () => {
  it('liệt kê worktree chính và đánh dấu worktree chứa thư mục dự án, kể cả thư mục con', async () => {
    const [main] = await gitWorktrees(repo)
    expect(main).toMatchObject({ path: repo, branch: 'main', main: true, current: true, detached: false, locked: false, prunable: false })
    expect((await gitWorktrees(join(repo, 'sub')))[0].current).toBe(true)

    const created = await gitWorktreeAdd(repo, 'feat/x', false)
    expect(created).toBe(join(base, 'app-worktrees', 'feat-x'))
    const fromLinked = await gitWorktrees(created)
    expect(fromLinked.map((item) => [item.path, item.branch, item.main, item.current])).toEqual([
      [repo, 'main', true, false], [created, 'feat/x', false, true]
    ])
  })

  it('tạo worktree cho nhánh mới từ HEAD hoặc cho nhánh có sẵn', async () => {
    writeFileSync(join(repo, 'b.txt'), 'hai\n')
    sh(repo, 'add', '.')
    sh(repo, 'commit', '-q', '-m', 'thứ hai')
    sh(repo, 'branch', 'topic', 'HEAD~1')

    const fresh = await gitWorktreeAdd(repo, 'fresh', false)
    expect(sh(fresh, 'branch', '--show-current')).toBe('fresh')
    expect(sh(fresh, 'rev-parse', 'HEAD')).toBe(sh(repo, 'rev-parse', 'HEAD'))

    const existing = await gitWorktreeAdd(repo, 'topic', true)
    expect(existing).toBe(join(base, 'app-worktrees', 'topic'))
    expect(sh(existing, 'branch', '--show-current')).toBe('topic')
    expect(existsSync(join(existing, 'b.txt'))).toBe(false)
  })

  it('từ chối tên nhánh sai trước khi chạm vào đĩa', async () => {
    sh(repo, 'switch', '-q', '-c', 'prev')
    sh(repo, 'switch', '-q', 'main')
    for (const name of ['-x', 'a..b', 'HEAD', 'a b', '', 'x.lock', 'feat/', '@{-1}', 'bad\0name']) {
      await expect(gitWorktreeAdd(repo, name, false), JSON.stringify(name)).rejects.toMatchObject({ code: 'bad_param' })
    }
    await expect(gitWorktreeAdd(repo, 42, false)).rejects.toMatchObject({ code: 'bad_param' })
    await expect(gitWorktreeAdd(repo, 'ok', 'yes')).rejects.toMatchObject({ code: 'bad_param' })
    await expect(gitWorktreeAdd(repo, 'missing', true)).rejects.toMatchObject({ code: 'bad_param', message: expect.stringContaining('missing') })
    expect(existsSync(join(base, 'app-worktrees'))).toBe(false)
    expect(sh(repo, 'branch', '--list', 'missing')).toBe('')
  })

  it('git không cho một nhánh có ở hai worktree hoặc tạo trùng tên nhánh', async () => {
    await expect(gitWorktreeAdd(repo, 'main', true)).rejects.toMatchObject({ code: 'git_failed', message: expect.stringContaining('already') })
    await expect(gitWorktreeAdd(repo, 'main', false)).rejects.toMatchObject({ code: 'git_failed' })
    expect(await gitWorktrees(repo)).toHaveLength(1)
  })

  it('xoá worktree sạch, giữ lại nhánh; worktree còn thay đổi bị từ chối và vẫn nguyên vẹn', async () => {
    const path = await gitWorktreeAdd(repo, 'feat/x', false)
    writeFileSync(join(path, 'untracked.txt'), 'x\n')
    await expect(gitWorktreeRemove(repo, path)).rejects.toMatchObject({ code: 'worktree_dirty' })
    rmSync(join(path, 'untracked.txt'))
    writeFileSync(join(path, 'a.txt'), 'đã sửa\n')
    await expect(gitWorktreeRemove(repo, path)).rejects.toMatchObject({ code: 'worktree_dirty' })
    expect(existsSync(join(path, 'a.txt'))).toBe(true)
    expect(await gitWorktrees(repo)).toHaveLength(2)

    sh(path, 'checkout', '--', 'a.txt')
    await gitWorktreeRemove(repo, path)
    expect(existsSync(path)).toBe(false)
    expect(await gitWorktrees(repo)).toHaveLength(1)
    expect(sh(repo, 'branch', '--list', 'feat/x')).toContain('feat/x')
  })

  it('tệp bị ignore (như .nexgraph của dự án đã mở) không chặn việc xoá', async () => {
    const path = await gitWorktreeAdd(repo, 'opened', false)
    mkdirSync(join(path, '.nexgraph'))
    writeFileSync(join(path, '.nexgraph', '.gitignore'), '*\n')
    writeFileSync(join(path, '.nexgraph', 'graph.db'), 'db')
    await gitWorktreeRemove(repo, path)
    expect(existsSync(path)).toBe(false)
  })

  it('không xoá worktree chính, worktree đang mở, đường dẫn lạ hoặc worktree bị khoá', async () => {
    const path = await gitWorktreeAdd(repo, 'feat', false)
    await expect(gitWorktreeRemove(path, repo)).rejects.toMatchObject({ code: 'bad_param', message: expect.stringContaining('chính') })
    await expect(gitWorktreeRemove(path, path)).rejects.toMatchObject({ code: 'bad_param', message: expect.stringContaining('đang mở') })

    const elsewhere = join(base, 'elsewhere')
    mkdirSync(elsewhere)
    for (const target of [elsewhere, join(base, 'app-worktrees'), 42, undefined]) {
      await expect(gitWorktreeRemove(repo, target)).rejects.toMatchObject({ code: 'bad_param' })
    }
    expect(existsSync(elsewhere)).toBe(true)

    sh(repo, 'worktree', 'lock', path)
    await expect(gitWorktreeRemove(repo, path)).rejects.toMatchObject({ code: 'git_failed', message: expect.stringContaining('locked') })
    expect(existsSync(path)).toBe(true)
  })

  it('đánh dấu worktree đã mất thư mục và cho dọn bản ghi của nó', async () => {
    const path = await gitWorktreeAdd(repo, 'gone', false)
    rmSync(path, { recursive: true })
    expect((await gitWorktrees(repo)).find((item) => item.path === path)).toMatchObject({ prunable: true, branch: 'gone' })
    await gitWorktreeRemove(repo, path)
    expect(await gitWorktrees(repo)).toHaveLength(1)
  })
})
