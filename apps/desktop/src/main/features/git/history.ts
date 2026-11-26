import { relative, resolve, sep } from 'node:path'
import type { GitCommit, GitFileChange } from '@nexgraph/contracts/api'
import { fail, git, safePaths } from './repo'

export function parseGitLog(raw: string): GitCommit[] {
  if (!raw) return []
  const fields = raw.split('\0')
  if (fields.length % 6 !== 0 && fields.at(-1) === '') fields.pop()
  if (fields.length % 6 !== 0) throw fail('git_failed', 'Không đọc được lịch sử Git')
  const commits: GitCommit[] = []
  for (let i = 0; i < fields.length; i += 6) {
    const [sha, parentField, author, timestamp, subject, refs] = fields.slice(i, i + 6)
    const parents = parentField ? parentField.split(' ') : []
    const time = Number(timestamp)
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(sha) ||
        parents.some((parent) => !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(parent)) ||
        !timestamp || !Number.isSafeInteger(time)) throw fail('git_failed', 'Không đọc được lịch sử Git')
    commits.push({ sha, parents, author, time, subject, refs })
  }
  return commits
}

export async function gitHistory(root: string, all: boolean): Promise<GitCommit[]> {
  if (typeof all !== 'boolean') throw fail('bad_param', 'Tuỳ chọn lịch sử không hợp lệ')
  if (!all && !(await git(root, ['rev-parse', '--verify', '-q', 'HEAD'], { okCodes: [1] })).trim()) return []
  const raw = await git(root, [
    'log', '-z', '--topo-order', '--decorate=short', '-n', '200',
    '--format=tformat:%H%x00%P%x00%an%x00%at%x00%s%x00%D', ...(all ? ['--all'] : ['HEAD'])
  ])
  return parseGitLog(raw)
}

async function commitAndParent(root: string, sha: string): Promise<{ commit: string; parent: string | null }> {
  if (typeof sha !== 'string' || !/^[0-9a-f]{7,64}$/i.test(sha)) throw fail('bad_param', 'Mã commit không hợp lệ')
  const ids = (await git(root, ['rev-list', '--parents', '-n', '1', sha, '--'])).trim().split(/\s+/)
  return { commit: ids[0], parent: ids[1] || null }
}

export async function gitCommitFiles(root: string, sha: string): Promise<GitFileChange[]> {
  const { commit, parent } = await commitAndParent(root, sha)
  const common = ['--name-status', '-z', '--find-renames', '--relative', '--no-ext-diff', '--no-textconv']
  const args = parent
    ? ['diff', ...common, parent, commit, '--', '.']
    : ['diff-tree', '--root', '--no-commit-id', '-r', ...common, commit, '--', '.']
  const fields = (await git(root, ['--literal-pathspecs', ...args])).split('\0')
  const changes: GitFileChange[] = []
  for (let i = 0; i < fields.length && fields[i];) {
    const status = fields[i++][0]
    const first = fields[i++]
    if (!first) throw fail('git_failed', 'Không đọc được danh sách tệp của commit')
    if (status === 'R' || status === 'C') {
      const path = fields[i++]
      if (!path) throw fail('git_failed', 'Không đọc được danh sách tệp của commit')
      changes.push({ path, status, from: first })
    } else {
      changes.push({ path: first, status })
    }
  }
  return changes
}

async function blobAt(root: string, revision: string, projectPath: string): Promise<string> {
  const relativePath = relative(resolve(root, '.'), resolve(root, projectPath)).split(sep).join('/')
  const prefix = (await git(root, ['rev-parse', '--show-prefix'])).replace(/\r?\n$/, '')
  const spec = `${revision}:${prefix}${relativePath}`
  const type = await git(root, ['cat-file', '-t', spec]).catch(() => '')
  if (type.trim() === 'blob') return git(root, ['cat-file', 'blob', spec])
  if (type.trim() === 'commit') return `Subproject commit ${(await git(root, ['rev-parse', spec])).trim()}\n`
  return ''
}

export async function gitCommitDiff(root: string, sha: string, file: string, from?: string): Promise<{ before: string; after: string }> {
  const [path, oldPath] = safePaths(root, [file, from === undefined ? file : from])
  const { commit, parent } = await commitAndParent(root, sha)
  const before = parent ? await blobAt(root, parent, oldPath) : ''
  const after = await blobAt(root, commit, path)
  return { before, after }
}
