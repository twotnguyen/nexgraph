#!/usr/bin/env node
// Dựng app NexGraph từ nền Code-OSS đã ghim: lấy nền → áp bản vá → chép đè → gắn extension + engine → build.
// Dùng: node labs/shell/build.mjs [--dev] [--src <đường dẫn hoặc URL repo nền>]
//   --dev  chỉ biên dịch để chạy thử bằng .upstream/scripts/code.sh, không đóng gói.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..')
const up = join(here, '.upstream')
const pin = JSON.parse(readFileSync(join(here, 'upstream.json'), 'utf8'))
const args = process.argv.slice(2)
const dev = args.includes('--dev')
const src = args.includes('--src') ? args[args.indexOf('--src') + 1] : pin.repo
const win = process.platform === 'win32'

const run = (cmd, a, cwd) => execFileSync(cmd, a, { cwd, stdio: 'inherit', shell: win })
const step = (m) => console.log(`\n== ${m}`)

if (process.versions.node !== pin.node) {
  console.error(`Nền cần Node ${pin.node}, đang chạy ${process.versions.node}. Đổi phiên bản Node rồi chạy lại.`)
  process.exit(1)
}

step(`Lấy nền ${pin.version} @ ${pin.commit.slice(0, 11)}`)
if (!existsSync(join(up, '.git'))) {
  mkdirSync(up, { recursive: true })
  run('git', ['init', '-q'], up)
  run('git', ['fetch', '-q', '--depth', '1', src, pin.commit], up)
  run('git', ['checkout', '-q', 'FETCH_HEAD'], up)
}
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: up, encoding: 'utf8' }).trim()
if (head !== pin.commit) {
  console.error(`.upstream đang ở ${head}, khác commit ghim ${pin.commit}. Xoá labs/shell/.upstream rồi chạy lại.`)
  process.exit(1)
}
// Về trạng thái gốc trước khi áp lại, để chạy nhiều lần vẫn ra cùng kết quả (giữ node_modules, out, .build).
run('git', ['reset', '-q', '--hard'], up)
rmSync(join(up, 'extensions', 'nexgraph'), { recursive: true, force: true })

step('Áp bản vá')
for (const p of readdirSync(join(here, 'patches')).filter((f) => f.endsWith('.patch')).sort()) {
  console.log(p)
  run('git', ['apply', '--whitespace=nowarn', join(here, 'patches', p)], up)
}

step('Chép đè icon, logo nền, font')
cpSync(join(here, 'overlay'), up, { recursive: true })

step('Ghi product.json')
const productFile = join(up, 'product.json')
const product = { ...JSON.parse(readFileSync(productFile, 'utf8')), ...JSON.parse(readFileSync(join(here, 'product.overrides.json'), 'utf8')) }
writeFileSync(productFile, JSON.stringify(product, null, '\t') + '\n')

step('Build extension NexGraph')
run('pnpm', ['build'], join(repo, 'labs', 'extension'))
const ext = join(up, 'extensions', 'nexgraph')
mkdirSync(ext, { recursive: true })
for (const f of ['package.json', 'dist', 'media', 'themes']) cpSync(join(repo, 'labs', 'extension', f), join(ext, f), { recursive: true })
for (const f of ['LICENSE', 'NOTICE', 'THIRD_PARTY_LICENSES.md']) cpSync(join(repo, f), join(ext, f))

step('Cài dependency của nền')
if (!existsSync(join(up, 'node_modules'))) run('pnpm', ['install', '--frozen-lockfile'], up)

if (dev) {
  step('Biên dịch (chế độ dev)')
  run('pnpm', ['run', 'compile'], up)
  console.log(`\nChạy thử: NEXGRAPH_REPO_ROOT=${repo} ${join(up, 'scripts', win ? 'code.bat' : 'code.sh')} <thư mục dự án>`)
  process.exit(0)
}

const target = `${win ? 'win32' : process.platform}-${process.arch}`
step(`Đóng gói vscode-${target}-min`)
run('pnpm', ['run', 'gulp', `vscode-${target}-min`], up)

// Nền đặt kết quả cạnh thư mục nguồn: labs/shell/VSCode-<target>.
const out = join(here, `VSCode-${target}`)
const appDir = process.platform === 'darwin' ? join(out, `${product.nameLong}.app`, 'Contents', 'Resources', 'app') : join(out, 'resources', 'app')
step('Lược bỏ phần của nền không dùng tới')
const prune = JSON.parse(readFileSync(join(here, 'prune.json'), 'utf8'))
const size = (dir = appDir) => { // MB, tự cộng để chạy giống nhau trên macOS và Windows
  let sum = 0
  for (const e of readdirSync(dir, { withFileTypes: true })) sum += e.isDirectory() ? size(join(dir, e.name)) : e.isFile() ? statSync(join(dir, e.name)).size / 1048576 : 0
  return sum
}
const before = size()
for (const names of Object.values(prune.extensions)) for (const n of names) rmSync(join(appDir, 'extensions', n), { recursive: true, force: true })
for (const paths of Object.values(prune.paths)) for (const p of paths) rmSync(join(appDir, p), { recursive: true, force: true })
if (prune.sourceMaps) {
  const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const f = join(dir, e.name); if (e.isDirectory()) walk(f); else if (e.name.endsWith('.map')) rmSync(f) } }
  walk(join(appDir, 'out'))
}
// Nền kiểm tra toàn vẹn theo danh sách checksum trong product.json; bỏ mục của các tệp vừa xoá để không báo "bản cài bị hỏng".
const packed = join(appDir, 'product.json')
const pj = JSON.parse(readFileSync(packed, 'utf8'))
for (const k of Object.keys(pj.checksums ?? {})) if (!existsSync(join(appDir, 'out', k))) delete pj.checksums[k]
writeFileSync(packed, JSON.stringify(pj, null, '\t') + '\n')
console.log(`${Math.round(before)} MB → ${Math.round(size())} MB`)

const engine = join(repo, 'engine', 'dist', 'nexgraph-engine')
if (existsSync(engine)) {
  step('Chép engine đã đóng gói vào extension')
  // Chép sau khi đóng gói để giữ nguyên quyền thực thi và symlink của PyInstaller.
  cpSync(engine, join(appDir, 'extensions', 'nexgraph', 'engine'), { recursive: true, verbatimSymlinks: true })
} else {
  console.warn('\nCHÚ Ý: chưa có engine/dist/nexgraph-engine (chạy PyInstaller trước). Bản này không có engine kèm theo.')
}
console.log(`\nXong: ${out}`)
