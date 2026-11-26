import { existsSync } from 'node:fs'
import { cp, lstat, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { ExtensionCommand, ExtensionInfo, ExtensionTheme } from '../../../shared/api'
import { UserError } from '../../platform/user-error'

/** Biến màu một theme extension được đặt: đúng bộ biến mà theme dựng sẵn khai báo trong styles.css. */
export const THEME_VARS = ['--color-bg', '--color-surface', '--panel', '--panel-raised', '--chrome', '--track', '--color-text', '--color-muted', '--color-border',
  '--blue', '--violet', '--teal', '--magenta', '--green', '--amber', '--orange', '--color-error-red', '--night', '--night-2', '--on-night',
  '--syntax-keyword', '--syntax-string', '--syntax-comment', '--syntax-number', '--syntax-type', '--syntax-function', '--syntax-variable', '--syntax-constant',
  '--syntax-tag', '--syntax-attribute', '--syntax-property', '--syntax-punctuation', '--syntax-emphasis', '--syntax-emphasis-strong'] as const
const REQUIRED_VARS = ['--color-bg', '--color-surface', '--color-text', '--color-muted', '--color-border']
const ID = /^[a-z0-9][a-z0-9-]{1,40}$/
const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const MANIFEST = 'extension.json'
const MAX_MANIFEST = 256 * 1024

const bad = (message: string) => new UserError('bad_extension', message)
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, field: string, max: number): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw bad(`Trường "${field}" phải là chuỗi khác rỗng, tối đa ${max} ký tự`)
  return v.trim()
}

function parseTheme(extId: string, raw: unknown): ExtensionTheme {
  if (!isObject(raw)) throw bad('Mỗi theme phải là một object')
  const id = text(raw.id, 'themes[].id', 40)
  if (!ID.test(id)) throw bad(`Mã theme "${id}" chỉ gồm chữ thường, số, gạch nối`)
  if (raw.appearance !== 'light' && raw.appearance !== 'dark') throw bad('appearance phải là "light" hoặc "dark"')
  if (!isObject(raw.colors)) throw bad('Theme cần "colors"')
  const colors: Record<string, string> = {}
  for (const [name, value] of Object.entries(raw.colors)) {
    // Danh sách biến cố định và giá trị chỉ là mã màu hex: không chèn được CSS tuỳ ý vào app.
    if (!(THEME_VARS as readonly string[]).includes(name)) throw bad(`Biến màu "${name}" không được hỗ trợ`)
    if (typeof value !== 'string' || !COLOR.test(value)) throw bad(`Màu của "${name}" phải là mã hex như #1e1e2e`)
    colors[name] = value
  }
  for (const name of REQUIRED_VARS) if (!colors[name]) throw bad(`Theme "${id}" thiếu màu "${name}"`)
  return { id: `ext-${extId}-${id}`, name: text(raw.name, 'themes[].name', 60), appearance: raw.appearance, colors }
}

function parseCommand(extId: string, raw: unknown): ExtensionCommand {
  if (!isObject(raw)) throw bad('Mỗi lệnh phải là một object')
  const id = text(raw.id, 'commands[].id', 40)
  if (!ID.test(id)) throw bad(`Mã lệnh "${id}" chỉ gồm chữ thường, số, gạch nối`)
  const action = raw.action
  if (!isObject(action)) throw bad('Lệnh cần "action"')
  const base = { id: `ext.${extId}.${id}`, title: text(raw.title, 'commands[].title', 80) }
  // Lệnh khai báo, không chạy mã của extension: chèn văn bản vào editor, hoặc chạy chuỗi lệnh có sẵn của app.
  if (action.type === 'insertText') {
    // Giữ nguyên văn (kể cả xuống dòng ở cuối), chỉ kiểm độ dài.
    if (typeof action.text !== 'string' || !action.text || action.text.length > 10_000) throw bad('action.text phải là chuỗi khác rỗng, tối đa 10000 ký tự')
    return { ...base, action: { type: 'insertText', text: action.text } }
  }
  if (action.type === 'runCommands') {
    if (!Array.isArray(action.commands) || !action.commands.length || action.commands.length > 10 || action.commands.some((c) => typeof c !== 'string' || c.startsWith('ext.'))) {
      throw bad('runCommands cần 1–10 mã lệnh có sẵn của app')
    }
    return { ...base, action: { type: 'runCommands', commands: action.commands as string[] } }
  }
  throw bad('action.type phải là "insertText" hoặc "runCommands"')
}

