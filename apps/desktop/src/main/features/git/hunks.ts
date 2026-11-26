import { createHash } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import type { GitHunk } from '@nexgraph/contracts/api'
import { UserError } from '../../platform/user-error'
import { git, safePaths } from './repo'

type PatchHunk = GitHunk & { patch: string }

async function patches(root: string, file: string, staged: boolean): Promise<PatchHunk[]> {
  const [path] = safePaths(root, [file])
  if (typeof staged !== 'boolean') throw new UserError('bad_param', 'Trạng thái stage không hợp lệ')
  const spec = `:(literal)${path}`
  const side = staged ? ['--cached'] : []
  const names = await git(root, ['diff', ...side, '--name-only', '-z', '--no-renames', '--relative', '--', spec])
  const changed = names.split('\0').filter(Boolean)
  if (changed.some((name) => name !== path)) throw new UserError('bad_param', 'Cần chọn một tệp cụ thể')

  let diff: string
  if (changed.length) {
    diff = await git(root, ['diff', ...side, '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--full-index', '--no-relative', '--unified=3', '--inter-hunk-context=0', '--src-prefix=a/', '--dst-prefix=b/', '--', spec])
  } else if (!staged) {
    const untracked = await git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', spec])
    if (!untracked.split('\0').includes(path)) return []
    if (!(await lstat(join(root, path))).isFile()) return []
    const prefix = (await git(root, ['rev-parse', '--show-prefix'])).replace(/\n$/, '')
    diff = await git(root, ['diff', '--no-index', '--no-color', '--no-ext-diff', '--no-textconv', '--full-index', '--unified=3', '--inter-hunk-context=0', `--src-prefix=a/${prefix}`, `--dst-prefix=b/${prefix}`, '--', '/dev/null', path === '-' ? './-' : path], { okCodes: [1] })
  } else {
    return []
  }

  if ((diff.match(/^diff --git /gm) ?? []).length > 1) throw new UserError('stale_hunk', 'Tệp đã thay đổi. Hãy làm mới và thử lại.')
  const headers = Array.from(diff.matchAll(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@[^\n]*(?:\n|$)/gm))
  if (!headers.length) return []
  let prelude = diff.slice(0, headers[0].index).replace(/^old mode [^\n]*\nnew mode [^\n]*\n/m, '')
  if (path === '-' && !changed.length) prelude = prelude.replace(/\/\.\/-(?= |"|\n)/g, '/-')
  return headers.map((match, i) => {
    const patch = prelude + diff.slice(match.index, headers[i + 1]?.index ?? diff.length)
    return {
      id: createHash('sha256').update(patch).digest('hex'),
      header: match[0].replace(/\n$/, ''),
      oldStart: Number(match[1]),
      newStart: Number(match[2]),
      patch
    }
  })
}

export async function gitHunks(root: string, file: string, staged: boolean): Promise<GitHunk[]> {
  return (await patches(root, file, staged)).map(({ id, header, oldStart, newStart }) => ({ id, header, oldStart, newStart }))
}

export async function gitApplyHunk(root: string, file: string, staged: boolean, id: string): Promise<void> {
  if (typeof id !== 'string' || !/^[0-9a-f]{64}$/.test(id)) throw new UserError('bad_param', 'Mã khối thay đổi không hợp lệ')
  const hunk = (await patches(root, file, staged)).find((item) => item.id === id)
  if (!hunk) throw new UserError('stale_hunk', 'Khối thay đổi đã cũ. Hãy làm mới và thử lại.')
  await git(root, ['-c', 'apply.ignoreWhitespace=no', 'apply', '--cached', '--whitespace=nowarn', ...(staged ? ['--reverse'] : []), '-'], { stdin: hunk.patch })
}
