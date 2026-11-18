import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, createReadStream, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const targets = {
  darwin: { os: 'macos', ext: 'dmg' },
  win32: { os: 'windows', ext: 'exe' }
}
const target = targets[process.platform]
const arch = process.arch
if (!target || !['x64', 'arm64'].includes(arch)) {
  throw new Error(`Nền tảng đóng gói chưa được hỗ trợ: ${process.platform}/${arch}`)
}

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

const path = `apps/desktop/dist/${filename}`
const manifest = `apps/desktop/dist/${name}.build.json`
const installer = new URL(`../dist/${filename}`, import.meta.url)
const hash = createHash('sha256')
for await (const chunk of createReadStream(installer)) hash.update(chunk)
const sha256 = hash.digest('hex')
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
  bytes: statSync(installer).size,
  sha256,
  commit,
  run
}, null, 2) + '\n', 'utf8')

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `name=${name}\npath=${path}\nmanifest=${manifest}\n`, 'utf8')
}
console.log(`Tệp cài đặt: ${path}`)
console.log(`Build ${commit} · SHA-256 ${sha256}`)
