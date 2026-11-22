import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { gitCommitDiff, gitCommitFiles, gitHistory, parseGitLog } from '../src/main/git/history'

let repo: string
let root: string
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
const head = () => git('rev-parse', 'HEAD').trim()
// Win32 cấm tab/newline trong tên tệp; POSIX phải thử tên thật sự đặc biệt.
const globFile = process.platform === 'win32' ? '[glob]file.txt' : ':(glob)*.txt'
const specialFile = process.platform === 'win32' ? 'tab line.txt' : 'tab\tline\n.txt'

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'ng-git-history-'))
  root = join(repo, 'app')
  mkdirSync(join(root, 'src'), { recursive: true })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Người Thử')
  writeFileSync(join(root, 'src/old.txt'), 'một\nhai\n')
  writeFileSync(join(root, globFile), 'literal\n')
  writeFileSync(join(root, specialFile), 'special\n')
  writeFileSync(join(repo, 'outside.txt'), 'outside\n')
  git('add', '--all')
  git('commit', '-q', '-m', 'đầu tiên')
})
afterEach(() => rmSync(repo, { recursive: true, force: true }))

it('parses NUL-delimited log fields without splitting punctuation or empty refs', () => {
  const sha = 'a'.repeat(40)
  const parent = 'b'.repeat(40)
  const raw = [sha, parent, 'An\tĐỗ', '1700000000', 'subject\x1e with tab\t', 'HEAD -> main, tag: v1', parent, '', 'Bình', '1699999999', 'root', ''].join('\0')
  expect(parseGitLog(raw)).toEqual([
    { sha, parents: [parent], author: 'An\tĐỗ', time: 1700000000, subject: 'subject\x1e with tab\t', refs: 'HEAD -> main, tag: v1' },
    { sha: parent, parents: [], author: 'Bình', time: 1699999999, subject: 'root', refs: '' }
  ])
  expect(parseGitLog('')).toEqual([])
})

it('returns commits from the current branch or all refs with complete parent and author fields', async () => {
  const first = head()
  git('checkout', '-q', '-b', 'other')
  writeFileSync(join(root, 'src/old.txt'), 'other\n')
  git('commit', '-qam', 'nhánh khác')
  const other = head()
  git('checkout', '-q', 'main')
  writeFileSync(join(root, 'src/old.txt'), 'main\n')
  git('commit', '-qam', 'chính')
  const main = head()

  const current = await gitHistory(root, false)
  expect(current.map((c) => c.sha)).toEqual([main, first])
  expect(current[0]).toMatchObject({ parents: [first], subject: 'chính', author: 'Người Thử' })
  expect(current[0].time).toBeGreaterThan(0)
  expect(current[0].refs).toContain('main')
  expect((await gitHistory(root, true)).map((c) => c.sha)).toEqual(expect.arrayContaining([main, other, first]))
})

it('parses root changes with project-relative paths and reads literal special filenames', async () => {
  if (process.platform !== 'win32') {
    expect(globFile).toBe(':(glob)*.txt')
    expect(specialFile).toContain('\t')
    expect(specialFile).toContain('\n')
  }
  const sha = head()
  const files = await gitCommitFiles(root, sha)
  expect(files).toHaveLength(3)
  expect(files).toEqual(expect.arrayContaining([
    { path: 'src/old.txt', status: 'A' },
    { path: globFile, status: 'A' },
    { path: specialFile, status: 'A' }
  ]))
  expect(await gitCommitDiff(root, sha, globFile)).toEqual({ before: '', after: 'literal\n' })
  expect(await gitCommitDiff(root, sha, specialFile)).toEqual({ before: '', after: 'special\n' })
})

it('compares renamed, modified and deleted files to the first parent', async () => {
  renameSync(join(root, 'src/old.txt'), join(root, 'src/new.txt'))
  git('add', '--all')
  git('commit', '-q', '-m', 'đổi tên')
  const renamed = head()
  expect(await gitCommitFiles(root, renamed)).toEqual([{ path: 'src/new.txt', from: 'src/old.txt', status: 'R' }])
  expect(await gitCommitDiff(root, renamed, 'src/new.txt', 'src/old.txt')).toEqual({ before: 'một\nhai\n', after: 'một\nhai\n' })

  writeFileSync(join(root, 'src/new.txt'), 'đã sửa\n')
  git('commit', '-qam', 'sửa')
  expect(await gitCommitDiff(root, head(), 'src/new.txt')).toEqual({ before: 'một\nhai\n', after: 'đã sửa\n' })
  git('rm', '-q', 'app/src/new.txt')
  git('commit', '-q', '-m', 'xoá')
  expect(await gitCommitDiff(root, head(), 'src/new.txt')).toEqual({ before: 'đã sửa\n', after: '' })
})

it('compares a merge against its first parent only', async () => {
  git('checkout', '-q', '-b', 'feature')
  writeFileSync(join(root, 'feature.txt'), 'feature\n')
  git('add', '--all')
  git('commit', '-q', '-m', 'feature')
  git('checkout', '-q', 'main')
  writeFileSync(join(root, 'main.txt'), 'main\n')
  git('add', '--all')
  git('commit', '-q', '-m', 'main')
  git('merge', '-q', '--no-ff', 'feature', '-m', 'merge')
  const sha = head()
  expect(await gitCommitFiles(root, sha)).toEqual([{ path: 'feature.txt', status: 'A' }])
  expect(await gitCommitDiff(root, sha, 'feature.txt')).toEqual({ before: '', after: 'feature\n' })
})

it('rejects revision expressions and paths outside the project', async () => {
  await expect(gitCommitFiles(root, 'HEAD')).rejects.toMatchObject({ code: 'bad_param' })
  await expect(gitCommitDiff(root, `${head()}^`, 'src/old.txt')).rejects.toMatchObject({ code: 'bad_param' })
  await expect(gitCommitDiff(root, head(), '../outside.txt')).rejects.toMatchObject({ code: 'outside_project' })
  await expect(gitCommitDiff(root, head(), 'src/old.txt', '../outside.txt')).rejects.toMatchObject({ code: 'outside_project' })
})
