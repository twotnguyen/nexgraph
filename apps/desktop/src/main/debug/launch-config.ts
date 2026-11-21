import { realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { DebugConfigInfo } from '../../shared/api'
import { FsError, readProjectFile, resolveInside, writeProjectFile } from '../fs/project-fs'
import { parseJsonc } from '../tasks'
import { UserError } from '../user-error'
import type { DebugKind } from './adapters'

/**
 * Cấu hình gỡ lỗi nằm trong dự án như ở Wu (`debug.json` của Zed và `.vscode/launch.json`): đọc (JSONC), liệt kê,
 * thay biến rồi đổi thành tham số `launch`/`attach` gửi cho adapter. Chỉ nhận Node (js-debug) và Python (debugpy).
 */

/** Đọc theo thứ tự này; tệp đầu cũng là tệp được tạo mẫu khi dự án chưa có tệp nào. */
export const CONFIG_FILES = ['.vscode/launch.json', '.zed/debug.json'] as const

/** Tham số gửi nguyên cho `launch`/`attach` của adapter; manager chỉ thêm phần phụ thuộc máy (đường dẫn python). Attach kèm nơi tiến trình đích nghe. */
export type DebugSpec =
  | { kind: DebugKind; request: 'launch'; args: Record<string, unknown> }
  | { kind: DebugKind; request: 'attach'; args: Record<string, unknown>; host: string; port: number }
export type DebugConfig = DebugConfigInfo & { raw: Record<string, unknown> }

const bad = (message: string) => new UserError('bad_debug_config', message)
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export function launchSpec(kind: DebugKind, o: { program: string; cwd: string; args?: string[]; env?: Record<string, string>; stopOnEntry?: boolean }): DebugSpec {
  return {
    kind,
    request: 'launch',
    args: {
      type: kind === 'node' ? 'pwa-node' : 'python', request: 'launch', program: o.program, cwd: o.cwd, console: 'internalConsole',
      ...(kind === 'node' ? { outputCapture: 'std' } : { justMyCode: true }),
      ...(o.args?.length ? { args: o.args } : {}),
      ...(o.env ? { env: o.env } : {}),
      ...(o.stopOnEntry ? { stopOnEntry: true } : {})
    }
  }
}

/** Node: js-debug nối vào cổng inspector. Python: nối TCP thẳng vào adapter mà `debugpy.listen` của tiến trình đích đã tự chạy. */
export function attachSpec(kind: DebugKind, host: unknown, port: unknown): DebugSpec {
  if (typeof host !== 'string' || !/^[\w.:-]{1,253}$/.test(host) || typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw bad('Địa chỉ hoặc cổng attach không hợp lệ')
  }
  return {
    kind,
    request: 'attach',
    host,
    port,
    args: kind === 'node'
      ? { type: 'pwa-node', request: 'attach', address: host, port }
      : { type: 'python', request: 'attach', connect: { host, port }, justMyCode: true }
  }
}

const VARIABLE = /\$\{env:([^}]*)\}|\$\{(workspaceFolder|file|fileDirname|ZED_WORKTREE_ROOT|ZED_FILE|ZED_DIRNAME)\}|\$(ZED_WORKTREE_ROOT|ZED_FILE|ZED_DIRNAME)(?!\w)/g

/** Thay `${workspaceFolder}`, `${file}`, `${fileDirname}`, `${env:TÊN}` và các biến `$ZED_*` tương đương của debug.json (Zed/Wu); biến lạ giữ nguyên. */
function expander(root: string, file?: string): (text: string) => string {
  const dir = file === undefined ? undefined : dirname(file)
  const values: Record<string, string | undefined> = { workspaceFolder: root, ZED_WORKTREE_ROOT: root, file, ZED_FILE: file, fileDirname: dir, ZED_DIRNAME: dir }
  return (text) => text.replace(VARIABLE, (match, env?: string, braced?: string, bare?: string) => {
    if (env !== undefined) return process.env[env] ?? ''
    const value = values[(braced ?? bare)!]
    if (value === undefined) throw bad(`${match} cần một tệp đang mở, nhưng chưa có tệp .js/.py nào được chọn`)
    return value
  })
}

/**
 * Đổi một cấu hình đã đọc thành tham số adapter. `root` là đường dẫn thật của dự án, `file` là đường dẫn tuyệt đối của tệp đang mở.
 * Chỉ lấy các trường adapter có sẵn xử lý được (launch: program, args, cwd, env, stopOnEntry; attach: host/port).
 */