/** Đọc và kiểm tra `extension.json` của một thư mục. */
export async function readExtension(dir: string): Promise<ExtensionInfo> {
  const file = join(dir, MANIFEST)
  const info = await stat(file).catch(() => null)
  if (!info?.isFile()) throw bad(`Thư mục không có ${MANIFEST}`)
  if (info.size > MAX_MANIFEST) throw bad(`${MANIFEST} quá lớn`)
  let raw: unknown
  try { raw = JSON.parse(await readFile(file, 'utf8')) } catch { throw bad(`${MANIFEST} không phải JSON hợp lệ`) }
  if (!isObject(raw)) throw bad(`${MANIFEST} phải là một object`)
  const id = text(raw.id, 'id', 40)
  if (!ID.test(id)) throw bad(`Mã extension "${id}" chỉ gồm chữ thường, số, gạch nối`)
  const contributes = isObject(raw.contributes) ? raw.contributes : {}
  const themes = Array.isArray(contributes.themes) ? contributes.themes.slice(0, 20).map((t) => parseTheme(id, t)) : []
  const commands = Array.isArray(contributes.commands) ? contributes.commands.slice(0, 50).map((c) => parseCommand(id, c)) : []
  if (!themes.length && !commands.length) throw bad('Extension cần ít nhất một theme hoặc một lệnh trong "contributes"')
  return {
    id, name: text(raw.name, 'name', 60), version: typeof raw.version === 'string' ? raw.version.slice(0, 20) : '0.0.0',
    description: typeof raw.description === 'string' ? raw.description.slice(0, 300) : '', themes, commands
  }
}

/** Extension cài ở `<thư mục dữ liệu>/extensions/<id>/`, mỗi thư mục một extension (như thư mục extensions của Wu). */
export class ExtensionRegistry {
  constructor(private readonly root: string) {}

  async list(): Promise<{ extensions: ExtensionInfo[]; errors: { folder: string; message: string }[] }> {
    const extensions: ExtensionInfo[] = []
    const errors: { folder: string; message: string }[] = []
    if (!existsSync(this.root)) return { extensions, errors }
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      try {
        extensions.push(await readExtension(join(this.root, entry.name)))
      } catch (e) {
        errors.push({ folder: entry.name, message: e instanceof Error ? e.message : String(e) })
      }
    }
    return { extensions: extensions.sort((a, b) => a.name.localeCompare(b.name)), errors }
  }

  /** Chép thư mục extension vào thư mục cài (thay bản cũ cùng id). */
  async install(source: string): Promise<ExtensionInfo> {
    const info = await readExtension(source)
    const target = join(this.root, info.id)
    if (resolve(source) === resolve(target)) return info
    await mkdir(this.root, { recursive: true })
    await rm(target, { recursive: true, force: true })
    // Chỉ chép tệp thường và thư mục; bỏ symlink để không kéo tệp ngoài thư mục extension vào.
    await cp(source, target, { recursive: true, filter: async (src) => !(await lstat(src)).isSymbolicLink() && !src.split(sep).includes('node_modules') })
    return info
  }

  async remove(id: string): Promise<void> {
    if (!ID.test(id)) throw bad('Mã extension không hợp lệ')
    await rm(join(this.root, id), { recursive: true, force: true })
  }
}
