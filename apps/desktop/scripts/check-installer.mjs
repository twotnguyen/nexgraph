import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, createReadStream, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REQUIRED_LICENSE_FILES, assertLicenseFiles, resourcesDir } from './license-files.mjs'
import { assertNoNexBinaryInAsar, assertPackagedNexRuntime } from './nex-runtime.mjs'

const targets = {
  darwin: { os: 'macos', ext: 'dmg' },
  win32: { os: 'windows', ext: 'exe' }
}
const target = targets[process.platform]
const arch = process.arch
if (!target || !['x64', 'arm64'].includes(arch)) {
  throw new Error(`Nền tảng đóng gói chưa được hỗ trợ: ${process.platform}/${arch}`)
}

const MAX_INSTALLER_BYTES = 500 * 1000 * 1000 // spec §6.1: mỗi tệp cài < 500 MB

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const name = `NexGraph-${version}-${target.os}-${arch}`
const filename = `${name}.${target.ext}`
const installers = readdirSync(new URL('../dist/', import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(?:dmg|exe)$/i.test(entry.name))
  .map((entry) => entry.name)
  .sort()

if (installers.length !== 1 || installers[0] !== filename) {
  throw new Error(`Cần đúng một tệp cài đặt ${filename}, tìm thấy: ${installers.join(', ') || '(không có)'}`)
}

// P3-8.2: bản cài RC2 thiếu THIRD_PARTY_LICENSES.md/NOTICE/LICENSE. Kiểm ngay trên app chưa nén
// mà electron-builder vừa tạo; thiếu tệp là job `package` đỏ, không chờ tới lúc cài.
function packagedAppDir() {
  const dist = fileURLToPath(new URL('../dist/', import.meta.url))
  if (process.platform === 'win32') {
    const dir = join(dist, 'win-unpacked')
    return existsSync(dir) ? dir : null
  }
  for (const entry of readdirSync(dist).filter((name) => name.startsWith('mac'))) {
    const dir = join(dist, entry, 'NexGraph.app')
    if (existsSync(dir)) return dir
  }
  return null
}

const appDir = packagedAppDir()
if (!appDir) throw new Error('Không thấy app chưa nén trong apps/desktop/dist để kiểm tệp giấy phép (chạy electron-builder trước)')
assertLicenseFiles(appDir, process.platform)
console.log(`Tệp giấy phép trong ${resourcesDir(appDir, process.platform)}: ` +
  REQUIRED_LICENSE_FILES.map((name) => `${name} ${statSync(join(resourcesDir(appDir, process.platform), name)).size} B`).join(' · '))

// PKG-NEX-2: binary runtime Nex phải nằm ngoài app.asar (resources/opencode/), không bị đóng vào asar.
assertNoNexBinaryInAsar(appDir, process.platform)

// PKG-NEX-3: binary trong gói phải đúng sha256 đã ghim, có quyền thực thi và chạy được `--version`.
// Chạy trên app chưa nén để job `package` đỏ ngay nếu runtime thiếu/hỏng, không chờ tới lúc cài.
await assertPackagedNexRuntime({ appDir, platform: process.platform })

const path = `apps/desktop/dist/${filename}`
const manifest = `apps/desktop/dist/${name}.build.json`
const installer = new URL(`../dist/${filename}`, import.meta.url)
const hash = createHash('sha256')
for await (const chunk of createReadStream(installer)) hash.update(chunk)
const sha256 = hash.digest('hex')
const bytes = statSync(installer).size
if (bytes >= MAX_INSTALLER_BYTES) {
  throw new Error(`${filename} nặng ${(bytes / 1e6).toFixed(1)} MB, vượt giới hạn ${MAX_INSTALLER_BYTES / 1e6} MB`)
}
const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: fileURLToPath(new URL('../../../', import.meta.url)),
  encoding: 'utf8'
}).trim()
const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT } = process.env
const run = GITHUB_RUN_ID
  ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/attempts/${GITHUB_RUN_ATTEMPT}`
  : null
writeFileSync(new URL(`../dist/${name}.build.json`, import.meta.url), JSON.stringify({
  version,
  platform: target.os,
  arch,
  filename,
  bytes,
  sha256,
  commit,
  run
}, null, 2) + '\n', 'utf8')

// Cập nhật trong app (Windows): electron-updater cần tệp kênh (`latest.yml`/`alpha.yml`/`beta.yml`)
// trỏ đúng bộ cài này và tệp `.blockmap`. Thiếu thì bản đã cài sẽ không thấy bản mới, nên job đỏ ngay.
if (process.platform === 'win32') {
  const dist = fileURLToPath(new URL('../dist/', import.meta.url))
  const channels = readdirSync(dist)
    .filter((entry) => /^(latest|alpha|beta)\.yml$/.test(entry))
    .filter((entry) => readFileSync(join(dist, entry), 'utf8').includes(`path: ${filename}`))
  if (channels.length === 0) throw new Error(`Thiếu tệp kênh cập nhật (latest/alpha/beta.yml) trỏ tới ${filename}`)
  if (!existsSync(join(dist, `${filename}.blockmap`))) throw new Error(`Thiếu ${filename}.blockmap cho cập nhật trong app`)
  console.log(`Tệp cập nhật: ${channels.join(', ')}, ${filename}.blockmap`)
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `name=${name}\npath=${path}\nmanifest=${manifest}\n`, 'utf8')
}
console.log(`Tệp cài đặt: ${path}`)
console.log(`Build ${commit} · SHA-256 ${sha256} · ${(bytes / 1e6).toFixed(1)} MB / ${MAX_INSTALLER_BYTES / 1e6} MB`)
