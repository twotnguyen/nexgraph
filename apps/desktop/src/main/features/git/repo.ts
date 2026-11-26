import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'
import type { GitBlameLine, GitFileChange, GitStatus } from '@nexgraph/contracts/api'
import { resolveInside } from '../../platform/project-fs'
import { safeProcessEnv } from '../../platform/process-env'
import { UserError } from '../../platform/user-error'

export const fail = (code: string, message: string): Error => new UserError(code, message)

/** Git không cần credential của app; chỉ LC_ALL/GIT_* đặt tường minh, không kế thừa process.env. */
export const gitEnv = (source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => safeProcessEnv(source, {
  LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'false', SSH_ASKPASS: 'false',
  SSH_ASKPASS_REQUIRE: 'never', GCM_INTERACTIVE: 'Never', GIT_OPTIONAL_LOCKS: '0'
})


/** Trả về đường dẫn tệp tương đối gốc dự án, không bị thoát khỏi dự án bởi ../ hoặc symlink. */
const relativePath = (root: string, file: string) => relative(resolveInside(root, '.'), resolveInside(root, file)).split('\\').join('/')
export async function git(root: string, args: string[], options?: { okCodes?: number[]; stdin?: string; includeStderr?: boolean }): Promise<string> {
  let done!: (value: string) => void
  let failed!: (error: Error) => void
  const output = new Promise<string>((resolve, reject) => { done = resolve; failed = reject })
  // `core.fsmonitor=` (rỗng) tắt hook fsmonitor của repo: .git/config của repo lạ không được chạy mã (REV-16).
  const child = execFile('git', ['-c', 'core.quotepath=off', '-c', 'color.ui=false', '-c', 'core.fsmonitor=', ...args], {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: gitEnv()
  }, (error, stdout, stderr) => {
    if (!error || (typeof error.code === 'number' && options?.okCodes?.includes(error.code))) {
      done(options?.includeStderr && stderr ? [stdout, stderr].filter(Boolean).join('\n') : stdout)
    } else if (error.code === 'ENOENT') {
      failed(fail('no_git', 'Không tìm thấy lệnh git trên máy'))
    } else {
      failed(fail('git_failed', [stderr, stdout].filter(Boolean).join('\n').trim() || error.message))
    }
  })
  child.stdin?.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') failed(fail('git_failed', error.message))
  })
  child.stdin?.end(options?.stdin)
  return output
}


/** Đường dẫn do renderer gửi: phải là tương đối và nằm trong dự án. */
export function safePaths(root: string, files: unknown): string[] {
  if (!Array.isArray(files) || !files.length || files.some((f) => typeof f !== 'string' || !f || f.includes('\0'))) throw fail('bad_param', 'Danh sách tệp không hợp lệ')
  for (const file of files as string[]) resolveInside(root, file)
  return files as string[]
}

type Counts = { added: number | null; deleted: number | null }

function numstat(raw: string): Map<string, Counts> {
  const parts = raw.split('\0')
  const result = new Map<string, Counts>()
  for (let i = 0; i < parts.length; i++) {
    const row = parts[i]
    const first = row.indexOf('\t')
    const second = row.indexOf('\t', first + 1)
    if (first < 0 || second < 0) continue
    const added = row.slice(0, first)
    const deleted = row.slice(first + 1, second)
    let path = row.slice(second + 1)
    if (!path) { i++; path = parts[++i] ?? '' }
    if (path) result.set(path, { added: added === '-' ? null : Number(added), deleted: deleted === '-' ? null : Number(deleted) })
  }
  return result
}

async function untrackedCounts(root: string, file: string): Promise<Counts> {
  try {
    const data = await readFile(resolveInside(root, file))
    if (data.subarray(0, 8000).includes(0)) return { added: null, deleted: null }
    let lines = 0
    for (const byte of data) if (byte === 10) lines++
    return { added: lines + (data.length > 0 && data[data.length - 1] !== 10 ? 1 : 0), deleted: 0 }
  } catch {
    return { added: null, deleted: null }
  }
}

/** Chỉ chắc chắn chưa xuất bản khi không có remote nào; remote không đọc được thì coi như đã xuất bản. */
export async function gitHeadPublished(root: string): Promise<boolean> {
  return !!(await git(root, ['for-each-ref', '--contains=HEAD', '--format=%(refname)', 'refs/remotes/'])).trim() ||
    !!(await git(root, ['remote'])).trim()
}

/** Amend an toàn chỉ khi HEAD không nằm trên remote ref đã biết. */
export async function gitHeadKnownPublished(root: string): Promise<boolean> {
  return !!(await git(root, ['for-each-ref', '--contains=HEAD', '--format=%(refname)', 'refs/remotes/'])).trim()
}

