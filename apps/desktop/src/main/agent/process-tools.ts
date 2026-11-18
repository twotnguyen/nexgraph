import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, statSync } from 'node:fs'
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { ApprovalGate, CommandPreview } from './approval'
import type { FileContent } from '../../shared/api'
import { readProjectFile, readProjectFileBytes, resolveInside } from '../fs/project-fs'
import { CheckpointStore } from './checkpoints'
import { AgentFileScope } from './file-scope'

export type ProcessInput = { executable: string; args: string[]; cwd?: string; timeoutMs?: number }
export type ProcessResult = {
  executable: string
  args: string[]
  cwd: string
  exitCode: number | null
  output: string
  truncated: boolean
  timedOut: boolean
  cancelled: boolean
  durationMs: number
  checkpointPaths?: string[]
  checkpointWarnings?: string[]
}
export type CommandSuggestion = CommandPreview & { id: string; label: string }
export type ProjectCommands = { commands: CommandSuggestion[]; packageManager?: string; warnings: string[] }

const OUTPUT_LIMIT = 64 * 1024
const MAX_COMMANDS = 12
const DEFAULT_TIMEOUT = 120_000
const MAX_TIMEOUT = 5 * 60_000
const SNAPSHOT_LIMIT = 32 * 1024 * 1024
const GENERATED_PATHS = ['.venv/', 'venv/', 'dist/', '.next/', '.cache/', '.turbo/', '__pycache__/',
  '**/*.g.dart', '**/*.freezed.dart', '**/*.mocks.dart']
const ENV_KEYS = new Set(['path', 'pathext', 'systemroot', 'windir', 'comspec', 'temp', 'tmp', 'home', 'userprofile',
  'appdata', 'localappdata', 'lang', 'lc_all', 'term', 'number_of_processors', 'processor_architecture', 'programfiles',
  'programfiles(x86)', 'programdata'])
const NETWORK_EXECUTABLES = new Set(['curl', 'wget', 'ssh', 'scp', 'sftp', 'ftp', 'npx', 'pip', 'pip3'])
const PACKAGE_EXECUTABLES = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const LOCAL_PACKAGE_ACTIONS = new Set(['run', 'test', 'build', 'lint', 'check', 'typecheck', 'exec'])

