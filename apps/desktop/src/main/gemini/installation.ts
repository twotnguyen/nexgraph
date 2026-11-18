import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { chmod, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
export const ANTIGRAVITY_CLI_VERSION = '1.5.11'
export type AntigravityRelease = {
  platform: NodeJS.Platform
  arch: string
  url: string
  sha512: string
  archive: boolean
}
const PREFIX = 'https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.11-6132547114106880'
export const ANTIGRAVITY_RELEASES: readonly AntigravityRelease[] = [
  {
    platform: 'win32',
    arch: 'x64',
    url: `${PREFIX}/windows-x64/cli_windows_x64.exe`,
    sha512:
      '7de2a90b3a351c5c1d089b50a773d4fc455062870fa62fc4d50ee2779d7b9f1b630a7025c31163671f6c82ae0426aeda838f98f67270a50fdd2c7de2f2d7eb3f',
    archive: false
  },
  {
    platform: 'win32',
    arch: 'arm64',
    url: `${PREFIX}/windows-arm/cli_windows_arm64.exe`,
    sha512:
      'a1c89cca8d3c7af9c3bdc77318975a9e0eb0fb93c421b198b14b18a4b65933c7adea2c9cb35651f7658e810b6241e8cf03a652b3b8bc221bbc2fcdb61edc01b6',
    archive: false
  },
  {
    platform: 'darwin',
    arch: 'x64',
    url: `${PREFIX}/darwin-x64/cli_mac_x64.tar.gz`,
    sha512:
      'ff1f625c2efcff03d2131e3e9dc67bb5d1974b67810706f80ad34317c83769486388226352f1a34ede54fad43f5941220ea9beddefc8b27419023c6e9aa4682c',
    archive: true
  },
  {
    platform: 'darwin',
    arch: 'arm64',
    url: `${PREFIX}/darwin-arm/cli_mac_arm64.tar.gz`,
    sha512:
      '1b2c8e1f832e1be9b257c24e4ac75c9029771fef5af9b529ea295fff1aa5b9d3e1e5447200a76ac8a775889aa8399210716f188f84242b3c34a2e9a8a3c2cc7d',
    archive: true
  }
]
export const getAntigravityRelease = (
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): AntigravityRelease | undefined =>
  ANTIGRAVITY_RELEASES.find((r) => r.platform === platform && r.arch === arch)
export type NativeCommand = { executable: string; args: string[] }
export type InstallationOptions = {
  binaryPath?: string
  command?: NativeCommand
  fetch?: typeof fetch
  platform?: NodeJS.Platform
  arch?: string
  verifySignature?: (path: string) => Promise<void>
}
const MAX_DOWNLOAD = 300 * 1024 * 1024,
  MAX_EXPANDED = 512 * 1024 * 1024
const bad = (message: string) => Object.assign(new Error(message), { code: 'antigravity_setup_error' })
/** Only one regular named executable is extracted from Google's hash-pinned archive. */
export function extractAntigravityTarGz(payload: Buffer): Buffer {
  const bytes = gunzipSync(payload, { maxOutputLength: MAX_EXPANDED })
  let offset = 0
  let result: Buffer | undefined
  let count = 0
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512)
    if (header.every((v) => v === 0)) break
    if (++count > 100) throw bad('Gói Antigravity chứa quá nhiều mục')
    const field = (start: number, length: number) =>
      header
        .subarray(start, start + length)
        .toString('utf8')
        .replace(/\0.*$/s, '')
        .trim()
    const sizeString = field(124, 12)
    if (!/^[0-7]+$/.test(sizeString)) throw bad('Kích thước gói Antigravity không hợp lệ')
    const size = Number.parseInt(sizeString, 8)
    let sum = 0
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i]!
    if (
      Number.parseInt(field(148, 8), 8) !== sum ||
      size > MAX_EXPANDED ||
      offset + 512 + size > bytes.length
    )
      throw bad('Gói Antigravity bị hỏng hoặc vượt giới hạn')
    if (
      field(345, 155) ||
      !['antigravity', './antigravity'].includes(field(0, 100)) ||
      ![0, 48].includes(header[156]!) ||
      result
    )
      throw bad('Gói Antigravity chứa mục không được hỗ trợ')
    result = bytes.subarray(offset + 512, offset + 512 + size)
    offset += 512 + Math.ceil(size / 512) * 512
  }
  if (!result?.length) throw bad('Gói Antigravity thiếu chương trình thực thi')
  return result
}
export async function verifyWindowsSignature(path: string): Promise<void> {
  const literal = `'${path.replaceAll("'", "''")}'`
  const script = `$signature = Get-AuthenticodeSignature -LiteralPath ${literal}; if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(?:^|, )O=Google LLC(?:,|$)') { exit 1 }; Write-Output 'Google LLC'`
  const ps = join(
    process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  await new Promise<void>((done, reject) =>
    execFile(
      ps,
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 4096,
        env: { ...process.env, PSModulePath: undefined }
      },
      (error, output) =>
        error || String(output).trim() !== 'Google LLC'
          ? reject(bad('Không xác minh được chữ ký Google của Antigravity CLI'))
          : done()
    )
  )
}
/** Native version-pinned installation; no global installer, shell profile or Node dependency. */
export class GeminiInstallation {
  readonly directory: string
  readonly release: AntigravityRelease | undefined
  constructor(
    private readonly dataDir: string,
    private readonly options: InstallationOptions = {}
  ) {
    const platform = options.platform ?? process.platform,
      arch = options.arch ?? process.arch
    this.release = getAntigravityRelease(platform, arch)
    this.directory = join(
      resolve(dataDir),
      'tools',
      'antigravity',
      ANTIGRAVITY_CLI_VERSION,
      `${platform}-${arch}`
    )
  }
  platformSupported(): boolean {
    return !!this.release
  }
  entry(): string | null {
    const override = this.options.command?.executable ?? this.options.binaryPath
    if (override)
      return isAbsolute(override) && existsSync(override) && statSync(override).isFile() ? override : null
    try {
      const manifest = JSON.parse(readFileSync(join(this.directory, 'install.json'), 'utf8'))
      const entry = join(this.directory, this.release?.platform === 'win32' ? 'agy.exe' : 'agy')
      return this.release &&
        manifest.version === ANTIGRAVITY_CLI_VERSION &&
        manifest.sha512 === this.release.sha512 &&
        existsSync(entry)
        ? entry
        : null
    } catch {
      return null
    }
  }
  command(): NativeCommand | null {
    const executable = this.entry()
    return executable ? { executable, args: [...(this.options.command?.args ?? [])] } : null
  }
  async setup(signal: AbortSignal, progress: (message: string) => void): Promise<void> {
    if (!this.release)
      throw bad('NexGraph hỗ trợ Antigravity CLI trên Windows và macOS 64 bit (x64 hoặc ARM64)')
    if (this.entry()) return
    signal.throwIfAborted()
    progress('Đang tải Antigravity CLI chính thức của Google…')
    const response = await (this.options.fetch ?? fetch)(this.release.url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(240000)]),
      redirect: 'follow'
    })
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {})
      throw bad(`Không tải được Antigravity CLI (HTTP ${response.status})`)
    }
    if (Number(response.headers.get('content-length') ?? 0) > MAX_DOWNLOAD) {
      await response.body.cancel().catch(() => {})
      throw bad('Gói Antigravity vượt giới hạn tải xuống')
    }
    const stage = join(this.dataDir, 'tools', 'antigravity', `.install-${randomUUID()}`)
    await mkdir(stage, { recursive: true, mode: 0o700 })
    try {
      const payload = join(stage, 'payload')
      const file = await open(payload, 'wx', 0o600)
      const hash = createHash('sha512')
      const reader = response.body.getReader()
      let size = 0
      try {
        for (;;) {
          const item = await reader.read()
          signal.throwIfAborted()
          if (item.done) break
          size += item.value.length
          if (size > MAX_DOWNLOAD) throw bad('Gói Antigravity vượt giới hạn tải xuống')
          hash.update(item.value)
          await file.write(item.value)
        }
      } finally {
        await file.close()
        await reader.cancel().catch(() => {})
      }
      if (hash.digest('hex') !== this.release.sha512)
        throw bad('Không xác minh được tính toàn vẹn của Antigravity CLI. Chưa cài đặt.')
      signal.throwIfAborted()
      progress('Đã xác minh gói. Đang thiết lập Antigravity CLI…')
      const executable = join(stage, this.release.platform === 'win32' ? 'agy.exe' : 'agy')
      if (this.release.archive) {
        await writeFile(executable, extractAntigravityTarGz(await readFile(payload)), {
          mode: 0o500,
          flag: 'wx'
        })
        await rm(payload, { force: true })
      } else await rename(payload, executable)
      if (this.release.platform === 'win32')
        await (this.options.verifySignature ?? verifyWindowsSignature)(executable)
      await chmod(executable, this.release.platform === 'win32' ? 0o444 : 0o555)
      await writeFile(
        join(stage, 'install.json'),
        JSON.stringify({
          version: ANTIGRAVITY_CLI_VERSION,
          sha512: this.release.sha512,
          url: this.release.url
        }),
        { mode: 0o400 }
      )
      signal.throwIfAborted()
      await mkdir(resolve(this.directory, '..'), { recursive: true, mode: 0o700 })
      if (existsSync(this.directory))
        await rename(this.directory, this.directory + '.previous-' + randomUUID())
      await rename(stage, this.directory)
      progress('Antigravity CLI đã sẵn sàng đăng nhập Google.')
    } finally {
      const absolute = resolve(stage),
        base = resolve(this.dataDir, 'tools', 'antigravity')
      if (
        dirname(absolute) === base &&
        /^\.install-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(basename(absolute))
      )
        await rm(absolute, { recursive: true, force: true })
    }
  }
}
