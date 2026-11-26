import { lstatSync, realpathSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import ignore, { type Ignore } from 'ignore'
import { readProjectFileBytes, resolveInside } from '../../platform/project-fs'
import { toProjectRelative } from './approval'

const DEFAULT_SKIP_DIRS = new Set(['build', '.dart_tool', 'node_modules'])
const MAX_ENTRIES = 20_000
const MAX_IGNORE_BYTES = 1024 * 1024
const posix = (path: string) => path.split(sep).join('/')
const blocked = () => new Error('Đường dẫn không khả dụng theo phạm vi truy cập của AI')

export type ScopedEntry = {
  absolute: string
  relative: string
  directory: boolean
}

/** Phạm vi cho một lần gọi tool. Luật bỏ qua của dự án và từng thư mục không được đưa vào kết quả. */
export class AgentFileScope {
  private readonly root: string
  private readonly inputRoot: string
  private readonly exclude: Ignore
  private readonly gitignore = new Map<string, Ignore | undefined>()

  constructor(root: string, exclude: string[]) {
    this.inputRoot = root
    this.root = realpathSync.native(root)
    this.exclude = ignore({ ignorecase: false }).add(exclude)
  }

  private rules(directory: string): Ignore | undefined {
    if (!this.gitignore.has(directory)) {
      let rules
      const path = join(directory, '.gitignore')
      // Git không áp dụng .gitignore qua symlink.
      try {
        if (lstatSync(join(this.root, path)).isFile()) {
          const bytes = readProjectFileBytes(this.root, path, MAX_IGNORE_BYTES)
          const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
          rules = ignore({ ignorecase: false }).add(text)
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw blocked()
      }
      this.gitignore.set(directory, rules)
    }
    return this.gitignore.get(directory)
  }

  private ignored(path: string, directory: boolean): boolean {
    if (!path) return false
    const parts = path.split('/')
    const dirParts = directory ? parts : parts.slice(0, -1)
    if (dirParts.some((part) => DEFAULT_SKIP_DIRS.has(part.toLowerCase()))) return true
    const marker = directory ? '/' : ''
    // Một thư mục bị bỏ qua ở cấp cha không thể được mở lại bởi luật của chính thư mục đó.
    if (this.exclude.ignores(path + marker)) return true
    for (let depth = 0; depth < parts.length; depth++) {
      const rules = this.rules(parts.slice(0, depth).join('/'))
      if (rules?.ignores(parts.slice(depth).join('/') + marker)) return true
    }
    return false
  }

  entry(path: string): ScopedEntry {
    try {
      const lex = toProjectRelative(this.inputRoot, path)
      const absolute = resolveInside(this.root, lex)
      const stat = lstatSync(absolute)
      if (!stat.isFile() && !stat.isDirectory()) throw blocked()
      const display = posix(relative(this.root, resolve(this.root, lex)))
      const canonical = posix(relative(this.root, absolute))
      if (this.ignored(display, stat.isDirectory()) ||
          (display !== canonical && this.ignored(canonical, stat.isDirectory()))) throw blocked()
      return { absolute, relative: display, directory: stat.isDirectory() }
    } catch {
      throw blocked()
    }
  }

  bytes(entry: ScopedEntry): Buffer {
    const path = entry.relative
    if (this.entry(path).absolute !== entry.absolute) throw blocked()
    const bytes = readProjectFileBytes(this.root, relative(this.root, entry.absolute))
    if (this.entry(path).absolute !== entry.absolute) throw blocked()
    return bytes
  }

  async *entries(start: ScopedEntry, recursive: boolean, state: { limited: boolean }, signal?: AbortSignal): AsyncGenerator<ScopedEntry> {
    const queue = [start]
    let inspected = 0
    while (queue.length) {
      signal?.throwIfAborted()
      const directory = queue.pop()!
      let names
      try {
        if (this.entry(directory.relative).absolute !== directory.absolute) continue
        names = await readdir(directory.absolute, { withFileTypes: true })
        if (this.entry(directory.relative).absolute !== directory.absolute) continue
      } catch {
        continue
      }
      names.sort((a, b) => a.name.localeCompare(b.name))
      for (const name of names) {
        if (++inspected > MAX_ENTRIES) {
          state.limited = true
          return
        }
        if (inspected % 64 === 0) {
          signal?.throwIfAborted()
          await setImmediate()
        }
        // POSIX cho phép dấu \ trong tên; tên đó không biểu diễn nhất quán trong giao thức đường dẫn.
        if (name.name.includes('\\')) continue
        let entry: ScopedEntry
        try {
          entry = this.entry(join(directory.relative, name.name))
        } catch {
          continue
        }
        yield entry
        // Không đệ quy qua alias thư mục, tránh vòng lặp và giữ đường dẫn tìm kiếm nhất quán.
        if (recursive && name.isDirectory() && entry.directory && entry.absolute === join(directory.absolute, name.name)) {
          queue.push(entry)
        }
      }
    }
  }
}
