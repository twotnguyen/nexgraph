import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { gitBlame, gitCommit, gitDiffSides, gitStage, gitStatus, gitUnstage } from '../src/main/git/repo'

let repo: string
let root: string // dự án là thư mục con của kho
const sh = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'ng-git-'))
  root = join(repo, 'app')
  mkdirSync(join(root, 'src'), { recursive: true })
  sh('init', '-q', '-b', 'main')
  sh('config', 'user.email', 'test@example.com')
  sh('config', 'user.name', 'Người Thử')
  writeFileSync(join(root, 'src/a.ts'), 'one\ntwo\n')
  writeFileSync(join(repo, 'outside.txt'), 'x\n')
  sh('add', '.')
  sh('commit', '-q', '-m', 'đầu tiên')
})
afterEach(() => rmSync(repo, { recursive: true, force: true }))

it('status chỉ trong thư mục dự án; stage, unstage, commit từng tệp; diff hai phía', async () => {
  writeFileSync(join(root, 'src/a.ts'), 'one\nTWO\n')
  writeFileSync(join(root, 'new.md'), '# mới\n')
  writeFileSync(join(repo, 'outside.txt'), 'changed\n')
  expect(await gitStatus(root)).toEqual({ repo: true, branch: 'main', staged: [], unstaged: [{ path: 'new.md', status: '?' }, { path: 'src/a.ts', status: 'M' }] })

  await gitStage(root, ['src/a.ts'])
  const staged = await gitStatus(root)
  expect(staged.staged).toEqual([{ path: 'src/a.ts', status: 'M' }])
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

it('blame theo nội dung trên đĩa: dòng đã commit có tác giả, dòng mới là chưa commit', async () => {
  writeFileSync(join(root, 'src/a.ts'), 'zero\none\ntwo\n')
  const lines = await gitBlame(root, 'src/a.ts')
  expect(lines.map((l) => [l.line, l.uncommitted, l.author, l.summary])).toEqual([
    [1, true, '', ''], [2, false, 'Người Thử', 'đầu tiên'], [3, false, 'Người Thử', 'đầu tiên']
  ])
})

it('thư mục không phải kho git', async () => {
  const plain = mkdtempSync(join(tmpdir(), 'ng-plain-'))
  expect(await gitStatus(plain)).toEqual({ repo: false, branch: null, staged: [], unstaged: [] })
  rmSync(plain, { recursive: true, force: true })
})
