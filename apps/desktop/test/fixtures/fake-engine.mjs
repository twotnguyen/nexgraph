// Engine giả để test launcher. Hành vi theo FAKE_MODE: ok | never-ready | crash-before-ready | crash-after-ready
import http from 'node:http'

const mode = process.env.FAKE_MODE ?? 'ok'
const token = process.env.NEXGRAPH_TOKEN

if (mode === 'never-ready') {
  setInterval(() => {}, 1000)
} else if (mode === 'crash-before-ready') {
  process.stderr.write('boom\n')
  process.exit(3)
} else {
  console.log('warming up…')
  const server = http.createServer((req, res) => {
    const json = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.headers.authorization !== `Bearer ${token}`) return json(401, { error: { code: 'unauthorized', message: 'x' } })
    if (req.url === '/v1/health') {
      return json(200, { status: 'ok', api_version: '1', engine_version: '0.0.0-fake', graphify_commit: 'fake', argv: process.argv })
    }
    return json(404, { error: { code: 'not_found', message: req.url } })
  })
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    console.log(JSON.stringify({ event: 'ready', port, pid: process.pid }))
    if (mode === 'crash-after-ready') setTimeout(() => process.exit(5), 100)
  })
}
