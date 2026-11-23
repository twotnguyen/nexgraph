import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  gitBlame, gitBranches, gitCommit, gitDiffSides, gitRemote, gitRestore, gitStage, gitStashAction,
  gitStashSave, gitStashes, gitStatus, gitSwitchBranch, gitUnstage
} from '../src/main/git/repo'

// Các test dưới đây chạy git thật (init/clone/push/fetch), không phải stub. Trên Windows CI ca push/fetch/pull
// (tạo kho bare + clone + push + pull) từng mất 6,3 s và chạm trần 5 s; số đo sau đó ~2,9 s. Chỉ ca đó có timeout
// riêng 15 s trên Windows — các ca khác giữ mặc định để test chậm bất thường vẫn đỏ.
const WINDOWS_SLOW_GIT = process.platform === 'win32' ? { timeout: 15_000 } : {}

/**
 * Windows giữ tay cầm tệp trong kho thêm một nhịp sau khi tiến trình git thoát (indexer/antivirus),
 * nên `rmdir` mặc định ném EBUSY. Thử lại vài lần thay vì bỏ qua dọn dẹp.
 */
const rm = (path: string) => rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })

let repo: string
let root: string // dự án là thư mục con của kho
const sh = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'ng-git-'))
  root = join(repo, 'app')
  mkdirSync(join(root, 'src'), { recursive: true })
  sh('init', '-q', '-b', 'main')
  sh('config', 'core.autocrlf', 'false')
  sh('config', 'core.eol', 'lf')
  sh('config', 'user.email', 'test@example.com')
  sh('config', 'user.name', 'Người Thử')
  writeFileSync(join(root, 'src/a.ts'), 'one\ntwo\n')
  writeFileSync(join(repo, 'outside.txt'), 'x\n')
  sh('add', '.')
  sh('commit', '-q', '-m', 'đầu tiên')
})
afterEach(() => rm(repo))

it('status chỉ trong thư mục dự án; stage, unstage, commit từng tệp; diff hai phía', async () => {
  writeFileSync(join(root, 'src/a.ts'), 'one\nTWO\n')
  writeFileSync(join(root, 'new.md'), '# mới\n')
  writeFileSync(join(repo, 'outside.txt'), 'changed\n')
  expect(await gitStatus(root)).toMatchObject({
    repo: true, branch: 'main', staged: [], conflicts: [], upstream: null, ahead: 0, behind: 0, remote: null,
    unstaged: [{ path: 'new.md', status: '?', added: 1, deleted: 0 }, { path: 'src/a.ts', status: 'M', added: 1, deleted: 1 }],
    lastCommit: { subject: 'đầu tiên', message: 'đầu tiên', hasParent: false, pushed: false }
  })

  await gitStage(root, ['src/a.ts'])
  const staged = await gitStatus(root)
  expect(staged.staged).toEqual([{ path: 'src/a.ts', status: 'M', added: 1, deleted: 1 }])
  expect(await gitDiffSides(root, 'src/a.ts', true)).toEqual({ before: 'one\ntwo\n', after: 'one\nTWO\n' })
  expect(await gitDiffSides(root, 'new.md', false)).toEqual({ before: '', after: '# mới\n' })

  await gitUnstage(root, ['src/a.ts'])
  expect((await gitStatus(root)).staged).toEqual([])
  await gitStage(root, ['src/a.ts'])
  const sha = await gitCommit(root, 'sửa a')
  expect(sh('log', '-1', '--format=%h %s').trim()).toBe(`${sha} sửa a`)
  // Tệp ngoài dự án và tệp chưa stage không bị commit.
  expect(sh('status', '--porcelain')).toContain(' M outside.txt')
  await expect(gitStage(root, ['../outside.txt'])).rejects.toMatchObject({ code: 'outside_project' })
  await expect(gitCommit(root, '  ')).rejects.toMatchObject({ code: 'bad_param' })
})

