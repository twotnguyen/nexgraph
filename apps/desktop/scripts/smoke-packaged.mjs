// Chạy bản đóng gói đã giải nén với NEXGRAPH_SMOKE=1 và đường dẫn data có dấu tiếng Việt.
// Exit 0 nếu stdout có "SMOKE OK", ngược lại in stdout/stderr và exit 1.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

function findBinary() {
  if (process.platform === 'win32') {
    const p = join(dist, 'win-unpacked', 'NexGraph.exe')
    return existsSync(p) ? p : null
  }
  for (const d of readdirSync(dist).filter((n) => n.startsWith('mac'))) {
    const p = join(dist, d, 'NexGraph.app', 'Contents', 'MacOS', 'NexGraph')
    if (existsSync(p)) return p
  }
  return null
}

const bin = findBinary()
if (!bin) {
  console.error(`Không thấy bản đóng gói trong ${dist}. Chạy electron-builder --dir trước.`)
  process.exit(1)
}

const dataDir = join(mkdtempSync(join(tmpdir(), 'ng-smoke-')), 'Đồ án', 'data')
const r = spawnSync(bin, [], {
  env: { ...process.env, NEXGRAPH_SMOKE: '1', NEXGRAPH_DATA_DIR: dataDir },
  encoding: 'utf8',
  timeout: 90_000
})
if (r.stdout?.includes('SMOKE OK')) {
  console.log(r.stdout.trim().split('\n').find((l) => l.includes('SMOKE OK')))
  process.exit(0)
}
console.error('SMOKE không đạt')
console.error('stdout:', r.stdout)
console.error('stderr:', r.stderr)
process.exit(1)