export function toSpec(config: DebugConfig, root: string, file?: string): DebugSpec {
  const { raw, kind, request, name } = config
  const expand = expander(root, file)
  const text = (value: unknown): string | undefined => (typeof value === 'string' ? expand(value) : undefined)
  if (request === 'attach') {
    // Python: `connect: { host, port }` hoặc host/port ở cấp ngoài; Node: `address`/`port`. Mặc định như Wu: Node localhost:9229, Python 127.0.0.1:5678.
    const target = record(raw.connect) ? raw.connect : raw
    const port = Number(expand(String(target.port ?? (kind === 'node' ? 9229 : 5678))))
    return attachSpec(kind, text(target.host ?? target.address) ?? (kind === 'node' ? 'localhost' : '127.0.0.1'), port)
  }
  const program = text(raw.program)
  if (!program) throw bad(`Cấu hình "${name}" thiếu "program"`)
  const { args } = raw
  if (args !== undefined && !(Array.isArray(args) && args.every((arg) => typeof arg === 'string'))) throw bad(`Cấu hình "${name}": "args" phải là mảng chuỗi`)
  const env = record(raw.env)
    ? Object.fromEntries(Object.entries(raw.env).flatMap(([key, value]) => (typeof value === 'string' ? [[key, expand(value)]] : [])))
    : undefined
  return launchSpec(kind, {
    program,
    cwd: resolve(root, text(raw.cwd) ?? ''),
    args: Array.isArray(args) ? args.map((arg: string) => expand(arg)) : undefined,
    env,
    stopOnEntry: raw.stopOnEntry === true
  })
}

const KINDS: Record<string, DebugKind> = { node: 'node', 'pwa-node': 'node', javascript: 'node', python: 'python', debugpy: 'python' }

/** `.vscode/launch.json` là object có `configurations`, `.zed/debug.json` là mảng; mục thiếu tên, loại chưa hỗ trợ, attach theo PID hoặc `listen` bị bỏ qua. */
export function parseConfigs(source: string, text: string): DebugConfig[] {
  let data: unknown
  try { data = parseJsonc(text) } catch { throw new UserError('invalid_debug_config', `Tệp ${source} không phải JSON hợp lệ.`) }
  const list = Array.isArray(data) ? data : record(data) ? data.configurations ?? [] : undefined
  if (!Array.isArray(list)) throw new UserError('invalid_debug_config', `Tệp ${source} không có danh sách cấu hình.`)
  return list.flatMap((item): DebugConfig[] => {
    if (!record(item)) return []
    const type = String(item.type ?? item.adapter).toLowerCase()
    const kind = Object.hasOwn(KINDS, type) ? KINDS[type] : undefined
    const name = item.name ?? item.label
    const { request } = item
    if (!kind || typeof name !== 'string' || (request !== 'launch' && request !== 'attach') || item.processId !== undefined || item.listen !== undefined) return []
    return [{ name, source, kind, request, raw: item }]
  })
}

async function readConfig(root: string, source: string): Promise<string | null> {
  try {
    const file = await readProjectFile(root, source)
    if (file.reason) throw new UserError('invalid_debug_config', `Không đọc được tệp ${source} (${file.reason === 'too_large' ? 'quá lớn' : 'không phải văn bản'}).`)
    return file.text
  } catch (error) {
    if (error instanceof FsError && error.code === 'file_not_found') return null
    throw error
  }
}

export async function loadConfigs(root: string): Promise<DebugConfig[]> {
  const configs: DebugConfig[] = []
  for (const source of CONFIG_FILES) {
    const text = await readConfig(root, source)
    if (text !== null) configs.push(...parseConfigs(source, text))
  }
  return configs
}

export async function listConfigs(root: string): Promise<DebugConfigInfo[]> {
  return (await loadConfigs(root)).map(({ name, source, kind, request }) => ({ name, source, kind, request }))
}

/** Cấu hình được chọn theo (tệp, tên) rồi đổi thành tham số adapter; `file` tương đối dự án (thay `${file}`). */
export async function resolveConfig(projectRoot: string, source: string, name: string, file?: string): Promise<DebugSpec> {
  // Đường dẫn thật (macOS: /var → /private/var) để khớp đường dẫn adapter trả về và đường dẫn điểm dừng.
  const root = realpathSync.native(projectRoot)
  const config = (await loadConfigs(root)).find((item) => item.source === source && item.name === name)
  if (!config) throw new UserError('no_debug_config', `Không tìm thấy cấu hình "${name}" trong ${source}`)
  return toSpec(config, root, file === undefined ? undefined : resolveInside(root, file))
}

const SAMPLE = '// Cấu hình gỡ lỗi (cú pháp VS Code, cho phép chú thích). Biến: ${workspaceFolder}, ${file}, ${fileDirname}, ${env:TÊN}.\n' + JSON.stringify({
  version: '0.2.0',
  configurations: [
    { name: 'Python: chạy tệp đang mở', type: 'debugpy', request: 'launch', program: '${file}', cwd: '${workspaceFolder}' },
    { name: 'Node.js: chạy tệp đang mở', type: 'node', request: 'launch', program: '${file}', cwd: '${workspaceFolder}' },
    { name: 'Python: attach (debugpy.listen, cổng 5678)', type: 'debugpy', request: 'attach', connect: { host: '127.0.0.1', port: 5678 } },
    { name: 'Node.js: attach (node --inspect, cổng 9229)', type: 'node', request: 'attach', address: 'localhost', port: 9229 }
  ]
}, null, 2) + '\n'

/** Tệp cấu hình để mở trong editor: tệp đã có, hoặc `.vscode/launch.json` mẫu vừa tạo. */
export async function ensureConfigFile(root: string): Promise<string> {
  for (const source of CONFIG_FILES) if (await readConfig(root, source) !== null) return source
  await writeProjectFile(root, CONFIG_FILES[0], SAMPLE, { eol: '\n', bom: false, expectedVersion: null })
  return CONFIG_FILES[0]
}
