// Không đối số: kiểm app đã giải nén. --installer <path>: cài hoặc chép app từ bộ cài đó rồi kiểm.
// --disable-webgl: khởi động Chromium với WebGL tắt và kiểm lối xem Kiến trúc trong giao diện thật.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
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

async function smoke(bin, temp, disableWebgl) {
  const sourceParent = join(temp, 'Nguồn dự án NexGraph với thư mục dài và có dấu')
  mkdirSync(sourceParent)
  let droppedRequests = 0
  const server = createFakeLlm({
    dropRequest(url) {
      // Chỉ ngắt kết nối tới đích giả lập. Engine trên loopback vẫn hoạt động.
      if (!url?.startsWith('/offline/')) return false
      droppedRequests++
      return true
    }
  })
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const result = await new Promise((resolve, reject) => {
      const child = spawn(bin, disableWebgl ? ['--disable-webgl'] : [], {
        cwd: temp,
        env: { ...process.env, NEXGRAPH_SMOKE: '1', NEXGRAPH_DATA_DIR: join(temp, 'Đồ án', 'data'),
          NEXGRAPH_USER_DATA_DIR: join(temp, 'user-data'),
          NEXGRAPH_SMOKE_SOURCE_PARENT: sourceParent,
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
    const line = result.stdout.split('\n').find((s) => s.includes('SMOKE OK') &&
      s.includes('fs=OK agent=OK index=OK edit_policy=OK acceptance=OK workspace_controls=OK') &&
      (!disableWebgl || s.includes('webgl_fallback=OK')))
    const stopped = /^SMOKE ENGINE STOPPED pid=([1-9]\d*)\r?$/m.exec(result.stdout)
    if (result.code !== 0 || !line || !stopped || droppedRequests === 0) {
      console.error('SMOKE không đạt', { ...result, droppedRequests })
      throw new Error(`Smoke thất bại khi chạy ${bin}`)
    }
    const pid = Number(stopped[1])
    try {
      process.kill(pid, 0)
      throw new Error(`Engine của smoke còn chạy với PID ${pid}`)
    } catch (err) {
      if (err.code !== 'ESRCH') throw err
    }
    console.log(line.trim())
    console.log(stopped[0].trim())
  } finally {
    if (server.listening) {
      const closed = new Promise((resolve) => server.close(resolve))
      server.closeAllConnections()
      await closed
    }
  }
}

const commandLine = process.argv.slice(2)
const args = commandLine.filter((arg) => arg !== '--disable-webgl')
const disableWebgl = args.length !== commandLine.length
if (commandLine.length - args.length > 1 || (args.length !== 0 && (args.length !== 2 || args[0] !== '--installer' || !args[1]))) {
  throw new Error('Cách dùng: node apps/desktop/scripts/smoke-packaged.mjs [--installer <đường dẫn>] [--disable-webgl]')
}

const temp = realpathSync(mkdtempSync(join(tmpdir(), 'ng-smoke-')))
try {
  if (args.length) {
    const installer = resolve(args[1])
    console.log(`Kiểm bộ cài: ${installer}`)
    await smokeInstaller(installer, temp, (bin) => smoke(bin, temp, disableWebgl))
  } else {
    const bin = findBinary()
    if (!bin) throw new Error(`Không thấy bản đóng gói trong ${dist}. Chạy electron-builder --dir trước.`)
    await smoke(bin, temp, disableWebgl)
  }
} finally {
  rmSync(temp, { recursive: true, force: true })
}
