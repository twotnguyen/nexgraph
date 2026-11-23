import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync, constants, copyFileSync, fchmodSync, fstatSync, linkSync, lstatSync, mkdirSync,
  openSync, readSync, realpathSync, renameSync, statSync, unlinkSync, writeFile
} from 'node:fs'
import type { BigIntStats, Stats } from 'node:fs'
import { opendir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { FileContent, FileRevision, ProjectDirectory, WriteOpts } from '../../shared/api'
import { shouldIgnore } from '../watch/ignore'

export type FsErrorCode = 'outside_project' | 'file_not_found' | 'too_large' | 'not_text' | 'conflict' | 'unknown_project' | 'protected_path' | 'bad_param'

export class FsError extends Error {
  constructor(public code: FsErrorCode, message: string) {
    super(message)
    this.name = 'FsError'
  }
}

type Eol = FileContent['eol']

export const MAX_EDIT_BYTES = 5 * 1024 * 1024

const outside = (relPath: string): FsError => new FsError('outside_project', `Đường dẫn nằm ngoài dự án: ${relPath}`)
const protectedPath = (relPath: string): FsError => new FsError('protected_path', `Tệp hoặc thư mục được bảo vệ: ${relPath}`)
const danglingLink = (): Error => Object.assign(new Error('Symlink treo'), { code: 'dangling_symlink' })
const conflict = (relPath: string): FsError => new FsError('conflict', `Tệp đã thay đổi trên đĩa: ${relPath}`)

const PROTECTED_NAMES = new Set(['.git', '.nexgraph', '.npmrc', '.netrc'])
const PROTECTED_PREFIXES = ['.env', 'credentials', 'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa']

/**
 * Deny-list dùng chung cho fs:read/write và cổng tool của pi (`pinPath` → `previewWrite`):
 * mặc định chặn dữ liệu nhạy cảm, kể cả khi người dùng đã duyệt một thao tác ghi.
 * Nhận cả dấu `/` lẫn `\` để cùng đúng trên macOS/Linux và Windows.
 */
export function isProtectedRel(relPath: string): boolean {
  return relPath.toLowerCase().split(/[/\\]/).some((name) =>
    PROTECTED_NAMES.has(name) || name.endsWith('.pem') || name.endsWith('.key') ||
    PROTECTED_PREFIXES.some((prefix) => name.startsWith(prefix)))
}

/**
 * Tệp khai task chỉ được ghi qua luồng duyệt của agent (`extension.ts` → `writeProjectFile`), không qua `fs:write`
 * của renderer: renderer bị chiếm không được tự khai task rồi xin chữ ký (rereview-38 M2). ADR 0016.
 */
const RENDERER_WRITE_DENIED = new Set(['.vscode/tasks.json'])

const normalizeRel = (relPath: string): string => relPath.toLowerCase().replace(/\\/g, '/').replace(/^(\.\/)+/, '')

export const isRendererWriteDenied = (relPath: string): boolean => RENDERER_WRITE_DENIED.has(normalizeRel(relPath))

/** `realpath` của tổ tiên gần nhất còn tồn tại, rồi nối phần chưa tồn tại: symlink ở bất kỳ cấp nào đều bị lộ ra.
 * ENOENT không có nghĩa là "chưa có": lstat để phát hiện symlink treo (đích không tồn tại) — bỏ qua nó sẽ để ghi tạo tệp ngoài dự án qua symlink. */
function realpathLoose(p: string): string {
  const tail: string[] = []
  let cur = p
  for (;;) {
    try {
      return join(realpathSync.native(cur), ...tail.reverse())
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
  // NTFS có luồng dữ liệu thay thế (file:stream), không phải tệp thường trong cây dự án.
  if (isAbsolute(relPath) || (process.platform === 'win32' && relPath.includes(':'))) throw outside(relPath)
  if (isProtectedRel(relPath)) throw protectedPath(relPath)
  const realRoot = realpathSync.native(root)
  let abs: string
  try {
    abs = realpathLoose(resolve(realRoot, relPath))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'dangling_symlink') throw outside(relPath)
    throw e
  }
  const rel = relative(realRoot, abs)
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw outside(relPath)
  if (isProtectedRel(rel)) throw protectedPath(relPath)
  return abs
}

const notFound = (relPath: string): FsError => new FsError('file_not_found', `Không tìm thấy tệp: ${relPath}`)

const EXPLORER_IGNORED_DIRS = new Set(['.venv', 'dist', '.next', '.cache', '.turbo', '__pycache__'])
const MAX_DIRECTORY_ENTRIES = 500
const MAX_DIRECTORY_SCAN = 10_000

/** Đọc một thư mục, bỏ link và dùng chung phạm vi an toàn với trình soạn thảo. */
async function listProjectDirectory(root: string, directory: string): Promise<ProjectDirectory> {
  const realRoot = realpathSync.native(root)
  const path = resolveInside(realRoot, directory)
  const before = lstatIfPresent(path)
  if (resolve(realRoot, directory) !== path) throw outside(directory)
  if (!before?.isDirectory()) throw new FsError('file_not_found', `Không tìm thấy thư mục: ${directory}`)

  const prefix = relative(realRoot, path).split(sep).join('/')
  const ignored = (relativePath: string) => shouldIgnore(relativePath) || relativePath.split('/').some((part) => EXPLORER_IGNORED_DIRS.has(part))
  if (ignored(prefix)) throw protectedPath(directory)
  const entries: ProjectDirectory['entries'] = []
  let scanned = 0
  for await (const entry of await opendir(path)) {
    if (++scanned > MAX_DIRECTORY_SCAN) break
    if (entry.name.includes('\\') || (!entry.isDirectory() && !entry.isFile())) continue
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (isProtectedRel(relPath) || ignored(relPath)) continue
    entries.push({ path: relPath, name: entry.name, kind: entry.isDirectory() ? 'directory' : 'file' })
  }
  if (resolveInside(realRoot, directory) !== path || !sameDirectory(path, before)) throw conflict(directory)

  entries.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, undefined, { numeric: true }))
  return { entries: entries.slice(0, MAX_DIRECTORY_ENTRIES), truncated: scanned > MAX_DIRECTORY_SCAN || entries.length > MAX_DIRECTORY_ENTRIES }
}

