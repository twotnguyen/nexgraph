// Tải binary runtime Nex (OpenCode) cho nền tảng hiện tại (hoặc --platform), kiểm sha256,
// giải nén vào apps/desktop/build-resources/opencode/ để electron-builder chép vào bộ cài.
// Idempotent: binary đã đúng sha thì bỏ qua, nên chạy lại trước mỗi lần package là rẻ.
//
//   node scripts/fetch-nex-runtime.mjs [--platform darwin-arm64|windows-x64] [--out <thư mục>]
import { spawnSync } from 'node:child_process'
import { chmodSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import {
  NEX_RUNTIME_CONFIG,
  NEX_RUNTIME_SUPPORTED,
  assetFor,
  assertSha256,
  isRuntimeCurrent,
  loadNexRuntime,
  platformKey,
  platformOs,
  runtimeBinaryPath,
  sha256File
} from './nex-runtime.mjs'

const DEFAULT_OUT = fileURLToPath(new URL('../build-resources/opencode', import.meta.url))
const usage = `Cách dùng: node scripts/fetch-nex-runtime.mjs [--platform <${NEX_RUNTIME_SUPPORTED.join('|')}>] [--out <thư mục>]`

function parseArgs(argv) {
  const options = { platform: null, out: DEFAULT_OUT }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--platform') options.platform = argv[++i]
    else if (arg === '--out') options.out = resolve(argv[++i])
    else if (arg === '--help' || arg === '-h') {
      console.log(usage)
      process.exit(0)
    } else throw new Error(`Tham số lạ: ${arg}\n${usage}`)
  }
  return options
}

/** Khoá asset → (nền tảng Node, arch) để tái dùng chung logic với tệp ghim. */
function platformFromKey(key) {
  const arch = key.split('-').slice(1).join('-')
  return { platform: platformOs(key), arch }
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Tải ${url} thất bại: HTTP ${res.status} ${res.statusText}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
}

function extract(zip, destDir) {
  mkdirSync(destDir, { recursive: true })
  const [command, args] = process.platform === 'darwin'
    ? ['ditto', ['-x', '-k', zip, destDir]]
    : ['tar', ['-xf', zip, '-C', destDir]]
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Giải nén ${zip} bằng ${command} thất bại (${result.status}): ${(result.stderr || '').trim()}`)
  }
}

/** Zip của OpenCode có binary ở gốc; vẫn dò đệ quy để chịu được thay đổi cách đóng gói. */
function findBinary(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = findBinary(path, name)
      if (nested) return nested
    } else if (entry.name === name) return path
  }
  return null
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const config = loadNexRuntime(NEX_RUNTIME_CONFIG)
  const { platform, arch } = options.platform
    ? platformFromKey(options.platform)
    : { platform: process.platform, arch: process.arch }
  const key = platformKey(platform, arch)
  const asset = assetFor(config, platform, arch)
  const dest = runtimeBinaryPath(options.out, platform)

  if (await isRuntimeCurrent(dest, asset.binarySha256)) {
    console.log(`Runtime Nex ${config.version} (${key}) đã có và đúng sha256 — bỏ qua tải: ${dest}`)
    return
  }

  const staging = mkdtempSync(join(tmpdir(), 'ng-nex-runtime-'))
  const zip = join(staging, asset.filename)
  try {
    console.log(`Tải runtime Nex ${config.version} (${key}): ${asset.url}`)
    await download(asset.url, zip)
    const bytes = statSync(zip).size
    if (asset.bytes && bytes !== asset.bytes) {
      throw new Error(`Tệp ${asset.filename} nặng ${bytes} B, tệp ghim ghi ${asset.bytes} B — tải lại hoặc cập nhật nex-runtime.json.`)
    }
    assertSha256(await sha256File(zip), asset.sha256, asset.filename)

    const unpacked = join(staging, 'unpacked')
    extract(zip, unpacked)
    const binary = findBinary(unpacked, asset.binary)
    if (!binary) throw new Error(`Không thấy ${asset.binary} trong ${asset.filename}.`)
    assertSha256(await sha256File(binary), asset.binarySha256, `${asset.binary} trong ${asset.filename}`)

    mkdirSync(options.out, { recursive: true })
    if (existsSync(dest)) rmSync(dest, { force: true })
    renameSync(binary, dest)
    if (platform !== 'win32') chmodSync(dest, 0o755)
    console.log(
      `Runtime Nex ${config.version} (${key}) → ${dest} · ` +
      `${(statSync(dest).size / 1e6).toFixed(1)} MB · sha256 ${asset.binarySha256}`
    )
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`fetch-nex-runtime: ${error.message}`)
  process.exitCode = 1
})
