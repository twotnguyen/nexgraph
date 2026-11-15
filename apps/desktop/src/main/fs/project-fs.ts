import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, realpathSync } from 'node:fs'
import { chmod, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import type { FileContent, WriteOpts } from '../../shared/api'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export type FsErrorCode = 'outside_project' | 'file_not_found' | 'too_large' | 'not_text' | 'conflict' | 'unknown_project'

export class FsError extends Error {
  constructor(public code: FsErrorCode, message: string) {
    super(message)
    this.name = 'FsError'
  }
}

type Eol = FileContent['eol']

export const MAX_EDIT_BYTES = 5 * 1024 * 1024

const outside = (relPath: string): FsError => new FsError('outside_project', `Đường dẫn nằm ngoài dự án: ${relPath}`)
const danglingLink = (): Error => Object.assign(new Error('Symlink treo'), { code: 'dangling_symlink' })

/** `realpath` của tổ tiên gần nhất còn tồn tại, rồi nối phần chưa tồn tại: symlink ở bất kỳ cấp nào đều bị lộ ra.
 * ENOENT không có nghĩa là "chưa có": lstat để phát hiện symlink treo (đích không tồn tại) — bỏ qua nó sẽ để ghi tạo tệp ngoài dự án qua symlink. */
function realpathLoose(p: string): string {
  const tail: string[] = []
  let cur = p
  for (;;) {
    try {
      return join(realpathSync(cur), ...tail.reverse())
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      let st: Stats | undefined
      try {
        st = lstatSync(cur)
      } catch {
        // thành phần không có thật: leo tiếp lên cha
      }
      if (st?.isSymbolicLink()) throw danglingLink()
      const parent = dirname(cur)
      if (parent === cur) throw e
      tail.push(basename(cur))
      cur = parent
    }
  }
}

export function resolveInside(root: string, relPath: string): string {
  if (isAbsolute(relPath)) throw outside(relPath)
  const realRoot = realpathSync(root)
  let abs: string
  try {
    abs = realpathLoose(resolve(realRoot, relPath))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'dangling_symlink') throw outside(relPath)
    throw e
  }
  const rel = relative(realRoot, abs)
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw outside(relPath)
  return abs
}

const notFound = (relPath: string): FsError => new FsError('file_not_found', `Không tìm thấy tệp: ${relPath}`)

export async function readProjectFile(root: string, relPath: string): Promise<FileContent> {
  const abs = resolveInside(root, relPath)
  let st
  try {
    st = await stat(abs)
  } catch {
    throw notFound(relPath)
  }
  if (!st.isFile()) throw notFound(relPath)
  const base = { eol: '\n' as Eol, bom: false, mtimeMs: st.mtimeMs, readOnly: true }
  if (st.size > MAX_EDIT_BYTES) return { ...base, text: '', reason: 'too_large' }
  const buf = await readFile(abs)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf)
  } catch {
    return { ...base, text: '', reason: 'not_text' }
  }
  const bom = text.charCodeAt(0) === 0xfeff
  if (bom) text = text.slice(1)
  const eol: Eol = text.includes('\r\n') ? '\r\n' : '\n'
  return { text: text.replace(/\r\n/g, '\n'), eol, bom, mtimeMs: st.mtimeMs, readOnly: false }
}

export async function writeProjectFile(
  root: string,
  relPath: string,
  text: string,
  opts: WriteOpts
): Promise<{ mtimeMs: number }> {
  const abs = resolveInside(root, relPath)
  if (Buffer.byteLength(text, 'utf8') > MAX_EDIT_BYTES) throw new FsError('too_large', `Nội dung quá lớn: ${relPath}`)
  const cur = await stat(abs).catch(() => null)
  if (cur) {
    // Tệp đang có trên đĩa mà đọc ra chỉ-đọc thì không được ghi đè (đọc trả text rỗng, ghi sẽ làm mất dữ liệu).
    if (cur.isFile()) {
      const r = await readProjectFile(root, relPath)
      if (r.reason) throw new FsError(r.reason, `Tệp không thể sửa (${r.reason}): ${relPath}`)
    }
    if (opts.expectedMtimeMs !== undefined && cur.mtimeMs !== opts.expectedMtimeMs)
      throw new FsError('conflict', `Tệp đã thay đổi trên đĩa: ${relPath}`)
  }
  mkdirSync(dirname(abs), { recursive: true })
  const body = (opts.bom ? '﻿' : '') + (opts.eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text)
  // Cùng thư mục với đích để rename là nguyên tử (không qua ranh giới ổ đĩa).
  const tmp = join(dirname(abs), `.${basename(abs)}.${randomUUID()}.tmp`)
  try {
    await writeFile(tmp, body, 'utf8')
    if (cur?.isFile()) await chmod(tmp, cur.mode & 0o7777) // giữ quyền (vd. bit thực thi) của tệp gốc
    await rename(tmp, abs)
  } catch (e) {
    await unlink(tmp).catch(() => {})
    throw e
  }
  return { mtimeMs: (await stat(abs)).mtimeMs }
}

type ProjectLookup = () => Promise<{ project_id: string; path: string }[]>

/** Thân handler `fs:read`/`fs:write`: tra gốc dự án từ `projectId` rồi gọi hàm đọc/ghi an toàn. */
/** Gốc dự án theo projectId; id lạ → FsError('unknown_project'). */
export const projectRoot = (listProjects: ProjectLookup) => async (pid: string): Promise<string> => {
  const p = (await listProjects()).find((x) => x.project_id === pid)
  if (!p) throw new FsError('unknown_project', `Không tìm thấy dự án: ${pid}`) // cùng mã với engine
  return p.path
}

export function fsHandlers(listProjects: ProjectLookup): {
  read: (pid: string, relPath: string) => Promise<FileContent>
  write: (pid: string, relPath: string, text: string, opts: WriteOpts) => Promise<{ mtimeMs: number }>
} {
  const rootOf = projectRoot(listProjects)
  return {
    read: async (pid, relPath) => readProjectFile(await rootOf(pid), relPath),
    write: async (pid, relPath, text, opts) => writeProjectFile(await rootOf(pid), relPath, text, opts)
  }
}
