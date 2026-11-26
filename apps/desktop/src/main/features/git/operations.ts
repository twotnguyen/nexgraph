import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { resolveInside } from '../../platform/project-fs'
import type { GitStash } from '@nexgraph/contracts/api'
import { fail, git, safePaths } from './repo'

export async function gitRestore(root: string, file: unknown, trashItem: (path: string) => Promise<void>): Promise<void> {
  const [path] = safePaths(root, [file])
  if (typeof trashItem !== 'function') throw fail('bad_param', 'Cần chọn một tệp')
  const spec = `:(literal)${path}`
  const tracked = await git(root, ['ls-files', '-z', '--', spec])
  if (tracked.split('\0').filter(Boolean).length) {
    await git(root, ['restore', '--worktree', '--', spec])
    return
  }
  const untracked = await git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', spec])
  if (!untracked.split('\0').filter(Boolean).length) throw fail('bad_param', 'Tệp không có thay đổi để khôi phục')
  await trashItem(resolveInside(root, path))
}

export async function gitBranches(root: string): Promise<string[]> {
  const out = await git(root, ['for-each-ref', '--format=%(refname:strip=2)', 'refs/heads/'])
  return out.split('\n').filter(Boolean)
}

export async function gitSwitchBranch(root: string, name: unknown, create: boolean): Promise<void> {
  if (typeof name !== 'string' || !name || name.startsWith('-') || name === 'HEAD' || typeof create !== 'boolean') {
    throw fail('bad_param', 'Tên nhánh không hợp lệ')
  }
  try {
    await git(root, ['check-ref-format', `refs/heads/${name}`])
  } catch {
    throw fail('bad_param', 'Tên nhánh không hợp lệ')
  }
  if (create) await git(root, ['switch', '-c', name])
  else await git(root, ['switch', '--no-guess', '--', name])
}

const remoteJobs = new Map<string, Promise<void>>()


export async function gitRemote(root: string, op: 'fetch' | 'pull' | 'push'): Promise<string> {
  if (op !== 'fetch' && op !== 'pull' && op !== 'push') throw fail('bad_param', 'Thao tác remote không hợp lệ')
  const common = (await git(root, ['rev-parse', '--git-common-dir'])).replace(/\n$/, '')
  const key = await realpath(resolve(root, common))
  const previous = remoteJobs.get(key) ?? Promise.resolve()
  const job = previous.then(async () => {
    if (op !== 'push') return git(root, op === 'pull' ? ['pull', '--no-edit'] : ['fetch'], { includeStderr: true })
    const branch = (await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { okCodes: [1] })).trim()
    if (!branch) throw fail('git_failed', 'Cần chọn nhánh trước khi push')
    const config = async (name: string) => (await git(root, ['config', '--get', name], { okCodes: [1] })).trim()
    const [branchRemote, pushRemote, defaultRemote, merge, remoteList] = await Promise.all([
      config(`branch.${branch}.remote`), config(`branch.${branch}.pushRemote`), config('remote.pushDefault'),
      config(`branch.${branch}.merge`), git(root, ['remote'])
    ])
    const remotes = remoteList.split('\n').filter(Boolean)
    const remote = pushRemote || defaultRemote || (branchRemote !== '.' ? branchRemote : '') || (remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0] : '')
    if (!remote || !remotes.includes(remote)) throw fail('git_failed', 'Không xác định được remote để push')
    const destination = branchRemote === remote && merge ? merge : `refs/heads/${branch}`
    if (!destination.startsWith('refs/heads/')) throw fail('git_failed', 'Nhánh đích không hợp lệ')
    await git(root, ['check-ref-format', destination])
    return git(root, ['push', '--no-force', ...(!branchRemote ? ['--set-upstream'] : []), '--', remote, `HEAD:${destination}`], { includeStderr: true })
  })
  const settled = job.then(() => {}, () => {})
  remoteJobs.set(key, settled)
  try {
    return await job
  } finally {
    if (remoteJobs.get(key) === settled) remoteJobs.delete(key)
  }
}


export async function gitStashes(root: string): Promise<GitStash[]> {
  const parts = (await git(root, ['stash', 'list', '-z', '--format=%gd%x00%gs'])).split('\0')
  const result: GitStash[] = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    if (parts[i]) result.push({ ref: parts[i], message: parts[i + 1] })
  }
  return result
}

export async function gitStashSave(root: string, message: unknown): Promise<void> {
  if (typeof message !== 'string' || message.includes('\0')) throw fail('bad_param', 'Thông điệp stash không hợp lệ')
  await git(root, ['stash', 'push', '--include-untracked', ...(message.trim() ? ['-m', message] : []), '--', '.'])
}

export async function gitStashAction(root: string, ref: unknown, action: 'apply' | 'pop' | 'drop'): Promise<void> {
  if (typeof ref !== 'string' || !/^stash@\{(?:0|[1-9]\d*)\}$/.test(ref) || !['apply', 'pop', 'drop'].includes(action)) {
    throw fail('bad_param', 'Thao tác stash không hợp lệ')
  }
  await git(root, ['stash', action, ref])
}
