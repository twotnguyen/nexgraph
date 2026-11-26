// Runtime Nex (OpenCode) đóng kèm bộ cài: đọc tệp ghim, kiểm sha256, kiểm binary trong gói.
// Phần thuần (không mạng) ở đây để test được; việc tải/giải nén nằm ở fetch-nex-runtime.mjs.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, createReadStream, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { join, posix, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resourcesDir } from './license-files.mjs'

export const NEX_RUNTIME_CONFIG = fileURLToPath(new URL('../nex-runtime.json', import.meta.url))
export const NEX_RUNTIME_SUPPORTED = ['darwin-arm64', 'windows-x64']

/** Đọc tệp ghim; mọi script khác dùng chung để version/sha chỉ có một nguồn. */
export function loadNexRuntime(file = NEX_RUNTIME_CONFIG) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** Khoá asset theo platform/arch; chỉ hỗ trợ mac arm64 và win x64 (brief N3-P1). */
export function platformKey(platform = process.platform, arch = process.arch) {
  const key = platform === 'win32' ? `windows-${arch}` : `${platform}-${arch}`
  if (!NEX_RUNTIME_SUPPORTED.includes(key)) {
    throw new Error(`Nền tảng ${platform}/${arch} chưa hỗ trợ runtime Nex; chỉ có ${NEX_RUNTIME_SUPPORTED.join(', ')}.`)
  }
  return key
}

/** Đổi khoá asset ('windows-x64') về tên nền tảng Node ('win32'). */
export function platformOs(key) {
  const os = key.split('-')[0]
  return os === 'windows' ? 'win32' : os
}

export function binaryName(platform = process.platform) {
  return platform === 'win32' ? 'opencode.exe' : 'opencode'
}

/** Đường dẫn binary trong thư mục đích của fetch (build-resources/opencode/). */
export function runtimeBinaryPath(dir, platform = process.platform) {
  return join(dir, binaryName(platform))
}

export function assetFor(config = loadNexRuntime(), platform = process.platform, arch = process.arch) {
  const key = platformKey(platform, arch)
  const asset = config.assets[key]
  if (!asset) throw new Error(`Tệp ghim runtime Nex thiếu asset ${key}.`)
  return asset
}

export async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

/** So sha256 và fail kèm cả hai giá trị để thấy ngay tệp tải hỏng hay ghim sai. */
export function assertSha256(actual, expected, label = 'tệp') {
  if (actual !== expected) {
    throw new Error(
      `Sai sha256 của ${label}: mong đợi ${expected}, nhận ${actual}. ` +
      'Tệp tải có thể hỏng hoặc đã bị thay đổi; xoá tệp tạm và kiểm lại URL/sha256 trong nex-runtime.json.'
    )
  }
}

/** Idempotent: binary đã đúng sha thì không tải lại. */
export async function isRuntimeCurrent(path, expectedSha256) {
  try {
    if (!statSync(path).isFile()) return false
    return (await sha256File(path)) === expectedSha256
  } catch {
    return false
  }
}

export function packagedBinaryPath(appDir, platform = process.platform) {
  // Dùng join của nền tảng đích để test trên macOS vẫn so được đường dẫn Windows (bài học QA #63).
  const path = platform === 'win32' ? win32 : posix
  return path.join(resourcesDir(appDir, platform), 'opencode', binaryName(platform))
}

/**
 * Kiểm runtime Nex trong app đã đóng gói: có tệp, có quyền thực thi (macOS), đúng sha256,
 * và chạy được `--version` đúng bản ghim. Dùng chung cho check-installer và smoke bộ cài.
 */
export async function assertPackagedNexRuntime({
  appDir,
  platform = process.platform,
  file = NEX_RUNTIME_CONFIG,
  log = console.log
}) {
  const config = loadNexRuntime(file)
  const asset = assetFor(config, platform, platform === 'win32' ? 'x64' : 'arm64')
  const bin = packagedBinaryPath(appDir, platform)
  if (!existsSync(bin)) {
    throw new Error(`Bản đóng gói thiếu runtime Nex tại ${bin}. Chạy fetch-nex-runtime.mjs trước khi package.`)
  }
  const stat = statSync(bin)
  if (stat.size < 1_000_000) throw new Error(`Runtime Nex ${bin} chỉ ${stat.size} B — tệp rỗng hoặc chép thiếu.`)
  if (platform !== 'win32' && (stat.mode & 0o111) === 0) {
    throw new Error(`Runtime Nex ${bin} không có quyền thực thi (mode ${(stat.mode & 0o777).toString(8)}).`)
  }
  // Windows chép nguyên .exe nên sha phải khớp tệp ghim. macOS bị @electron/osx-sign ký ad-hoc
  // cùng app nên byte đổi; khi đó chấp nhận nếu chữ ký codesign hợp lệ.
  const actual = await sha256File(bin)
  if (platform !== 'win32' && actual !== asset.binarySha256) {
    try {
      execFileSync('codesign', ['--verify', '--strict', bin], { stdio: 'pipe', timeout: 60_000 })
    } catch {
      throw new Error(
        `Sai sha256 của ${bin} (binary OpenCode ${config.version}): mong đợi ${asset.binarySha256}, nhận ${actual}; ` +
        'binary cũng không có chữ ký codesign hợp lệ.'
      )
    }
  } else {
    assertSha256(actual, asset.binarySha256, `${bin} (binary OpenCode ${config.version})`)
  }
  const printed = execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 120_000 }).trim()
  if (!printed.includes(config.version)) {
    throw new Error(`Runtime Nex in "${printed}", mong đợi bản ${config.version}.`)
  }
  log(`Runtime Nex trong gói: ${printed} · ${(stat.size / 1e6).toFixed(1)} MB · ${bin}`)
  return printed
}

/** Binary không được nằm trong app.asar: đọc header asar và tìm đúng tên tệp binary. */
export function assertNoNexBinaryInAsar(appDir, platform = process.platform) {
  const archive = join(resourcesDir(appDir, platform), 'app.asar')
  if (!existsSync(archive)) throw new Error(`Không thấy ${archive} để kiểm asar.`)
  // Định dạng asar: [pickle 8 B: độ dài headerBuf][headerBuf: 4 B độ dài + 4 B độ dài JSON + JSON].
  const size = Buffer.alloc(8)
  const fd = openSync(archive, 'r')
  try {
    readSync(fd, size, 0, 8, 0)
  } finally {
    closeSync(fd)
  }
  const headerBuf = Buffer.alloc(size.readUInt32LE(4))
  const fd2 = openSync(archive, 'r')
  try {
    readSync(fd2, headerBuf, 0, headerBuf.length, 8)
  } finally {
    closeSync(fd2)
  }
  const jsonSize = headerBuf.readUInt32LE(4)
  const header = JSON.parse(headerBuf.subarray(8, 8 + jsonSize).toString('utf8'))
  const hits = []
  const walk = (node, prefix) => {
    for (const [name, child] of Object.entries(node ?? {})) {
      if (!child || typeof child !== 'object') continue
      const path = prefix ? `${prefix}/${name}` : name
      if (child.files) walk(child.files, path)
      else if (name === 'opencode' || name === 'opencode.exe') hits.push(path)
    }
  }
  walk(header.files, '')
  if (hits.length > 0) {
    throw new Error(`app.asar chứa binary runtime Nex (${hits.join(', ')}); phải để ngoài asar trong resources/opencode/.`)
  }
}