function lstatIfPresent(abs: string): BigIntStats | null {
  try {
    return lstatSync(abs, { bigint: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function metadata(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.birthtimeNs].join('/')
}

function revision(stat: BigIntStats, bytes: Buffer | null): FileRevision {
  const hash = createHash('sha256').update(metadata(stat))
  if (bytes) hash.update('\0').update(bytes)
  const second = 1_000_000_000n
  return {
    mtimeMs: Number(stat.mtimeNs / second) * 1000 + Number(stat.mtimeNs % second) / 1_000_000,
    version: hash.digest('hex')
  }
}

type DiskFile = { stat: BigIntStats; bytes: Buffer | null; revision: FileRevision }

function snapshotFile(abs: string, relPath: string, maxBytes = MAX_EDIT_BYTES): DiskFile | null {
  const stat = lstatIfPresent(abs)
  if (!stat) return null
  if (stat.isSymbolicLink()) throw conflict(relPath)
  if (!stat.isFile() || stat.size > BigInt(maxBytes)) {
    return { stat, bytes: null, revision: revision(stat, null) }
  }
  // Gắn nội dung và thông tin định danh với cùng một inode, kể cả khi có người đổi đích trong lúc đọc.
  let fd
  try {
    fd = openSync(abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ELOOP') throw conflict(relPath)
    throw error
  }
  try {
    const matches = (candidate: BigIntStats) =>
      candidate.ctimeNs === stat.ctimeNs && metadata(candidate) === metadata(stat)
    if (!matches(fstatSync(fd, { bigint: true }))) throw conflict(relPath)
    const size = Number(stat.size)
    const buffer = Buffer.allocUnsafe(size + 1)
    let count = 0
    while (count < buffer.length) {
      const read = readSync(fd, buffer, count, buffer.length - count, null)
      if (read === 0) break
      count += read
    }
    const current = lstatIfPresent(abs)
    if (count !== size || !matches(fstatSync(fd, { bigint: true })) ||
        !current || !matches(current)) throw conflict(relPath)
    const bytes = buffer.subarray(0, size)
    return { stat, bytes, revision: revision(stat, bytes) }
  } finally {
    closeSync(fd)
  }
}

function decodeFile(file: DiskFile): FileContent {
  const base = { ...file.revision, eol: '\n' as Eol, bom: false, readOnly: true }
  if (!file.bytes) return { ...base, text: '', reason: 'too_large' }
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(file.bytes)
  } catch {
    return { ...base, text: '', reason: 'not_text' }
  }
  if (text.includes('\0')) return { ...base, text: '', reason: 'not_text' }
  const bom = text.charCodeAt(0) === 0xfeff
  if (bom) text = text.slice(1)
  const eol: Eol = text.includes('\r\n') ? '\r\n' : '\n'
  return { ...file.revision, text: text.replace(/\r\n/g, '\n'), eol, bom, readOnly: false }
}

function readProjectSnapshot(root: string, relPath: string, maxBytes = MAX_EDIT_BYTES): DiskFile {
  const abs = resolveInside(root, relPath)
  const file = snapshotFile(abs, relPath, maxBytes)
  if (!file?.stat.isFile()) throw notFound(relPath)
  if (resolveInside(root, relPath) !== abs) throw conflict(relPath)
  return file
}

export async function readProjectFile(root: string, relPath: string): Promise<FileContent> {
  return decodeFile(readProjectSnapshot(root, relPath))
}

/** Đọc cùng snapshot đã kiểm tra với editor, giữ byte gốc cho công cụ AI. */
export function readProjectFileBytes(root: string, relPath: string, maxBytes = MAX_EDIT_BYTES): Buffer {
  const { bytes } = readProjectSnapshot(root, relPath, maxBytes)
  if (!bytes) throw new FsError('too_large', `Tệp quá lớn: ${relPath}`)
  return bytes
}

type ProjectFsHooks = {
  /** Mô phỏng tệp trên đĩa bị đổi trong khi chuẩn bị ghi. */
  beforeRename?: () => void | Promise<void>
  assertNotCancelled?: () => void
}

const pendingWrites = new Map<string, Promise<void>>()
const writeStage = promisify(writeFile)
const pathKey = (abs: string): string =>
  process.platform === 'win32' || process.platform === 'darwin' ? abs.toLowerCase() : abs

function sameInode(left: BigIntStats | null, right: BigIntStats): boolean {
  return left !== null && left.dev === right.dev && left.ino === right.ino
}

function sameDirectory(path: string, original: BigIntStats): boolean {
  const current = lstatIfPresent(path)
  return current?.isDirectory() === true && sameInode(current, original)
}

function removeStage(tmp: string, parent: string, originalParent: BigIntStats, fd: number): void {
  try {
    if (sameDirectory(parent, originalParent) && sameInode(lstatIfPresent(tmp), fstatSync(fd, { bigint: true }))) {
      unlinkSync(tmp)
    }
  } catch {
    // Cha có thể đã đổi vị trí. Không dọn tệp tạm qua đường dẫn đã bị tráo.
  }
}

async function publishProjectFile(
  root: string, relPath: string, abs: string, text: string, opts: WriteOpts, hooks: ProjectFsHooks
): Promise<FileRevision> {
  hooks.assertNotCancelled?.()
  if (resolveInside(root, relPath) !== abs) throw conflict(relPath)
  const file = snapshotFile(abs, relPath)
  if (opts.expectedVersion !== undefined) {
    if (opts.expectedVersion !== (file?.revision.version ?? null)) throw conflict(relPath)
  } else if (opts.expectedMtimeMs !== undefined && opts.expectedMtimeMs !== file?.revision.mtimeMs) {
    throw conflict(relPath)
  }
  if (file) {
    if (!file.stat.isFile()) throw notFound(relPath)
    const { reason } = decodeFile(file)
    if (reason) throw new FsError(reason, `Tệp không thể sửa (${reason}): ${relPath}`)
  }
  if (Buffer.byteLength(text) > MAX_EDIT_BYTES) throw new FsError('too_large', `Nội dung quá lớn: ${relPath}`)
  const body = Buffer.from((opts.bom ? '\uFEFF' : '') + (opts.eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text))
  if (body.length > MAX_EDIT_BYTES) throw new FsError('too_large', `Nội dung quá lớn: ${relPath}`)

  const parent = dirname(abs)
  mkdirSync(parent, { recursive: true })
  const previousParent = lstatSync(parent, { bigint: true })
  const checkLocation = () => {
    if (resolveInside(root, relPath) !== abs) throw conflict(relPath)
    if (realpathSync.native(parent) !== parent || !sameDirectory(parent, previousParent)) {
      throw outside(relPath)
    }
  }
  checkLocation()
  const tmp = join(parent, `.${basename(abs)}.${randomUUID()}.tmp`)
  const fd = openSync(tmp, 'wx')
  try {
    await writeStage(fd, body)
    if (file) fchmodSync(fd, Number(file.stat.mode & 0o7777n))
    await hooks.beforeRename?.()

    // Kiểm tra lại nội dung thật, kể cả khi mtime giống cũ, ngay trước khi thay tệp.
    checkLocation()
    if (!sameInode(lstatIfPresent(tmp), fstatSync(fd, { bigint: true }))) throw conflict(relPath)
    const latest = snapshotFile(abs, relPath)
    if (latest?.revision.version !== file?.revision.version) throw conflict(relPath)
    checkLocation()
    hooks.assertNotCancelled?.()
    if (file) {
      renameSync(tmp, abs)
    } else {
      // Link chỉ công bố tệp tạm đã ghi xong nếu đích còn trống.
      try {
        linkSync(tmp, abs)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'EEXIST') throw conflict(relPath)
        // FAT32/exFAT, một số ổ mạng không có hard link: chép độc quyền, vẫn thất bại nếu đích đã có.
        if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EXDEV' && code !== 'EINVAL' && code !== 'ENOSYS') throw error
        try {
          copyFileSync(tmp, abs, constants.COPYFILE_EXCL)
        } catch (copyError) {
          if ((copyError as NodeJS.ErrnoException).code === 'EEXIST') throw conflict(relPath)
          throw copyError
        }
        return revision(statSync(abs, { bigint: true }), body)
      }
    }
    // Bản ghi dùng handle vừa công bố; trên NTFS, ctime có thể đổi khi handle đóng sau unlink.
    return revision(fstatSync(fd, { bigint: true }), body)
  } finally {
    removeStage(tmp, parent, previousParent, fd)
    closeSync(fd)
  }
}

export async function writeProjectFile(
  root: string,
  relPath: string,
  text: string,
  opts: WriteOpts,
  hooks: ProjectFsHooks | NonNullable<ProjectFsHooks['beforeRename']> = {}
): Promise<FileRevision> {
  const abs = resolveInside(root, relPath)
  const key = pathKey(abs)
  const previous = pendingWrites.get(key)
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  pendingWrites.set(key, current)
  try {
    await previous
    return await publishProjectFile(root, relPath, abs, text, opts, typeof hooks === 'function' ? { beforeRename: hooks } : hooks)
  } finally {
    release()
    if (pendingWrites.get(key) === current) pendingWrites.delete(key)
  }
}

type ProjectLookup = () => Promise<{ project_id: string; path: string }[]>

/** Xoá đúng phiên bản tệp do AI vừa tạo khi hoàn tác checkpoint, cùng hàng đợi với thao tác lưu. */
export async function deleteProjectFile(root: string, relPath: string, expectedVersion: string, assertCurrent?: () => void): Promise<void> {
  const abs = resolveInside(root, relPath)
  const key = pathKey(abs)
  const previous = pendingWrites.get(key)
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  pendingWrites.set(key, current)
  try {
    await previous
    const before = readProjectSnapshot(root, relPath)
    if (before.revision.version !== expectedVersion) throw conflict(relPath)
    if (resolveInside(root, relPath) !== abs) throw conflict(relPath)
    const latest = snapshotFile(abs, relPath)
    if (latest?.revision.version !== expectedVersion) throw conflict(relPath)
    assertCurrent?.()
    unlinkSync(abs)
  } finally {
    release()
    if (pendingWrites.get(key) === current) pendingWrites.delete(key)
  }
}

/** Thân handler `fs:read`/`fs:write`: tra gốc dự án từ `projectId` rồi gọi hàm đọc/ghi an toàn. */
/** Gốc dự án theo projectId; id lạ → FsError('unknown_project'). */
export const projectRoot = (listProjects: ProjectLookup) => async (pid: string): Promise<string> => {
  const p = (await listProjects()).find((x) => x.project_id === pid)
  if (!p) throw new FsError('unknown_project', `Không tìm thấy dự án: ${pid}`) // cùng mã với engine
  return p.path
}

/** `target` có nằm trong `base` không (realpath hoá phần tồn tại, chặn `..` và symlink ra ngoài). */
export function isWithin(base: string, target: string): boolean {
  try {
    const realBase = realpathSync.native(base)
    const rel = relative(realBase, realpathLoose(resolve(realBase, target)))
    return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)
  } catch {
    return false
  }
}

export function fsHandlers(listProjects: ProjectLookup): {
  list: (pid: string, directory: string) => Promise<ProjectDirectory>
  read: (pid: string, relPath: string) => Promise<FileContent>
  write: (pid: string, relPath: string, text: string, opts: WriteOpts) => Promise<FileRevision>
} {
  const rootOf = projectRoot(listProjects)
  return {
    list: async (pid, directory) => listProjectDirectory(await rootOf(pid), directory),
    read: async (pid, relPath) => readProjectFile(await rootOf(pid), relPath),
    write: async (pid, relPath, text, opts) => {
      if (isRendererWriteDenied(relPath)) throw protectedPath(relPath)
      return writeProjectFile(await rootOf(pid), relPath, text, opts)
    }
  }
}
