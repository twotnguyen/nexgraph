import { realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { GitWorktree } from '../../shared/api'
import { fail, git } from './repo'

/** Porcelain trả `C:/...` hoặc tên ngắn; `resolve` cũng đổi separator về dạng native khi thư mục đã mất. */
export const canonicalPath = (path: string): string => {
  try { return realpathSync.native(path) } catch { return resolve(path) }
}

/** Mỗi worktree là một khối dòng `từ-khoá giá trị` cách nhau dòng trống; khối đầu là worktree chính. Bỏ kho bare (không có thư mục làm việc). */
export function parseWorktrees(raw: string): Omit<GitWorktree, 'current'>[] {
  const worktrees: Omit<GitWorktree, 'current'>[] = []
  raw.replace(/\r\n/g, '\n').split('\n\n').forEach((block, index) => {
    const fields = new Map<string, string>()
    for (const line of block.split('\n')) {
      const space = line.indexOf(' ')
      if (line) fields.set(space < 0 ? line : line.slice(0, space), space < 0 ? '' : line.slice(space + 1))
    }
    const path = fields.get('worktree')
    if (!path || fields.has('bare')) return
    worktrees.push({
      path, head: fields.get('HEAD') ?? '', branch: fields.get('branch')?.replace(/^refs\/heads\//, '') ?? null,
      detached: fields.has('detached'), locked: fields.has('locked'), prunable: fields.has('prunable'), main: index === 0
    })
  })
  return worktrees
}

/** `current`: worktree chứa thư mục dự án (dự án có thể là thư mục con của worktree). */
export async function gitWorktrees(root: string): Promise<GitWorktree[]> {
  const [raw, top] = await Promise.all([git(root, ['worktree', 'list', '--porcelain']), git(root, ['rev-parse', '--show-toplevel'])])
  const here = canonicalPath(top.replace(/\r?\n$/, ''))
  return parseWorktrees(raw).map((worktree) => {
    const path = canonicalPath(worktree.path)
    return { ...worktree, path, current: path === here }
  })
}

const BAD_BRANCH = 'Tên nhánh không hợp lệ'

/** Worktree mới cho nhánh mới (từ HEAD) hoặc nhánh có sẵn, đặt ở `<cha của kho>/<tên kho>-worktrees/<nhánh>`; trả về thư mục đã tạo. */
export async function gitWorktreeAdd(root: string, branch: unknown, existing: unknown): Promise<string> {
  if (typeof branch !== 'string' || typeof existing !== 'boolean' || !branch || branch.startsWith('-') || branch.includes('\0')) throw fail('bad_param', BAD_BRANCH)
  // `--branch` còn mở rộng `@{-1}`: tên hợp lệ phải ra đúng như đã gõ.
  const checked = await git(root, ['check-ref-format', '--branch', branch]).catch(() => '')
  if (checked.trim() !== branch) throw fail('bad_param', BAD_BRANCH)
  if (existing && !(await git(root, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`], { okCodes: [1] })).trim()) {
    throw fail('bad_param', `Không có nhánh “${branch}”`)
  }
  const list = await gitWorktrees(root)
  const anchor = (list.find((item) => item.main) ?? list[0])?.path
  if (!anchor) throw fail('git_failed', 'Không tìm thấy worktree chính của kho')
  const path = join(dirname(anchor), `${basename(anchor)}-worktrees`, branch.replace(/[\\/:*?"<>|]/g, '-'))
  await git(root, existing ? ['worktree', 'add', '--', path, branch] : ['worktree', 'add', '-b', branch, '--', path])
  return path
}

/** Không `--force`: worktree còn thay đổi chưa commit hoặc tệp chưa theo dõi thì từ chối. Chỉ xoá được worktree git đang liệt kê. */
export async function gitWorktreeRemove(root: string, path: unknown): Promise<void> {
  const target = typeof path === 'string' ? (await gitWorktrees(root)).find((item) => item.path === path) : undefined
  if (!target) throw fail('bad_param', 'Không tìm thấy worktree')
  if (target.main) throw fail('bad_param', 'Không thể xóa worktree chính của kho')
  if (target.current) throw fail('bad_param', 'Không thể xóa worktree đang mở. Hãy mở worktree khác trước.')
  try {
    await git(root, ['worktree', 'remove', '--', target.path])
  } catch (error) {
    if (error instanceof Error && error.message.includes('contains modified or untracked files')) {
      throw fail('worktree_dirty', 'Worktree còn thay đổi chưa commit hoặc tệp chưa theo dõi. Hãy commit, stash hoặc dọn rồi thử lại.')
    }
    throw error
  }
}
