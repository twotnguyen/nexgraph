import {
  chmodSync, closeSync, constants, fchmodSync, fstatSync, futimesSync, linkSync, lstatSync,
  mkdirSync, openSync, readdirSync, readSync, realpathSync, renameSync, rmdirSync, unlinkSync,
  utimesSync, writeSync, type BigIntStats
} from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { FsError, isProtectedRel, isRendererWriteDenied, projectRoot, resolveInside } from './project-fs'
import { UserError } from '../user-error'

type ProjectLookup = () => Promise<{ project_id: string; path: string }[]>
type ProjectShell = { trashItem(path: string): Promise<void>; showItemInFolder(path: string): void }
type Entry = { path: string; stat: BigIntStats }
type Created = Entry & { parent: Entry; directory: boolean }

const sameInode = (a: BigIntStats, b: BigIntStats): boolean => a.dev === b.dev && a.ino === b.ino
const sameVersion = (a: BigIntStats, b: BigIntStats): boolean =>
  sameInode(a, b) && a.mode === b.mode && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs
const conflict = (path: string): FsError => new FsError('conflict', `Tệp hoặc thư mục đã tồn tại hoặc thay đổi: ${path}`)
const notFound = (path: string): FsError => new FsError('file_not_found', `Không tìm thấy tệp hoặc thư mục: ${path}`)