function readJson(root: string, path: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(readProjectFileBytes(root, path, 1024 * 1024).toString('utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch { return null }
}

/** Chỉ đọc cấu hình để gợi ý lệnh, không chạy mã của dự án. */
export function detectProjectCommands(root: string): ProjectCommands {
  const commands: CommandSuggestion[] = []
  const warnings: string[] = []
  const pkg = readJson(root, 'package.json')
  const locks = [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lock', 'bun'], ['bun.lockb', 'bun'], ['package-lock.json', 'npm']]
  const packageManager = locks.find(([file]) => existsSync(join(root, file)))?.[1]
    ?? (typeof pkg?.packageManager === 'string' ? pkg.packageManager.split('@')[0] : pkg ? 'npm' : undefined)
  if (pkg) {
    const scripts = pkg.scripts
    if (scripts && typeof scripts === 'object' && !Array.isArray(scripts)) {
      for (const [name, command] of Object.entries(scripts)) {
        if (typeof command !== 'string' || !/^(test(?::[\w.-]+)?|typecheck|check|lint|build)$/.test(name)) continue
        commands.push({ id: 'script:' + name, label: name, executable: packageManager ?? 'npm', args: ['run', name], cwd: '.', timeoutMs: DEFAULT_TIMEOUT })
      }
    }
  }
  const pyproject = existsSync(join(root, 'pyproject.toml'))
  if (pyproject || existsSync(join(root, 'pytest.ini')) || existsSync(join(root, 'tests', 'conftest.py'))) {
    const uv = existsSync(join(root, 'uv.lock'))
    commands.push({
      id: 'python:pytest', label: 'pytest', executable: uv ? 'uv' : 'python',
      args: uv ? ['run', '--offline', '--locked', 'python', '-m', 'pytest', '-q'] : ['-m', 'pytest', '-q'],
      cwd: '.', timeoutMs: DEFAULT_TIMEOUT
    })
  }
  if (!commands.length) warnings.push('Chưa phát hiện script test, lint, typecheck hoặc build ở gốc dự án.')
  return { commands, ...(packageManager ? { packageManager } : {}), warnings }
}

function normalizedCommand(root: string, input: ProcessInput): CommandPreview {
  if (!input || typeof input.executable !== 'string' || !input.executable.trim() ||
      !Array.isArray(input.args) || input.args.some((arg) => typeof arg !== 'string' || arg.includes('\0')) ||
      input.args.length > 128 || input.executable.includes('\0')) throw new Error('Lệnh phải có executable và mảng args hợp lệ')
  const cwd = input.cwd ?? '.'
  if (typeof cwd !== 'string' || isAbsolute(cwd)) throw new Error('cwd phải tương đối với dự án')
  const directory = resolveInside(root, cwd)
  if (!statSync(directory).isDirectory()) throw new Error('cwd phải là thư mục')
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_TIMEOUT) throw new Error('Thời gian chạy phải từ 100 ms đến 300000 ms')
  if (input.executable.length + input.args.join('').length > 32_000) throw new Error('Lệnh quá dài')
  const executable = input.executable.trim()
  const name = basename(executable).replace(/\.(exe|cmd|bat)$/i, '').toLowerCase()
  if (NETWORK_EXECUTABLES.has(name)) throw new Error('Lệnh tải hoặc gửi dữ liệu ra ngoài chưa được cấp quyền')
  if (name === 'git' && !['status', 'diff', 'log', 'show', 'ls-files', 'rev-parse', 'check-ignore'].includes(input.args[0] ?? '')) {
    throw new Error('Tác vụ chỉ được dùng Git để đọc, không push hoặc thay đổi lịch sử')
  }
  if (PACKAGE_EXECUTABLES.has(name) && !LOCAL_PACKAGE_ACTIONS.has(input.args[0] ?? '')) {
    throw new Error('Chỉ chạy script và công cụ đã có trong dự án, cài đặt hoặc phát hành cần thao tác riêng')
  }
  if ((name === 'pnpm' || name === 'npm') && input.args[0] === 'exec') {
    // npm exec có thể tự tải gói. pnpm exec chỉ chạy dependency đã cài.
    if (name === 'npm') throw new Error('Dùng script package.json hoặc binary đã cài, npm exec có thể tải gói')
  }
  if (name === 'uv' && (input.args[0] !== 'run' || !input.args.includes('--offline'))) {
    throw new Error('uv chỉ chạy với run --offline để dùng môi trường đã cài')
  }
  return { executable, args: [...input.args], cwd, timeoutMs: Math.round(timeoutMs) }
}

/** Môi trường tiến trình chỉ chứa biến hệ thống cần thiết, không kế thừa credential/provider của NexGraph. */
function processEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (ENV_KEYS.has(key.toLowerCase()) && value !== undefined) env[key] = value
  }
  return { ...env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0', PYTHONUTF8: '1', ELECTRON_RUN_AS_NODE: '1' }
}

/** Windows .cmd được chạy bằng JS entry của package manager, không đi qua cmd.exe. */
function resolveExecutable(executable: string): { executable: string; prefix: string[] } {
  const name = basename(executable).replace(/\.(exe|cmd|bat)$/i, '').toLowerCase()
  if (name === 'node') return { executable: process.execPath, prefix: [] }
  if (process.platform !== 'win32') return { executable, prefix: [] }
  const paths = isAbsolute(executable) || /[\\/]/.test(executable)
    ? [resolve(executable)] : (process.env.Path ?? process.env.PATH ?? '').split(delimiter).map((p) => join(p, executable))
  for (const path of paths) {
    const native = [path, path + '.exe'].find((file) => existsSync(file) && !/\.(cmd|bat)$/i.test(file))
    if (native) return { executable: native, prefix: [] }
    const batch = /\.(cmd|bat)$/i.test(path) ? path : path + '.cmd'
    if (!existsSync(batch)) continue
    const base = dirname(batch)
    const entry = name === 'pnpm' ? [join(base, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'), join(base, 'node_modules', 'corepack', 'dist', 'pnpm.js')]
      : name === 'npm' ? [join(base, 'node_modules', 'npm', 'bin', 'npm-cli.js')]
      : name === 'yarn' ? [join(base, 'node_modules', 'yarn', 'bin', 'yarn.js'), join(base, 'node_modules', 'corepack', 'dist', 'yarn.js')] : []
    const cli = entry.find((file) => existsSync(file))
    if (cli) return { executable: process.execPath, prefix: [cli] }
  }
  if (/\.(cmd|bat)$/i.test(executable)) throw new Error('Không tìm thấy JS entry cho lệnh Windows. Chọn executable hoặc script đã cài.')
  return { executable, prefix: [] }
}

function killTree(child: ChildProcess): Promise<void> {
  const pid = child.pid
  if (!pid) return Promise.resolve()
  if (process.platform !== 'win32') {
    try { process.kill(-pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch { /* tiến trình đã thoát */ } }
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const killer = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(pid), '/T', '/F'], {
      shell: false, windowsHide: true, stdio: 'ignore', env: processEnvironment()
    })
    const fallback = () => { try { child.kill('SIGKILL') } catch { /* tiến trình đã thoát */ } resolve() }
    killer.once('error', fallback)
    killer.once('close', (code) => code === 0 ? resolve() : fallback())
  })
}

export type TaskExecutionOptions = {
  root: string
  taskId: string
  storageDir: string
  policy: 'review' | 'auto'
  allowCommands: boolean
  signal: AbortSignal
  assertCurrent(): void
  gate: ApprovalGate
  assertEditable?(path: string): void
  sourceExcludes?(): Promise<string[]>
  onOutput?(event: { id: string; stream: 'stdout' | 'stderr'; delta: string }): void
}

/** Quyền chỉ do session tạo sau thao tác của người dùng, không có tool để tự cấp quyền. */
export class TaskExecution {
  readonly checkpoints: CheckpointStore
  readonly taskId: string
  readonly policy: 'review' | 'auto'
  readonly allowCommands: boolean
  readonly signal: AbortSignal
  private commands = 0
  private running = false

  constructor(private readonly options: TaskExecutionOptions) {
    this.taskId = options.taskId
    this.policy = options.policy
    this.allowCommands = options.allowCommands
    this.signal = options.signal
    this.checkpoints = new CheckpointStore(options.root, options.storageDir, options.taskId, options.assertEditable)
  }

  async run(input: ProcessInput, commandId: string = randomUUID()): Promise<ProcessResult> {
    this.options.assertCurrent()
    this.signal.throwIfAborted()
    if (!this.allowCommands || !this.options.gate.checkCommand) throw new Error('Chưa cho phép chạy mã của dự án')
    if (this.running) throw new Error('Đang có một lệnh chạy trong tác vụ')
    if (this.commands >= MAX_COMMANDS) throw new Error('Đã đạt giới hạn 12 lệnh cho tác vụ')
    const command = normalizedCommand(this.options.root, input)
    this.running = true
    try {
      const decision = await this.options.gate.checkCommand(command)
      this.options.assertCurrent()
      this.signal.throwIfAborted()
      if (!decision.allow) throw new Error(decision.reason)
      const rules = [...GENERATED_PATHS, ...await (this.options.sourceExcludes?.() ?? Promise.resolve([]))]
      const scope = new AgentFileScope(this.options.root, rules)
      const before = await this.capture(scope, this.signal)
      this.options.assertCurrent()
      this.signal.throwIfAborted()
      await this.checkpoints.beginCommand(before.files, before.existingPaths)
      this.commands++
      let result: ProcessResult
      try {
        result = await this.spawn(command, commandId)
      } catch (error) {
        const after = await this.capture(scope)
        await this.checkpoints.finishCommand(after.files, after.existingPaths)
        throw error
      }
      const after = await this.capture(scope)
      result.checkpointPaths = await this.checkpoints.finishCommand(after.files, after.existingPaths)
      result.checkpointWarnings = [
        'Hoàn tác chỉ bao gồm tệp văn bản trong phạm vi AI. Bỏ qua tệp sinh, bị loại trừ, bí mật, liên kết, nhị phân và tệp trên 5 MiB.',
        ...(before.excluded || after.excluded ? [`Bỏ qua ${Math.max(before.excluded, after.excluded)} tệp không đọc được như văn bản.`] : [])
      ]
      return result
    } finally { this.running = false }
  }

  private async capture(scope: AgentFileScope, signal?: AbortSignal): Promise<{ files: Map<string, FileContent>; excluded: number; existingPaths: Set<string> }> {
    const state = { limited: false }
    const files = new Map<string, FileContent>()
    const existingPaths = new Set<string>()
    let total = 0
    let excluded = 0
    for await (const entry of scope.entries(scope.entry('.'), true, state, signal)) {
      if (entry.directory) continue
      existingPaths.add(entry.relative)
      if (lstatSync(join(this.options.root, entry.relative)).isSymbolicLink()) { excluded++; continue }
      let content: FileContent
      try {
        content = await readProjectFile(this.options.root, entry.relative)
      } catch { excluded++; continue }
      if (content.readOnly) { excluded++; continue }
      this.options.assertEditable?.(entry.relative)
      total += Buffer.byteLength(content.text)
      if (total > SNAPSHOT_LIMIT) throw new Error('Phạm vi checkpoint vượt 32 MiB. Chọn dự án hoặc phạm vi nhỏ hơn trước khi chạy lệnh.')
      files.set(entry.relative, content)
    }
    if (state.limited) throw new Error('Phạm vi checkpoint vượt 20000 mục. Chọn dự án hoặc phạm vi nhỏ hơn trước khi chạy lệnh.')
    return { files, excluded, existingPaths }
  }

  private spawn(command: CommandPreview, commandId: string): Promise<ProcessResult> {
    const resolved = resolveExecutable(command.executable)
    const start = Date.now()
    return new Promise((resolve, reject) => {
      const child = spawn(resolved.executable, [...resolved.prefix, ...command.args], {
        cwd: resolveInside(this.options.root, command.cwd), shell: false, detached: process.platform !== 'win32',
        env: processEnvironment(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
      })
      let output = ''
      let bytes = 0
      let truncated = false
      let timedOut = false
      let cancelled = false
      let killing: Promise<void> | undefined
      const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') }
      const stop = () => { killing ??= killTree(child) }
      const abort = () => { cancelled = true; stop() }
      const timer = setTimeout(() => { timedOut = true; stop() }, command.timeoutMs)
      const emit = (stream: 'stdout' | 'stderr', text: string) => {
        const available = OUTPUT_LIMIT - Buffer.byteLength(output)
        const encoded = Buffer.from(text)
        let delta = encoded.length <= available ? text : encoded.subarray(0, available).toString('utf8')
        while (Buffer.byteLength(delta) > available) delta = delta.slice(0, -1)
        if (encoded.length > available) truncated = true
        if (!delta) return
        output += delta
        try { this.options.onOutput?.({ id: commandId, stream, delta }) } catch { /* Cửa sổ có thể vừa đóng. */ }
      }
      const append = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
        const available = OUTPUT_LIMIT - bytes
        if (available > 0) {
          const part = chunk.subarray(0, available)
          bytes += part.length
          emit(stream, decoders[stream].write(part))
        }
        if (chunk.length > available) truncated = true
      }
      child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk))
      child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk))
      this.signal.addEventListener('abort', abort, { once: true })
      if (this.signal.aborted) abort()
      child.once('error', (error) => {
        clearTimeout(timer)
        this.signal.removeEventListener('abort', abort)
        reject(new Error('Không chạy được lệnh ' + command.executable + ': ' + error.message))
      })
      child.once('close', async (exitCode) => {
        clearTimeout(timer)
        this.signal.removeEventListener('abort', abort)
        await killing
        if (!truncated) {
          emit('stdout', decoders.stdout.end())
          emit('stderr', decoders.stderr.end())
        }
        resolve({ ...command, exitCode, output, truncated, timedOut, cancelled, durationMs: Date.now() - start })
      })
    })
  }
}