it.skipIf(process.platform === 'win32')('không chạy fsmonitor do repo tự đặt', async () => {
  // REV-16: core.fsmonitor trong .git/config của repo lạ là một hook chạy mã khi `git status`.
  const marker = join(repo, 'fsmonitor-đã-chạy')
  const hook = join(repo, 'fsmonitor.sh')
  writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\nprintf '1\\n'\n`, { mode: 0o755 })
  sh('config', 'core.fsmonitor', hook)
  try {
    await gitStatus(root)
    expect(existsSync(marker)).toBe(false)
  } finally {
    sh('config', '--unset', 'core.fsmonitor')
  }
})

it('diff với base lấy nội dung tại ref, phía sau vẫn theo index/worktree và chặn ref kiểu option', async () => {
  writeFileSync(join(root, 'src/a.ts'), 'one\nthree\n')
  sh('add', '-A', 'app/src/a.ts')
  sh('commit', '-q', '-m', 'hai')
  sh('branch', 'old', 'HEAD~1')
  writeFileSync(join(root, 'src/a.ts'), 'one\nfour\n')
  expect(await gitDiffSides(root, 'src/a.ts', false)).toEqual({ before: 'one\nthree\n', after: 'one\nfour\n' })
  expect(await gitDiffSides(root, 'src/a.ts', false, 'HEAD~1')).toEqual({ before: 'one\ntwo\n', after: 'one\nfour\n' })
  expect(await gitDiffSides(root, 'src/a.ts', false, 'old')).toEqual({ before: 'one\ntwo\n', after: 'one\nfour\n' })
  await gitStage(root, ['src/a.ts'])
  expect(await gitDiffSides(root, 'src/a.ts', true, 'old')).toEqual({ before: 'one\ntwo\n', after: 'one\nfour\n' })
  for (const bad of ['--help', '-e', 'HEAD; touch x', 'HEAD:src/a.ts', '']) {
    await expect(gitDiffSides(root, 'src/a.ts', false, bad)).rejects.toMatchObject({ code: 'bad_param' })
  }
})

it('commit thêm trailer Co-authored-by từ giá trị người dùng và chặn giá trị có dòng mới', async () => {
  writeFileSync(join(root, 'src/a.ts'), 'one\nthree\n')
  await gitStage(root, ['src/a.ts'])
  await gitCommit(root, 'có đồng tác giả', false, ['Bình <b@example.com>', ' An <a@example.com> '])
  expect(sh('log', '-1', '--format=%B').trim()).toBe('có đồng tác giả\n\nCo-authored-by: Bình <b@example.com>\nCo-authored-by: An <a@example.com>')
  writeFileSync(join(root, 'src/a.ts'), 'one\nfour\n')
  await gitStage(root, ['src/a.ts'])
  await expect(gitCommit(root, 'x', false, ['A\nx'])).rejects.toMatchObject({ code: 'bad_param' })
  await expect(gitCommit(root, 'x', false, 'nope')).rejects.toMatchObject({ code: 'bad_param' })
})

it('blame theo nội dung trên đĩa: dòng đã commit có tác giả, dòng mới là chưa commit', async () => {
  writeFileSync(join(root, 'src/a.ts'), 'zero\none\ntwo\n')
  const lines = await gitBlame(root, 'src/a.ts')
  expect(lines.map((l) => [l.line, l.uncommitted, l.author, l.summary])).toEqual([
    [1, true, '', ''], [2, false, 'Người Thử', 'đầu tiên'], [3, false, 'Người Thử', 'đầu tiên']
  ])
})

it('thư mục không phải kho git', async () => {
  const plain = mkdtempSync(join(tmpdir(), 'ng-plain-'))
  expect(await gitStatus(plain)).toEqual({
    repo: false, branch: null, staged: [], unstaged: [], conflicts: [], upstream: null,
    ahead: 0, behind: 0, remote: null, lastCommit: null
  })
  rm(plain)
})

it('đếm numstat NUL-safe, đổi tên, nhị phân và tệp chưa theo dõi', async () => {
  // Win32 cấm tab/newline trong tên tệp; POSIX giữ fixture đặc biệt.
  const oldName = process.platform === 'win32' ? 'src/old name.ts' : 'src/old\tname.ts'
  const newName = process.platform === 'win32' ? 'src/new line file.ts' : 'src/new\tline\nfile.ts'
  if (process.platform !== 'win32') {
    expect(oldName).toContain('\t')
    expect(newName).toContain('\t')
    expect(newName).toContain('\n')
  }
  writeFileSync(join(root, oldName), 'one\ntwo\nthree\n')
  writeFileSync(join(root, 'binary.bin'), Buffer.from([0, 1]))
  sh('add', '.')
  sh('commit', '-q', '-m', 'fixtures')
  sh('mv', `app/${oldName}`, `app/${newName}`)
  writeFileSync(join(root, 'binary.bin'), Buffer.from([0, 2]))
  await gitStage(root, ['binary.bin'])
  writeFileSync(join(root, 'binary.bin'), Buffer.from([0, 3]))
  writeFileSync(join(root, 'untracked.txt'), 'no newline\nlast')
  writeFileSync(join(root, 'untracked.bin'), Buffer.from([0, 4]))
  const status = await gitStatus(root)
  expect(status.staged).toEqual(expect.arrayContaining([
    { path: newName, from: oldName, status: 'R', added: 0, deleted: 0 },
    { path: 'binary.bin', status: 'M', added: null, deleted: null }
  ]))
  expect(status.unstaged).toEqual(expect.arrayContaining([
    { path: 'binary.bin', status: 'M', added: null, deleted: null },
    { path: 'untracked.txt', status: '?', added: 2, deleted: 0 },
    { path: 'untracked.bin', status: '?', added: null, deleted: null }
  ]))
})

it('pathspec tệp luôn literal, kể cả tên giống glob', async () => {
  writeFileSync(join(root, 'src/[x].ts'), 'brackets\n')
  writeFileSync(join(root, 'src/x.ts'), 'ordinary\n')
  await gitStage(root, ['src/[x].ts'])
  const status = await gitStatus(root)
  expect(status.staged.map((f) => f.path)).toEqual(['src/[x].ts'])
  expect(status.unstaged.map((f) => f.path)).toEqual(['src/x.ts'])
  await expect(gitStage(root, ['../outside.txt'])).rejects.toMatchObject({ code: 'outside_project' })
  await expect(gitStage(root, ['bad\0name'])).rejects.toMatchObject({ code: 'bad_param' })
})

it('bỏ stage trong kho chưa có commit mà không xoá tệp', async () => {
  const empty = join(repo, 'empty')
  mkdirSync(empty)
  sh('init', '-q', empty)
  writeFileSync(join(empty, 'first.txt'), 'first\n')
  await gitStage(empty, ['first.txt'])
  await gitUnstage(empty, ['first.txt'])
  expect(readFileSync(join(empty, 'first.txt'), 'utf8')).toBe('first\n')
  expect((await gitStatus(empty)).unstaged).toEqual([{ path: 'first.txt', status: '?', added: 1, deleted: 0 }])
})

it('phân loại xung đột vào nhóm riêng', async () => {
  sh('switch', '-q', '-c', 'other')
  writeFileSync(join(root, 'src/a.ts'), 'other\n')
  sh('commit', '-qam', 'other')
  sh('switch', '-q', 'main')
  writeFileSync(join(root, 'src/a.ts'), 'main\n')
  sh('commit', '-qam', 'main')
  try { sh('merge', 'other') } catch { /* expected merge conflict */ }
  const status = await gitStatus(root)
  expect(status.conflicts).toEqual([{ path: 'src/a.ts', status: 'UU' }])
  expect(status.staged).toEqual([])
  expect(status.unstaged).toEqual([])
})

it('tạo và chuyển nhánh an toàn; amend không tạo thêm commit', async () => {
  await gitSwitchBranch(root, 'feature/test', true)
  expect(await gitBranches(root)).toEqual(['feature/test', 'main'])
  writeFileSync(join(root, 'src/a.ts'), 'amended\n')
  await gitStage(root, ['src/a.ts'])
  const sha = await gitCommit(root, 'amended message', true)
  expect(sh('rev-list', '--count', 'HEAD').trim()).toBe('1')
  expect(sh('log', '-1', '--format=%h %s').trim()).toBe(`${sha} amended message`)
  await gitSwitchBranch(root, 'main', false)
  expect(sh('branch', '--show-current').trim()).toBe('main')
  await expect(gitSwitchBranch(root, '--force', true)).rejects.toMatchObject({ code: 'bad_param' })
  await expect(gitSwitchBranch(root, '../outside', false)).rejects.toMatchObject({ code: 'bad_param' })
})

it('restore giữ index và đưa tệp chưa theo dõi vào thùng rác', async () => {
  const target = join(root, 'src/a.ts')
  writeFileSync(target, 'staged\n')
  await gitStage(root, ['src/a.ts'])
  writeFileSync(target, 'unstaged\n')
  const trash = join(repo, 'trashed')
  await gitRestore(root, 'src/a.ts', async (path) => renameSync(path, trash))
  expect(readFileSync(target, 'utf8')).toBe('staged\n')
  expect(sh('show', ':app/src/a.ts')).toBe('staged\n')
  writeFileSync(join(root, 'new.txt'), 'untracked\n')
  await gitRestore(root, 'new.txt', async (path) => renameSync(path, trash))
  expect(existsSync(join(root, 'new.txt'))).toBe(false)
  expect(readFileSync(trash, 'utf8')).toBe('untracked\n')
  await expect(gitRestore(root, '../outside.txt', async () => {})).rejects.toMatchObject({ code: 'outside_project' })
})

it('stash chỉ lưu thư mục dự án, pop khôi phục cả tệp mới', async () => {
  writeFileSync(join(root, 'src/a.ts'), 'stashed\n')
  writeFileSync(join(root, 'new.txt'), 'new\n')
  writeFileSync(join(repo, 'outside.txt'), 'outside change\n')
  await gitStashSave(root, 'app work')
  const stashes = await gitStashes(root)
  expect(stashes).toHaveLength(1)
  expect(stashes[0].ref).toBe('stash@{0}')
  expect(stashes[0].message).toContain('app work')
  expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe('one\ntwo\n')
  expect(existsSync(join(root, 'new.txt'))).toBe(false)
  expect(readFileSync(join(repo, 'outside.txt'), 'utf8')).toBe('outside change\n')
  await gitStashAction(root, stashes[0].ref, 'pop')
  expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe('stashed\n')
  expect(readFileSync(join(root, 'new.txt'), 'utf8')).toBe('new\n')
  expect(await gitStashes(root)).toEqual([])
  await expect(gitStashAction(root, '--all', 'drop')).rejects.toMatchObject({ code: 'bad_param' })
})

it('amend bị từ chối nếu commit nằm trên remote ref đã biết', async () => {
  const bare = mkdtempSync(join(tmpdir(), 'ng-remote-'))
  try {
    sh('init', '--bare', '-q', bare)
    sh('remote', 'add', 'origin', bare)
    sh('push', '-qu', 'origin', 'main')
    writeFileSync(join(root, 'src/a.ts'), 'published elsewhere\n')
    await gitStage(root, ['src/a.ts'])
    await gitCommit(root, 'published elsewhere')
    sh('push', '-q', 'origin', 'main')
    await expect(gitCommit(root, 'sửa commit đã push', true)).rejects.toMatchObject({ code: 'git_failed' })
    expect(sh('log', '-1', '--format=%s').trim()).toBe('published elsewhere')
  } finally {
    rm(bare)
  }
})

it('không có remote thì lastCommit chưa xuất bản', async () => {
  writeFileSync(join(root, 'src/a.ts'), 'another\n')
  await gitStage(root, ['src/a.ts'])
  await gitCommit(root, 'another')
  expect((await gitStatus(root)).lastCommit?.pushed).toBe(false)
})

it('push, fetch và pull dùng kho bare cục bộ', WINDOWS_SLOW_GIT, async () => {
  const bare = mkdtempSync(join(tmpdir(), 'ng-remote-'))
  const clone = mkdtempSync(join(tmpdir(), 'ng-clone-'))
  try {
    sh('init', '--bare', '-q', bare)
    sh('remote', 'add', 'origin', bare)
    sh('push', '-qu', 'origin', 'main')
    writeFileSync(join(root, 'src/a.ts'), 'pushed\n')
    await gitStage(root, ['src/a.ts'])
    await gitCommit(root, 'pushed')
    expect(await gitRemote(root, 'push')).toContain('main')
    expect(execFileSync('git', ['--git-dir', bare, 'log', '-1', '--format=%s', 'main'], { encoding: 'utf8' }).trim()).toBe('pushed')
    sh('clone', '-q', '-b', 'main', bare, clone)
    sh('-C', clone, 'config', 'user.email', 'other@example.com')
    sh('-C', clone, 'config', 'user.name', 'Other')
    writeFileSync(join(clone, 'app/src/a.ts'), 'fetched\n')
    sh('-C', clone, 'commit', '-qam', 'fetched')
    sh('-C', clone, 'push', '-q')
    await gitRemote(root, 'fetch')
    expect((await gitStatus(root)).behind).toBe(1)
    await gitRemote(root, 'pull')
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe('fetched\n')
    await expect(gitRemote(root, 'push --force' as 'push')).rejects.toMatchObject({ code: 'bad_param' })
  } finally {
    rm(bare)
    rm(clone)
  }
})
