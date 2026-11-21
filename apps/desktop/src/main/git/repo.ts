import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import type { GitBlameLine, GitFileChange, GitStatus } from '../../shared/api'
import { resolveInside } from '../fs/project-fs'

const run = promisify(execFile)
const fail = (code: string, message: string): Error => Object.assign(new Error(message), { code })

/** Chạy git trong gốc dự án; lỗi trả về câu git in ra (đã cắt gọn). Không dùng shell. */
async function git(root: string, args: string[], input?: { okCodes?: number[] }): Promise<string> {
  try {
    const { stdout } = await run('git', ['-c', 'core.quotepath=off', '-c', 'color.ui=false', ...args], {
      cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
    })
    return stdout
  } catch (error) {
    const e = error as { code?: number | string; stdout?: string; stderr?: string }
    if (typeof e.code === 'number' && input?.okCodes?.includes(e.code)) return e.stdout ?? ''
    if (e.code === 'ENOENT') throw fail('no_git', 'Không tìm thấy lệnh git trên máy')
    throw fail('git_failed', (e.stderr || String(error)).trim().split('\n').slice(-3).join('\n'))
  }
}

/** Đường dẫn do renderer gửi: phải là tương đối và nằm trong dự án. */
function safePaths(root: string, files: unknown): string[] {
  if (!Array.isArray(files) || files.some((f) => typeof f !== 'string' || !f)) throw fail('bad_param', 'Danh sách tệp không hợp lệ')
  for (const file of files as string[]) resolveInside(root, file)
  return files as string[]
}

/**
 * Trạng thái kiểu Git panel của Wu: tệp đã stage và chưa stage (gồm tệp mới) trong phạm vi thư mục dự án.
 * Đường dẫn trả về tương đối với gốc dự án (dự án có thể là thư mục con của kho).
 */
export async function gitStatus(root: string): Promise<GitStatus> {
  let prefix: string
  try {
    prefix = (await git(root, ['rev-parse', '--show-prefix'])).trim()
  } catch (error) {
    if ((error as { code?: string }).code === 'git_failed') return { repo: false, branch: null, staged: [], unstaged: [] }
    throw error
  }
  const branch = (await git(root, ['branch', '--show-current'])).trim() || null
  const raw = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'])
  const parts = raw.split('\0')
  const staged: GitFileChange[] = []
  const unstaged: GitFileChange[] = []
  const local = (path: string) => (prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path)
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (entry.length < 4) continue
    const x = entry[0]
    const y = entry[1]
    const path = local(entry.slice(3))
    // Đổi tên/chép: mục kế tiếp là tên cũ.
    const from = x === 'R' || x === 'C' ? local(parts[++i] ?? '') : undefined
    if (x === '?' && y === '?') { unstaged.push({ path, status: '?' }); continue }
    if (x !== ' ' && x !== '?') staged.push({ path, status: x, ...(from ? { from } : {}) })
    if (y !== ' ' && y !== '?') unstaged.push({ path, status: y })
  }
  const byPath = (a: GitFileChange, b: GitFileChange) => a.path.localeCompare(b.path)
  return { repo: true, branch, staged: staged.sort(byPath), unstaged: unstaged.sort(byPath) }
}

export async function gitStage(root: string, files: unknown): Promise<void> {
  await git(root, ['add', '--', ...safePaths(root, files)])
}

export async function gitUnstage(root: string, files: unknown): Promise<void> {
  const paths = safePaths(root, files)
  // Kho chưa có commit nào thì không có HEAD để restore: bỏ khỏi index bằng rm --cached.
  const hasHead = await git(root, ['rev-parse', '--verify', '-q', 'HEAD'], { okCodes: [1] })
  await git(root, hasHead.trim() ? ['restore', '--staged', '--', ...paths] : ['rm', '-q', '--cached', '--', ...paths])
}

/** Commit những gì đã stage; trả về mã commit ngắn. */
export async function gitCommit(root: string, message: unknown): Promise<string> {
  if (typeof message !== 'string' || !message.trim()) throw fail('bad_param', 'Cần thông điệp commit')
  await git(root, ['commit', '-q', '-m', message])
  return (await git(root, ['rev-parse', '--short', 'HEAD'])).trim()
}

/**
 * Hai phía của diff một tệp: đã stage thì HEAD ↔ index, chưa stage thì index ↔ thư mục làm việc.
 * Phía không tồn tại (tệp mới, tệp đã xoá) là chuỗi rỗng.
 */
export async function gitDiffSides(root: string, file: unknown, staged: boolean): Promise<{ before: string; after: string }> {
  const [path] = safePaths(root, [file])
  const show = (spec: string) => git(root, ['show', spec]).catch(() => '')
  const rel = `./${path}`
  if (staged) return { before: await show(`HEAD:${rel}`), after: await show(`:${rel}`) }
  const after = await readFile(resolveInside(root, path), 'utf8').catch(() => '')
  const indexed = await git(root, ['ls-files', '--', path])
  return { before: indexed.trim() ? await show(`:${rel}`) : '', after }
}

/** Blame từng dòng của bản trên đĩa (dòng chưa commit có `uncommitted`). */
export async function gitBlame(root: string, file: unknown): Promise<GitBlameLine[]> {
  const [path] = safePaths(root, [file])
  const contents = await readFile(resolveInside(root, path), 'utf8')
  // --contents -: blame theo nội dung hiện tại để số dòng khớp editor kể cả khi tệp đã sửa.
  const out = await new Promise<string>((resolve, reject) => {
    const child = execFile('git', ['-c', 'core.quotepath=off', 'blame', '--porcelain', '--contents', '-', '--', path],
      { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
        if (error) reject(fail('git_failed', (stderr || String(error)).trim().split('\n').slice(-2).join('\n')))
        else resolve(stdout)
      })
    child.stdin?.end(contents)
  })
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
