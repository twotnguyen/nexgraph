import { randomUUID } from 'node:crypto'
import { mkdirSync, realpathSync } from 'node:fs'
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import type { FileContent, WriteOpts } from '../../shared/api'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export type FsErrorCode = 'outside_project' | 'file_not_found' | 'too_large' | 'not_text' | 'conflict'

export class FsError extends Error {
  constructor(public code: FsErrorCode, message: string) {
    super(message)
    this.name = 'FsError'
  }
}

type Eol = FileContent['eol']

export const MAX_EDIT_BYTES = 5 * 1024 * 1024

const outside = (relPath: string): FsError => new FsError('outside_project', `Đường dẫn nằm ngoài dự án: ${relPath}`)

/** `realpath` của tổ tiên gần nhất còn tồn tại, rồi nối phần chưa tồn tại: symlink ở bất kỳ cấp nào đều bị lộ ra. */
function realpathLoose(p: string): string {
  const tail: string[] = []
  let cur = p
  for (;;) {
    try {
      return join(realpathSync(cur), ...tail.reverse())
    } catch (e) {
      const parent = dirname(cur)
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT' || parent === cur) throw e
      tail.push(basename(cur))
      cur = parent
    }
  }
}

export function resolveInside(root: string, relPath: string): string {
  if (isAbsolute(relPath)) throw outside(relPath)
  const realRoot = realpathSync(root)
  const abs = realpathLoose(resolve(realRoot, relPath))
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
  if (opts.expectedMtimeMs !== undefined) {
    const cur = await stat(abs).catch(() => null)
    if (cur && cur.mtimeMs !== opts.expectedMtimeMs) throw new FsError('conflict', `Tệp đã thay đổi trên đĩa: ${relPath}`)
  }
  mkdirSync(dirname(abs), { recursive: true })
  const body = (opts.bom ? '﻿' : '') + (opts.eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text)
  // Cùng thư mục với đích để rename là nguyên tử (không qua ranh giới ổ đĩa).
  const tmp = join(dirname(abs), `.${basename(abs)}.${randomUUID()}.tmp`)
  try {
    await writeFile(tmp, body, 'utf8')
    await rename(tmp, abs)
  } catch (e) {
    await unlink(tmp).catch(() => {})
    throw e
  }
  return { mtimeMs: (await stat(abs)).mtimeMs }
}
