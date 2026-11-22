import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { gitApplyHunk, gitHunks } from '../src/main/git/hunks'

let repo: string
let root: string
const sh = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
const original = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
const first = original.replace('line 2\n', 'first change\n')
const both = first.replace('line 18\n', 'second change\n')

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'ng-hunks-'))
  root = join(repo, 'app')
  mkdirSync(root)
  sh('init', '-q', '-b', 'main')
  sh('config', 'user.email', 'test@example.com')
  sh('config', 'user.name', 'Người Thử')
  writeFileSync(join(root, 'file.txt'), original)
  sh('add', '.')
  sh('commit', '-q', '-m', 'initial')
})
afterEach(() => rmSync(repo, { recursive: true, force: true }))

it('stages and unstages exactly one of multiple hunks', async () => {
  writeFileSync(join(root, 'file.txt'), both)
  const hunks = await gitHunks(root, 'file.txt', false)
  expect(hunks).toHaveLength(2)
  await gitApplyHunk(root, 'file.txt', false, hunks[0].id)
  expect(sh('show', ':app/file.txt')).toBe(first)
  expect(readFileSync(join(root, 'file.txt'), 'utf8')).toBe(both)
  const remaining = await gitHunks(root, 'file.txt', false)
  expect(remaining).toHaveLength(1)
  await gitApplyHunk(root, 'file.txt', false, remaining[0].id)
  expect(sh('show', ':app/file.txt')).toBe(both)

  const staged = await gitHunks(root, 'file.txt', true)
  expect(staged).toHaveLength(2)
  await gitApplyHunk(root, 'file.txt', true, staged[0].id)
  expect(sh('show', ':app/file.txt')).toBe(original.replace('line 18\n', 'second change\n'))
  expect(readFileSync(join(root, 'file.txt'), 'utf8')).toBe(both)
})

it('rejects stale or invalid hunk identities without changing the index', async () => {
  writeFileSync(join(root, 'file.txt'), both)
  const [hunk] = await gitHunks(root, 'file.txt', false)
  writeFileSync(join(root, 'file.txt'), both.replace('first change', 'newer change'))
  await expect(gitApplyHunk(root, 'file.txt', false, hunk.id)).rejects.toThrow()
  await expect(gitApplyHunk(root, 'file.txt', false, 'not-a-hunk')).rejects.toThrow()
  expect(sh('show', ':app/file.txt')).toBe(original)
  await expect(gitHunks(root, '../outside.txt', false)).rejects.toMatchObject({ code: 'outside_project' })
})

it('handles literal paths with spaces and tabs and missing final newlines', async () => {
  // Win32 cấm tab trong tên tệp; POSIX giữ fixture đặc biệt.
  const file = process.platform === 'win32' ? '[name] space file.txt' : '[name] space\tfile.txt'
  if (process.platform !== 'win32') expect(file).toContain('\t')
  writeFileSync(join(root, file), 'before\nlast')
  sh('--literal-pathspecs', 'add', '--', `app/${file}`)
  sh('commit', '-q', '-m', 'special filename')
  writeFileSync(join(root, file), 'after\nlast')
  const [hunk] = await gitHunks(root, file, false)
  expect(hunk).toBeDefined()
  await gitApplyHunk(root, file, false, hunk.id)
  expect(sh('show', `:app/${file}`)).toBe('after\nlast')
  const [staged] = await gitHunks(root, file, true)
  await gitApplyHunk(root, file, true, staged.id)
  expect(sh('show', `:app/${file}`)).toBe('before\nlast')
})

it('leaves a staged mode change intact when unstaging a content hunk', async () => {
  writeFileSync(join(root, 'file.txt'), first)
  sh('add', '--', 'app/file.txt')
  sh('update-index', '--chmod=+x', '--', 'app/file.txt')
  const [hunk] = await gitHunks(root, 'file.txt', true)
  await gitApplyHunk(root, 'file.txt', true, hunk.id)
  expect(sh('show', ':app/file.txt')).toBe(original)
  expect(sh('ls-files', '-s', '--', 'app/file.txt')).toMatch(/^100755 /)
})

it('stages a file named like a Git option', async () => {
  const file = '-'
  writeFileSync(join(root, file), 'before\nlast')
  sh('--literal-pathspecs', 'add', '--', `app/${file}`)
  sh('commit', '-q', '-m', 'dash filename')
  writeFileSync(join(root, file), 'after\nlast')
  const [hunk] = await gitHunks(root, file, false)
  expect(hunk).toBeDefined()
  await gitApplyHunk(root, file, false, hunk.id)
  expect(sh('show', ':app/-')).toBe('after\nlast')
})

it('stages and unstages a new untracked text file in a nested project', async () => {
  const file = 'new file.txt'
  writeFileSync(join(root, file), 'new text\nno final newline')
  const hunks = await gitHunks(root, file, false)
  expect(hunks).toHaveLength(1)
  await gitApplyHunk(root, file, false, hunks[0].id)
  expect(sh('show', ':app/new file.txt')).toBe('new text\nno final newline')
  const staged = await gitHunks(root, file, true)
  expect(staged).toHaveLength(1)
  await gitApplyHunk(root, file, true, staged[0].id)
  expect(sh('ls-files', '--', 'app/new file.txt')).toBe('')
  expect(readFileSync(join(root, file), 'utf8')).toBe('new text\nno final newline')
})