/** Trạng thái tệp tương đối với dự án, kể cả khi dự án là thư mục con của kho. */
export async function gitStatus(root: string): Promise<GitStatus> {
  let prefix: string
  try {
    prefix = (await git(root, ['rev-parse', '--show-prefix'])).replace(/\n$/, '')
  } catch (error) {
    if ((error as Error).message.includes('not a git repository')) {
      return { repo: false, branch: null, staged: [], unstaged: [], conflicts: [], upstream: null, ahead: 0, behind: 0, remote: null, lastCommit: null }
    }
    throw error
  }
  const [branchRaw, head, raw, stagedRaw, unstagedRaw, remotesRaw] = await Promise.all([
    git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { okCodes: [1] }),
    git(root, ['rev-parse', '--verify', '-q', 'HEAD'], { okCodes: [1] }),
    git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']),
    git(root, ['diff', '--cached', '--numstat', '-z', '--no-ext-diff', '--relative', '--', '.']),
    git(root, ['diff', '--numstat', '-z', '--no-ext-diff', '--relative', '--', '.']),
    git(root, ['remote'])
  ])
  const branch = branchRaw.trim() || null
  const upstream = branch && head.trim()
    ? (await git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { okCodes: [128] })).trim() || null
    : null
  const [ahead, behind] = upstream
    ? (await git(root, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])).trim().split(/\s+/).map(Number)
    : [0, 0]
  const remotes = remotesRaw.split('\n').filter(Boolean)
  const branchRemote = branch ? (await git(root, ['config', '--get', `branch.${branch}.remote`], { okCodes: [1] })).trim() : ''
  const remote = remotes.includes(branchRemote) ? branchRemote : remotes.includes('origin') ? 'origin' : remotes[0] ?? null
  let lastCommit: GitStatus['lastCommit'] = null
  if (head.trim()) {
    const [log, pushed] = await Promise.all([
      git(root, ['log', '-1', '--format=%H%x00%s%x00%B%x00%P%x00']),
      gitHeadPublished(root)
    ])
    const [sha, subject, message, parents] = log.split('\0')
    lastCommit = { sha, subject, message: message.replace(/\n$/, ''), hasParent: !!parents, pushed }
  }
  const parts = raw.split('\0')
  const staged: GitFileChange[] = []
  const unstaged: GitFileChange[] = []
  const conflicts: GitFileChange[] = []
  const stagedCounts = numstat(stagedRaw)
  const unstagedCounts = numstat(unstagedRaw)
  const local = (path: string) => prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (entry.length < 4) continue
    const x = entry[0]
    const y = entry[1]
    const path = local(entry.slice(3))
    const oldPath = (x === 'R' || x === 'C' || y === 'R' || y === 'C') ? parts[++i] : ''
    const from = oldPath && (!prefix || oldPath.startsWith(prefix)) ? local(oldPath) : undefined
    if (x === '?' && y === '?') {
      unstaged.push({ path, status: '?', ...await untrackedCounts(root, path) })
    } else if (['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(x + y)) {
      conflicts.push({ path, status: x + y })
    } else {
      if (x !== ' ' && x !== '?') staged.push({ path, status: x, ...(from ? { from } : {}), ...stagedCounts.get(path) })
      if (y !== ' ' && y !== '?') unstaged.push({ path, status: y, ...(from && (y === 'R' || y === 'C') ? { from } : {}), ...unstagedCounts.get(path) })
    }
  }
  const byPath = (a: GitFileChange, b: GitFileChange) => a.path.localeCompare(b.path)
  return { repo: true, branch, staged: staged.sort(byPath), unstaged: unstaged.sort(byPath), conflicts: conflicts.sort(byPath), upstream, ahead, behind, remote, lastCommit }
}

export async function gitStage(root: string, files: unknown): Promise<void> {
  await git(root, ['add', '--', ...safePaths(root, files).map((path) => `:(literal)${path}`)])
}

export async function gitUnstage(root: string, files: unknown): Promise<void> {
  const paths = safePaths(root, files)
  // Kho chưa có commit nào thì không có HEAD để restore: bỏ khỏi index bằng rm --cached.
  const hasHead = await git(root, ['rev-parse', '--verify', '-q', 'HEAD'], { okCodes: [1] })
  const literal = paths.map((path) => `:(literal)${path}`)
  await git(root, hasHead.trim() ? ['restore', '--staged', '--', ...literal] : ['rm', '-q', '-r', '--cached', '--', ...literal])
}

