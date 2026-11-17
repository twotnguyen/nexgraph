import { appendFileSync, readFileSync, readdirSync } from 'node:fs'

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
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `name=${name}\npath=${path}\n`, 'utf8')
}
console.log(`Tệp cài đặt: ${path}`)
