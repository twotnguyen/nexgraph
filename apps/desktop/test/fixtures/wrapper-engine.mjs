// Wrapper exits before its worker closes the listening socket and inherited stdio.
import { spawn } from 'node:child_process'
import http from 'node:http'
import { fileURLToPath } from 'node:url'

if (process.argv.includes('--worker')) {
  const server = http.createServer((_request, response) => response.end('ready'))
  server.listen(0, '127.0.0.1', () => {
    console.log(JSON.stringify({ event: 'ready', port: server.address().port, pid: process.pid }))
  })
  process.stdin.resume()
  process.stdin.once('end', () => {
    setTimeout(() => server.close(() => process.exit(0)), 150)
  })
} else {
  const worker = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker'], {
    stdio: ['pipe', 'inherit', 'inherit'],
    windowsHide: true
  })
  process.stdin.resume()
  process.stdin.once('end', () => {
    worker.stdin.end()
    process.exit(0)
  })
}