/** Commit những gì đã stage; trả về mã commit ngắn. Không sửa commit đã xuất bản. */
export async function gitCommit(root: string, message: unknown, amend = false, coAuthors: unknown = []): Promise<string> {
  if (typeof message !== 'string' || !message.trim() || typeof amend !== 'boolean') throw fail('bad_param', 'Cần thông điệp commit hợp lệ')
  if (!Array.isArray(coAuthors)) throw fail('bad_param', 'Danh sách đồng tác giả không hợp lệ')
  const trailers = coAuthors.map((value) => {
    if (typeof value !== 'string') throw fail('bad_param', 'Đồng tác giả không hợp lệ')
    const line = value.trim()
    if (!line || /[\r\n\0]/.test(line)) throw fail('bad_param', 'Đồng tác giả không hợp lệ')
    return `Co-authored-by: ${line}`
  })
  if (amend && await gitHeadKnownPublished(root)) throw fail('git_failed', 'Không thể sửa commit đã xuất bản')
  await git(root, ['commit', '-q', ...(amend ? ['--amend'] : []), '-m', message, ...(trailers.length ? ['-m', trailers.join('\n')] : [])])
  return (await git(root, ['rev-parse', '--short', 'HEAD'])).trim()
}

/**
 * Hai phía của diff một tệp: đã stage thì HEAD ↔ index, chưa stage thì index ↔ thư mục làm việc.
 * Có `base`: phía trước lấy nội dung tại ref đó, phía sau giữ nguyên index/worktree.
 * Phía không tồn tại (tệp mới, tệp đã xoá) là chuỗi rỗng.
 */
export async function gitDiffSides(root: string, file: unknown, staged: boolean, base?: string): Promise<{ before: string; after: string }> {
  const path = relativePath(root, safePaths(root, [file])[0])
  if (base !== undefined && (typeof base !== 'string' || !/^(?!-)[A-Za-z0-9._\/^~-]+$/.test(base))) throw fail('bad_param', 'Base không hợp lệ')
  const show = (spec: string) => git(root, ['show', spec]).catch(() => '')
  const rel = `./${path}`
  const after = staged ? show(`:${rel}`) : readFile(resolveInside(root, path), 'utf8').catch(() => '')
  if (base !== undefined) return { before: await show(`${base}:${rel}`), after: await after }
  if (staged) return { before: await show(`HEAD:${rel}`), after: await after }
  const indexed = await git(root, ['ls-files', '-z', '--', `:(literal)${path}`])
  return { before: indexed.split('\0').filter(Boolean).length ? await show(`:${rel}`) : '', after: await after }
}

/** Blame từng dòng của bản trên đĩa (dòng chưa commit có `uncommitted`). */
export async function gitBlame(root: string, file: unknown): Promise<GitBlameLine[]> {
  const [input] = safePaths(root, [file])
  const path = relativePath(root, input)
  const contents = await readFile(resolveInside(root, path), 'utf8')
  // --contents -: blame theo nội dung hiện tại để số dòng khớp editor kể cả khi tệp đã sửa.
  let done!: (value: string) => void
  let failed!: (error: Error) => void
  const outPromise = new Promise<string>((resolve, reject) => { done = resolve; failed = reject })
  const child = execFile('git', ['-c', 'core.quotepath=off', '-c', 'core.fsmonitor=', 'blame', '--porcelain', '--contents', '-', '--', path],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: gitEnv() }, (error, stdout, stderr) => {
      if (error) failed(fail('git_failed', (stderr || String(error)).trim().split('\n').slice(-2).join('\n')))
      else done(stdout)
    })
  child.stdin?.end(contents)
  const out = await outPromise
  const commits = new Map<string, { author: string; time: number; summary: string }>()
  const lines: GitBlameLine[] = []
  let current: { sha: string; line: number } | null = null
  for (const row of out.split('\n')) {
    const head = /^([0-9a-f]{40}) \d+ (\d+)/.exec(row)
    if (head) { current = { sha: head[1], line: Number(head[2]) }; if (!commits.has(head[1])) commits.set(head[1], { author: '', time: 0, summary: '' }); continue }
    if (!current) continue
    const info = commits.get(current.sha)!
    if (row.startsWith('author ')) info.author = row.slice(7)
    else if (row.startsWith('author-time ')) info.time = Number(row.slice(12))
    else if (row.startsWith('summary ')) info.summary = row.slice(8)
    else if (row.startsWith('\t')) {
      const uncommitted = /^0{40}$/.test(current.sha)
      lines.push({ line: current.line, sha: current.sha.slice(0, 8), author: uncommitted ? '' : info.author, time: info.time, summary: uncommitted ? '' : info.summary, uncommitted })
    }
  }
  return lines
}

export { gitRestore, gitBranches, gitSwitchBranch, gitRemote, gitStashes, gitStashSave, gitStashAction } from './operations'
