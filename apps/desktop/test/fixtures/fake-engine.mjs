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
  const sseClients = new Set()
  const server = http.createServer((req, res) => {
    const json = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.headers.authorization !== `Bearer ${token}`) return json(401, { error: { code: 'unauthorized', message: 'x' } })
    const url = new URL(req.url, 'http://x')
    const node = (id) => ({ id, kind: 'file', label: id, qualified_name: id, language: 'dart', file: id, line_start: null,
      line_end: null, is_test: false, origin: 'ast', signature: null, community: null })
    if (url.pathname === '/v1/health') {
      return json(200, { status: 'ok', api_version: '1', engine_version: '0.0.0-fake', graphify_commit: 'fake', argv: process.argv })
    }
    if (url.pathname === '/v1/selftest') {
      return process.env.FAKE_SELFTEST === 'fail' ? json(200, { ok: false, nodes: 0 }) : json(200, { ok: true, nodes: 2 })
    }
    if (url.pathname === '/v1/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(': ping\n\n')
      sseClients.add(res)
      req.on('close', () => sseClients.delete(res))
      setTimeout(() => {
        res.write('data: ' + JSON.stringify({ type: 'job_progress', job_id: 'j1', project_id: 'p1', state: 'structure', files_done: 1, files_total: 2, message: null }) + '\n\n')
        // sự kiện bị cắt đôi giữa hai gói TCP
        const second = 'data: ' + JSON.stringify({ type: 'graph_updated', project_id: 'p1' }) + '\n\n'
        res.write(second.slice(0, 10))
        setTimeout(() => res.write(second.slice(10)), 20)
      }, 50)
      return
    }
    if (url.pathname === '/v1/projects' && req.method === 'POST') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const { path } = JSON.parse(body)
        if (path === '/missing') return json(400, { error: { code: 'bad_path', message: 'Không phải thư mục' } })
        json(200, { project_id: 'p1', path, name: 'demo', is_git: false, storage: 'in_project' })
      })
      return
    }
    if (url.pathname === '/v1/projects') return json(200, [{ project_id: 'p1', path: '/demo', name: 'demo', is_git: false, storage: 'in_project', last_indexed_at: null, last_index_commit: null }])
    if (url.pathname === '/v1/projects/p1/index' && req.method === 'POST') return json(202, { job_id: 'j1' })
    if (url.pathname === '/v1/jobs/j1' && req.method === 'DELETE') return json(200, { cancelled: true })
    if (url.pathname === '/v1/projects/p1/neighbors') {
      const id = url.searchParams.get('node')
      if (id === 'nope') return json(404, { error: { code: 'unknown_node', message: 'Không có nút nope' } })
      return json(200, { nodes: [node(id), node('b')], edges: [], truncated: false, query: Object.fromEntries(url.searchParams) })
    }
    if (url.pathname.startsWith('/v1/projects/p1/nodes/')) return json(200, node(decodeURIComponent(url.pathname.slice('/v1/projects/p1/nodes/'.length))))
    if (url.pathname === '/v1/projects/p1/stats') return json(200, { files: 1, nodes_by_kind: {}, edges_by_type: {}, languages: {}, unresolved: 0 })
    if (url.pathname === '/v1/projects/p1/code') return json(200, { file: url.searchParams.get('file'), start: 1, end: 1, text: 'x', language: 'dart', stale: false })
    return json(404, { error: { code: 'not_found', message: req.url } })
  })
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    console.log(JSON.stringify({ event: 'ready', port, pid: process.pid }))
    if (mode === 'crash-after-ready') setTimeout(() => process.exit(5), 100)
  })
}