function safePath(root: string, path: string, allowRoot = false): string {
  if (typeof path !== 'string' || path.includes('\0')) throw new FsError('bad_param', 'Đường dẫn không hợp lệ')
  // Cùng lý do với fs:write: renderer không được tự tạo/copy/đổi tên thành tệp khai task (rereview-38 M2).
  if (isRendererWriteDenied(path)) throw new FsError('protected_path', `Tệp hoặc thư mục được bảo vệ: ${path}`)
  const abs = resolveInside(root, path)
  let current = root
  for (const part of path.split(process.platform === 'win32' ? /[\\/]/ : /\//).filter((part) => part && part !== '.')) {
    current = resolve(current, part)
    const rel = relative(root, current)
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new FsError('outside_project', `Đường dẫn nằm ngoài dự án: ${path}`)
    if (present(current)?.isSymbolicLink()) throw new FsError('outside_project', `Không hỗ trợ đường dẫn qua liên kết: ${path}`)
  }
  if (resolve(root, path) !== abs) throw new FsError('outside_project', `Không hỗ trợ đường dẫn qua liên kết: ${path}`)
  if (!allowRoot && abs === root) throw new FsError('bad_param', 'Không thể thao tác với thư mục gốc dự án')
  return abs
}

function present(path: string): BigIntStats | null {
  try {
    return lstatSync(path, { bigint: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function item(root: string, path: string, allowRoot = false): Entry {
  const abs = safePath(root, path, allowRoot)
  const stat = present(abs)
  if (!stat) throw notFound(path)
  if (!stat.isFile() && !stat.isDirectory()) throw new FsError('bad_param', `Không hỗ trợ mục này: ${path}`)
  return { path: abs, stat }
}

function directory(root: string, path: string): Entry {
  const entry = item(root, path, true)
  if (!entry.stat.isDirectory()) throw new FsError('bad_param', `Không phải thư mục: ${path}`)
  return entry
}

function checkEntry(root: string, entry: Entry): void {
  const path = relative(root, entry.path)
  if (safePath(root, path, true) !== entry.path) throw conflict(path)
  const current = present(entry.path)
  if (!current || !sameVersion(current, entry.stat)) throw conflict(path)
}

function tree(root: string, entry: Entry, skipLinks = false): Entry[] {
  const entries: Entry[] = []
  const visit = (current: Entry): void => {
    entries.push(current)
    checkEntry(root, current)
    if (!current.stat.isDirectory()) return
    for (const name of readdirSync(current.path)) {
      const child = join(current.path, name)
      const rel = relative(root, child)
      if (isProtectedRel(rel)) throw new FsError('protected_path', `Tệp hoặc thư mục được bảo vệ: ${rel}`)
      if (skipLinks && lstatSync(child).isSymbolicLink()) continue
      visit(item(root, rel))
    }
    checkEntry(root, current)
  }
  visit(entry)
  return entries
}

function ensureParents(root: string, target: string): void {
  const parent = dirname(target)
  let current = root
  for (const part of relative(root, parent).split(sep).filter(Boolean)) {
    current = safePath(root, relative(root, join(current, part)))
    if (!present(current)) {
      try { mkdirSync(current) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    directory(root, relative(root, current))
  }
}

function parentEntry(root: string, path: string): Entry {
  return directory(root, relative(root, dirname(path)))
}

function cleanCreated(root: string, created: Created[]): void {
  for (const entry of created.reverse()) {
    try {
      safePath(root, relative(root, entry.path))
      const parent = present(entry.parent.path)
      const current = present(entry.path)
      if (!parent || !sameInode(parent, entry.parent.stat) || !current || !sameInode(current, entry.stat)) continue
      if (entry.directory) rmdirSync(entry.path)
      else unlinkSync(entry.path)
    } catch {
      // Không xoá qua thư mục bị tráo hoặc xoá mục người khác vừa thêm.
    }
  }
}

function copyEntries(root: string, entries: Entry[], target: string): Created[] {
  const created: Created[] = []
  const createdDirectories = new Map<string, Created>()
  const originalParent = parentEntry(root, target)
  let createdTarget = false
  const directories: { source: Entry; created: Created }[] = []
  let buffer: Buffer | undefined
  try {
    for (const source of entries) {
      checkEntry(root, source)
      const dest = safePath(root, relative(root, join(target, relative(entries[0].path, source.path))))
      const parent = parentEntry(root, dest)
      if (dest !== target) {
        const createdParent = createdDirectories.get(parent.path)
        if (!createdParent || !sameInode(parent.stat, createdParent.stat)) throw conflict(relative(root, dest))
      }
      if (source.stat.isDirectory()) {
        mkdirSync(dest)
        if (dest === target) createdTarget = true
        const createdDir = { path: dest, stat: lstatSync(dest, { bigint: true }), parent, directory: true }
        created.push(createdDir)
        createdDirectories.set(dest, createdDir)
        directories.push({ source, created: createdDir })
      } else {
        const input = openSync(source.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
        try {
          if (!sameVersion(fstatSync(input, { bigint: true }), source.stat)) throw conflict(relative(root, source.path))
          const output = openSync(dest, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600)
          if (dest === target) createdTarget = true
          try {
            created.push({ path: dest, stat: fstatSync(output, { bigint: true }), parent, directory: false })
            buffer ??= Buffer.allocUnsafe(64 * 1024)
            for (;;) {
              const count = readSync(input, buffer, 0, buffer.length, null)
              if (count === 0) break
              for (let offset = 0; offset < count;) {
                const written = writeSync(output, buffer, offset, count - offset)
                if (!written) throw new UserError('filesystem_error', 'Không thể ghi bản sao')
                offset += written
              }
            }
            if (!sameVersion(fstatSync(input, { bigint: true }), source.stat)) throw conflict(relative(root, source.path))
            checkEntry(root, source)
            fchmodSync(output, Number(source.stat.mode & 0o7777n))
            futimesSync(output, Number(source.stat.atimeNs) / 1e9, Number(source.stat.mtimeNs) / 1e9)
          } finally {
            closeSync(output)
          }
        } finally {
          closeSync(input)
        }
      }
      const currentParent = present(parent.path)
      if (!currentParent || !sameInode(currentParent, parent.stat)) throw conflict(relative(root, dest))
    }
    for (const { source, created: createdDir } of directories.reverse()) {
      const dest = createdDir.path
      safePath(root, relative(root, dest))
      const current = present(dest)
      if (!current || !sameInode(current, createdDir.stat)) throw conflict(relative(root, dest))
      checkEntry(root, source)
      chmodSync(dest, Number(source.stat.mode & 0o7777n))
      utimesSync(dest, Number(source.stat.atimeNs) / 1e9, Number(source.stat.mtimeNs) / 1e9)
    }
    const currentParent = present(originalParent.path)
    if (!currentParent || !sameInode(currentParent, originalParent.stat)) throw conflict(relative(root, target))
    return created
  } catch (error) {
    cleanCreated(root, created)
    if (createdTarget && (error as NodeJS.ErrnoException).code === 'EEXIST') throw conflict(relative(root, target))
    throw error
  }
}

function insideDirectory(parent: string, path: string): boolean {
  const rel = relative(parent, path)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

async function perform<T>(action: string, fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof FsError || error instanceof UserError) throw error
    const err = error as NodeJS.ErrnoException
    if (err?.code === 'EEXIST' || err?.code === 'ENOTEMPTY') throw conflict('')
    if (err?.code === 'ENOENT') throw notFound('')
    const reason = err?.code === 'EACCES' || err?.code === 'EPERM' ? 'không có quyền truy cập'
      : err?.code === 'ENOSPC' ? 'không đủ dung lượng'
        : err?.code === 'EXDEV' ? 'không thể đổi tên giữa hai ổ đĩa'
          : 'lỗi hệ thống tệp'
    throw new UserError('filesystem_error', `Không thể ${action}: ${reason}`)
  }
}

export function projectOperations(listProjects: ProjectLookup, shell: ProjectShell) {
  const rootOf = projectRoot(listProjects)
  const root = async (pid: string): Promise<string> => realpathSync.native(await rootOf(pid))
  return {
    createFile: (pid: string, path: string): Promise<void> => perform('tạo tệp', async () => {
      const base = await root(pid)
      const dest = safePath(base, path)
      ensureParents(base, dest)
      const parent = parentEntry(base, dest)
      safePath(base, path)
      const fd = openSync(dest, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o666)
      try {
        const created = fstatSync(fd, { bigint: true })
        try {
          safePath(base, path)
          const current = present(dest)
          const currentParent = present(parent.path)
          if (!current || !sameInode(current, created) || !currentParent || !sameInode(currentParent, parent.stat)) throw conflict(path)
        } catch (error) {
          cleanCreated(base, [{ path: dest, stat: created, parent, directory: false }])
          throw error
        }
      } finally {
        closeSync(fd)
      }
    }),
    createDir: (pid: string, path: string): Promise<void> => perform('tạo thư mục', async () => {
      const base = await root(pid)
      const dest = safePath(base, path)
      ensureParents(base, dest)
      const parent = parentEntry(base, dest)
      safePath(base, path)
      mkdirSync(dest)
      const created = lstatSync(dest, { bigint: true })
      try {
        safePath(base, path)
        const current = present(dest)
        const currentParent = present(parent.path)
        if (!current || !sameInode(current, created) || !currentParent || !sameInode(currentParent, parent.stat)) throw conflict(path)
      } catch (error) {
        cleanCreated(base, [{ path: dest, stat: created, parent, directory: true }])
        throw error
      }
    }),
    rename: (pid: string, from: string, to: string): Promise<void> => perform('đổi tên', async () => {
      const base = await root(pid)
      const sourcePath = safePath(base, from)
      const dest = safePath(base, to)
      const source = item(base, from)
      const parent = parentEntry(base, dest)
      if (source.stat.isDirectory() && insideDirectory(sourcePath, dest)) throw new FsError('bad_param', 'Không thể chuyển thư mục vào chính nó')
      const entries = tree(base, source)
      for (const entry of entries) {
        const movedPath = relative(base, join(dest, relative(sourcePath, entry.path)))
        if (isProtectedRel(movedPath)) throw new FsError('protected_path', `Tệp hoặc thư mục được bảo vệ: ${movedPath}`)
      }
      if (present(dest)) throw conflict(to)
      checkEntry(base, source)
      checkEntry(base, parent)
      if (source.stat.isFile()) {
        try {
          linkSync(sourcePath, dest)
        } catch (error) {
          if (!['EXDEV', 'EPERM', 'ENOTSUP', 'EINVAL', 'ENOSYS'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
          const created = copyEntries(base, entries, dest)
          try {
            checkEntry(base, source)
            unlinkSync(sourcePath)
          } catch (removeError) {
            cleanCreated(base, created)
            throw removeError
          }
          return
        }
        const linked = present(dest)
        try {
          const current = present(sourcePath)
          if (!linked || !current || !sameInode(linked, source.stat) || !sameInode(current, source.stat)) throw conflict(from)
          safePath(base, from)
          safePath(base, to)
          unlinkSync(sourcePath)
        } catch (error) {
          if (linked) cleanCreated(base, [{ path: dest, stat: linked, parent, directory: false }])
          throw error
        }
      } else if (process.platform === 'win32') {
        for (const entry of entries) checkEntry(base, entry)
        renameSync(sourcePath, dest)
      } else {
        // shortcut: đích có thể bị tráo sau kiểm inode, nâng cấp khi Node hỗ trợ rename không ghi đè.
        mkdirSync(dest)
        const reservation = lstatSync(dest, { bigint: true })
        try {
          for (const entry of entries) checkEntry(base, entry)
          const current = present(dest)
          if (!current || !sameInode(current, reservation)) throw conflict(to)
          safePath(base, to)
          renameSync(sourcePath, dest)
        } catch (error) {
          cleanCreated(base, [{ path: dest, stat: reservation, parent, directory: true }])
          throw error
        }
      }
    }),
    copy: (pid: string, from: string, destination: string): Promise<string> => perform('sao chép', async () => {
      const base = await root(pid)
      const sourcePath = safePath(base, from)
      const destPath = safePath(base, destination, true)
      const source = item(base, from)
      directory(base, destination)
      if (source.stat.isDirectory() && insideDirectory(sourcePath, destPath)) throw new FsError('bad_param', 'Không thể sao chép thư mục vào chính nó')
      const entries = tree(base, source, true)
      const sameDir = dirname(sourcePath) === destPath
      const name = basename(sourcePath)
      const extension = source.stat.isFile() ? extname(name) : ''
      const stem = name.slice(0, name.length - extension.length)
      for (let index = 0;; index++) {
        const copyName = sameDir ? `${stem} copy${index ? ` ${index}` : ''}${extension}` : name
        const candidate = join(destPath, copyName)
        if (present(candidate)) {
          if (sameDir) continue
          throw conflict(relative(base, candidate))
        }
        for (const entry of entries) {
          const copiedPath = relative(base, join(candidate, relative(sourcePath, entry.path)))
          if (isProtectedRel(copiedPath)) throw new FsError('protected_path', `Tệp hoặc thư mục được bảo vệ: ${copiedPath}`)
        }
        const target = safePath(base, relative(base, candidate))
        try {
          copyEntries(base, entries, target)
          return relative(base, target).split(sep).join('/')
        } catch (error) {
          if (sameDir && (error as NodeJS.ErrnoException).code === 'EEXIST') continue
          throw error
        }
      }
    }),
    trash: (pid: string, path: string): Promise<void> => perform('chuyển vào thùng rác', async () => {
      const base = await root(pid)
      const entry = item(base, path)
      const entries = tree(base, entry)
      for (const member of entries) checkEntry(base, member)
      await shell.trashItem(entry.path)
    }),
    reveal: (pid: string, path: string): Promise<void> => perform('hiện trong trình quản lý tệp', async () => {
      const base = await root(pid)
      const entry = item(base, path, true)
      checkEntry(base, entry)
      shell.showItemInFolder(entry.path)
    })
  }
}
