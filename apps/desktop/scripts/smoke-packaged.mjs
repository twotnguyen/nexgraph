// Chạy bản đóng gói đã giải nén với NEXGRAPH_SMOKE=1 và đường dẫn data có dấu tiếng Việt.
// Exit 0 nếu stdout có "SMOKE OK", ngược lại in stdout/stderr và exit 1.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFakeLlm } from './fake-llm.mjs'

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

const temp = mkdtempSync(join(tmpdir(), 'ng-smoke-'))
const server = createFakeLlm()
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
try {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(bin, [], {
      env: { ...process.env, NEXGRAPH_SMOKE: '1', NEXGRAPH_DATA_DIR: join(temp, 'Đồ án', 'data'),
        NEXGRAPH_USER_DATA_DIR: join(temp, 'user-data'),
        // Fake LLM chạy trên loopback: cần cờ dev cho phép HTTP (mặc định chỉ HTTPS, ADR 0013).
        NEXGRAPH_ALLOW_HTTP_PROVIDER: '1',
        NEXGRAPH_SMOKE_LLM_URL: `http://127.0.0.1:${server.address().port}/v1` }
    })
    let stdout = '', stderr = ''
    child.stdout.on('data', (c) => { stdout += c })
    child.stderr.on('data', (c) => { stderr += c })
    const timer = setTimeout(() => child.kill('SIGKILL'), 95_000)
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
  })
  const line = result.stdout.split('\n').find((s) => s.includes('SMOKE OK') && s.includes('fs=OK agent=OK'))
  if (result.code !== 0 || !line) {
    console.error('SMOKE không đạt', result)
    process.exitCode = 1
  } else console.log(line)
} finally {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  rmSync(temp, { recursive: true, force: true })
}
