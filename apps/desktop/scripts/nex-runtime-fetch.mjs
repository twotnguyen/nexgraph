// Tải → kiểm sha256 → giải nén → đặt binary runtime Nex vào build-resources/opencode/.
// Tách khỏi fetch-nex-runtime.mjs (CLI) để test được bằng phụ thuộc giả (không mạng, không tar).
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  assetFor,
  assertSha256,
  isRuntimeCurrent,
  platformKey,
  runtimeBinaryPath,
  sha256File
} from './nex-runtime.mjs'

export async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Tải ${url} thất bại: HTTP ${res.status} ${res.statusText}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
}

export function extract(zip, destDir) {
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
export function findBinary(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = findBinary(path, name)
      if (nested) return nested
    } else if (entry.name === name) return path
  }
  return null
}

/**
 * Đặt `src` vào `dest`. rename trước; nếu src và dest khác ổ đĩa (EXDEV — runner Windows để %TEMP% ở C:,
 * workspace ở D:) thì chép sang tệp tạm CẠNH đích, kiểm sha256 lại rồi mới rename nguyên tử vào đích
 * và xoá nguồn. Đích chỉ bị đổi khi nội dung đã đúng sha256; lỗi khác EXDEV ném nguyên văn.
 */
export async function moveFileVerified(src, dest, expectedSha256, label, deps = {}) {
  const { rename = renameSync, copyFile = copyFileSync, rm = rmSync } = deps
  try {
    rename(src, dest)
    return 'rename'
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error
  }
  const part = `${dest}.part-${randomBytes(4).toString('hex')}`
  try {
    copyFile(src, part)
    assertSha256(await sha256File(part), expectedSha256, label)
    rename(part, dest)
  } catch (error) {
    try {
      rm(part, { force: true })
    } catch {
      // Tệp .part nằm cạnh đích; không để lỗi dọn che lỗi gốc đang ném.
    }
    throw error
  }
  try {
    rm(src, { force: true })
  } catch {
    // Nguồn nằm trong thư mục tạm; fetchNexRuntime sẽ dọn cả thư mục (và cảnh báo nếu không được).
  }
  return 'copy'
}

export async function fetchNexRuntime({ config, platform = process.platform, arch = process.arch, out, log = console.log, deps = {} }) {
  const { download: fetchZip = download, extract: unpack = extract, rm = rmSync } = deps
  const key = platformKey(platform, arch)
  const asset = assetFor(config, platform, arch)
  const dest = runtimeBinaryPath(out, platform)

  if (await isRuntimeCurrent(dest, asset.binarySha256)) {
    log(`Runtime Nex ${config.version} (${key}) đã có và đúng sha256 — bỏ qua tải: ${dest}`)
    return { status: 'current', key, dest }
  }

  // Thư mục tạm nằm cùng thư mục cha với `out` (không phải os.tmpdir()): cùng ổ đĩa nên rename vào đích
  // không bao giờ gặp EXDEV (CI run 45700544939). Đích có thể là symlink sang ổ khác → moveFileVerified dự phòng.
  mkdirSync(dirname(out), { recursive: true })
  const staging = mkdtempSync(join(dirname(out), '.opencode-tmp-'))
  const zip = join(staging, asset.filename)
  try {
    log(`Tải runtime Nex ${config.version} (${key}): ${asset.url}`)
    await fetchZip(asset.url, zip)
    const bytes = statSync(zip).size
    if (asset.bytes && bytes !== asset.bytes) {
      throw new Error(`Tệp ${asset.filename} nặng ${bytes} B, tệp ghim ghi ${asset.bytes} B — tải lại hoặc cập nhật nex-runtime.json.`)
    }
    assertSha256(await sha256File(zip), asset.sha256, asset.filename)

    const unpacked = join(staging, 'unpacked')
    unpack(zip, unpacked)
    const binary = findBinary(unpacked, asset.binary)
    if (!binary) throw new Error(`Không thấy ${asset.binary} trong ${asset.filename}.`)
    const label = `${asset.binary} trong ${asset.filename}`
    assertSha256(await sha256File(binary), asset.binarySha256, label)

    mkdirSync(out, { recursive: true })
    if (existsSync(dest)) rmSync(dest, { force: true })
    const placed = await moveFileVerified(binary, dest, asset.binarySha256, label, deps)
    if (platform !== 'win32') chmodSync(dest, 0o755)
    log(
      `Runtime Nex ${config.version} (${key}) → ${dest} · ` +
      `${(statSync(dest).size / 1e6).toFixed(1)} MB · sha256 ${asset.binarySha256}`
    )
    return { status: 'fetched', key, dest, placed }
  } finally {
    // Dọn lỗi (vd. Windows EBUSY khi antivirus còn giữ tệp) chỉ cảnh báo: không che lỗi gốc, không làm hỏng lượt đã đặt xong.
    try {
      rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch (error) {
      log(`Cảnh báo: Không dọn được thư mục tạm ${staging}: ${error.message}`)
    }
  }
}
