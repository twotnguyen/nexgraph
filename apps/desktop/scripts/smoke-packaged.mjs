// Không đối số: kiểm app đã giải nén. --installer <path>: cài hoặc chép app từ bộ cài đó rồi kiểm.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFakeLlm } from './fake-llm.mjs'
import { smokeInstaller } from './installer-smoke.mjs'

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

async function smoke(bin, temp) {
  const server = createFakeLlm()
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const result = await new Promise((resolve, reject) => {
      const child = spawn(bin, [], {
        cwd: temp,
        env: { ...process.env, NEXGRAPH_SMOKE: '1', NEXGRAPH_DATA_DIR: join(temp, 'Đồ án', 'data'),
          NEXGRAPH_USER_DATA_DIR: join(temp, 'user-data'),
          // Máy chủ LLM giả trên loopback dùng cờ dev để cho phép HTTP.
          NEXGRAPH_ALLOW_HTTP_PROVIDER: '1',
          NEXGRAPH_SMOKE_LLM_URL: `http://127.0.0.1:${server.address().port}/v1` }
      })
      let stdout = '', stderr = ''
      child.stdout.setEncoding('utf8').on('data', (c) => { stdout += c })
      child.stderr.setEncoding('utf8').on('data', (c) => { stderr += c })
      const timer = setTimeout(() => child.kill('SIGKILL'), 95_000)
      child.on('error', (err) => { clearTimeout(timer); reject(err) })
      child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
    })
    const line = result.stdout.split('\n').find((s) => s.includes('SMOKE OK') && s.includes('fs=OK agent=OK index=OK edit_policy=OK'))
    if (result.code !== 0 || !line) {
      console.error('SMOKE không đạt', result)
      throw new Error(`Smoke thất bại khi chạy ${bin}`)
    }
    console.log(line)
  } finally {
    if (server.listening) {
      const closed = new Promise((resolve) => server.close(resolve))
      server.closeAllConnections()
      await closed
    }
  }
}

const args = process.argv.slice(2)
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--installer' || !args[1])) {
  throw new Error('Cách dùng: node apps/desktop/scripts/smoke-packaged.mjs [--installer <đường dẫn>]')
}

const temp = realpathSync(mkdtempSync(join(tmpdir(), 'ng-smoke-')))
try {
  if (args.length) {
    const installer = resolve(args[1])
    console.log(`Kiểm bộ cài: ${installer}`)
    await smokeInstaller(installer, temp, (bin) => smoke(bin, temp))
  } else {
    const bin = findBinary()
    if (!bin) throw new Error(`Không thấy bản đóng gói trong ${dist}. Chạy electron-builder --dir trước.`)
    await smoke(bin, temp)
  }
} finally {
  rmSync(temp, { recursive: true, force: true })
}
