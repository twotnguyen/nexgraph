import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Debug adapter tải khi cần như Wu (không đóng gói sẵn): js-debug (Node, MIT) và debugpy (Python, MIT).
 * Phiên bản và SHA-256 cố định; tải xong kiểm băm rồi giải nén bằng `tar` có sẵn trên macOS và Windows 10+.
 */
export const ADAPTERS = {
  node: {
    label: 'js-debug 1.140.1',
    url: 'https://github.com/microsoft/vscode-js-debug/releases/download/v1.140.1/js-debug-dap-v1.140.1.tar.gz',
    sha256: 'c72fab31bcbfdce6ad1f42adfd28eff8d4681dd3b03b5e2e6f9e72e6f9927faf',
    dir: 'js-debug-1.140.1',
    entry: ['js-debug', 'src', 'dapDebugServer.js']
  },
  python: {
    label: 'debugpy 1.8.22',
    url: 'https://files.pythonhosted.org/packages/56/3d/c7dc9f35bc9e22cdb53679f844bee40fd5cff871862f60595869a433400d/debugpy-1.8.22-py2.py3-none-any.whl',
    sha256: 'a9e9d3550e15ca479c59333e90845029190531f0cacfedab3b815a57bd913947',
    dir: 'debugpy-1.8.22',
    entry: ['debugpy', '__init__.py']
  }
} as const
export type DebugKind = keyof typeof ADAPTERS

export const adapterDir = (base: string, kind: DebugKind) => join(base, ADAPTERS[kind].dir)
export const adapterInstalled = (base: string, kind: DebugKind) => existsSync(join(adapterDir(base, kind), ...ADAPTERS[kind].entry))

export async function installAdapter(base: string, kind: DebugKind, fetchImpl: typeof fetch = fetch): Promise<void> {
  const spec = ADAPTERS[kind]
  const response = await fetchImpl(spec.url)
  if (!response.ok) throw Object.assign(new Error(`Không tải được ${spec.label} (HTTP ${response.status})`), { code: 'download_failed' })
  const bytes = Buffer.from(await response.arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== spec.sha256) throw Object.assign(new Error(`Tệp ${spec.label} tải về sai mã băm`), { code: 'bad_checksum' })
  const dir = adapterDir(base, kind)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const archive = join(dir, kind === 'node' ? 'adapter.tar.gz' : 'adapter.whl')
  await writeFile(archive, bytes)
  // bsdtar đọc được cả .tar.gz lẫn .whl (zip).
  await run('tar', ['-xf', archive, '-C', dir], { windowsHide: true })
  await rm(archive, { force: true })
  if (!adapterInstalled(base, kind)) throw Object.assign(new Error(`Giải nén ${spec.label} không thành công`), { code: 'install_failed' })
}

/** Python 3 của người dùng để chạy script và debugpy: python3 rồi python. */
export async function findPython(): Promise<string> {
  const candidates = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python']
  for (const exe of candidates) {
    try {
      const { stdout, stderr } = await run(exe, ['--version'], { windowsHide: true })
      if (/Python 3\./.test(stdout + stderr)) return exe
    } catch { /* thử tiếp */ }
  }
  throw Object.assign(new Error('Không tìm thấy Python 3 trên máy'), { code: 'no_python' })
}
