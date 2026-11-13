// Engine giả để test launcher. Hành vi theo FAKE_MODE: ok | never-ready | crash-before-ready | crash-after-ready
import http from 'node:http'

const mode = process.env.FAKE_MODE ?? 'ok'
const token = process.env.NEXGRAPH_TOKEN

// `mcp --http`: in dòng ready rồi trả lại key nhận qua biến môi trường (test McpHttpManager).
if (process.argv.includes('mcp') && process.argv.includes('--http')) {
  const key = process.env.NEXGRAPH_MCP_KEY ?? ''
  if (process.env.FAKE_MCP_IGNORE_TERM === '1') process.on('SIGTERM', () => {}) // như uvicorn chờ luồng SSE mãi
  const wanted = Number(process.argv[process.argv.indexOf('--port') + 1])
  const server = http.createServer((req, res) => {
    res.writeHead(req.headers['x-api-key'] === key ? 200 : 401, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ argv: process.argv.slice(2) }))
  })
  server.on('error', () => process.exit(1)) // cổng đã bị chiếm
  server.listen(wanted, '127.0.0.1', () => console.log(JSON.stringify({ event: 'ready', port: server.address().port, pid: process.pid })))
} else

if (mode === 'never-ready') {
  setInterval(() => {}, 1000)
} else if (mode === 'crash-before-ready') {
  process.stderr.write('boom\n')
  process.exit(3)
} else {
  console.log('warming up…')
  const sseClients = new Set()
  let refreshCount = 0
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
      return json(200, { status: 'ok', api_version: '1', engine_version: '0.0.0-fake', vendor_commit: 'fake', argv: process.argv })
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
        setTimeout(() => {
          res.write(second.slice(10))
          res.write('data: ' + JSON.stringify({ type: 'changes_updated', project_id: 'p1' }) + '\n\n')
        }, 20)
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
    if (url.pathname === '/v1/tools') return json(200, { ffmpeg: true, faster_whisper: false, git: true, gh: false, yt_dlp: false })
    if (url.pathname === '/v1/projects') return json(200, [{ project_id: 'p1', path: '/demo', name: 'demo', is_git: false, storage: 'in_project', last_indexed_at: null, last_index_commit: null }])
    const ECHO = ['/v1/projects/p1/report', '/v1/projects/p1/paths', '/v1/projects/p1/impact', '/v1/projects/p1/ask',
      '/v1/projects/p1/communities', '/v1/projects/p1/export', '/v1/projects/p1/export/push']
    if (ECHO.includes(url.pathname)) {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => json(200, { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams),
        body: body ? JSON.parse(body) : null }))
      return
    }
    if (url.pathname === '/v1/projects/p1/index' && req.method === 'POST') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => json(202, { job_id: 'j1', received_body: body ? JSON.parse(body) : null }))
      return
    }
    if (url.pathname === '/v1/projects/p1/search') {
      const q = url.searchParams.get('q') ?? ''
      if (q === '"') return json(400, { error: { code: 'bad_param', message: 'Cần ít nhất một từ để tìm kiếm' } })
      if (q === 'nope') return json(200, [])
      return json(200, [{ node: node('lib/a.dart#file'), score: 2.5 }, { node: node('lib/b.dart#file'), score: 1.2 }].map((h) => ({ ...h, query: Object.fromEntries(url.searchParams) })))
    }
    if (url.pathname === '/v1/projects/p1/architecture') {
      const parent = url.searchParams.get('parent')
      if (parent === 'dir:nope') return json(404, { error: { code: 'unknown_block', message: 'Không có khối dir:nope' } })
      return json(200, {
        parent: parent ? { id: parent, label: parent.split('/').pop() } : null,
        blocks: [{ id: 'dir:lib', label: 'lib', kind: 'directory', size: 8, symbols: 30, drillable: true },
                 { id: 'file:lib/main.dart', label: 'main.dart', kind: 'file', size: 1, symbols: 2, drillable: false }],
        links: [{ from: 'dir:lib', to: 'file:lib/main.dart', count: 3, types: { CALLS: 2, IMPORTS: 1 } }],
        received_parent: parent
      })
    }
    if (url.pathname === '/v1/projects/p1/architecture/evidence') {
      const edge = { id: 1, source: 'a', target: 'b', type: 'CALLS', subtype: null, confidence: 'INFERRED', confidence_score: 0.9, origin: 'resolver', evidence: { file: 'lib/a.dart', line: 12, col: 4 } }
      if (url.searchParams.get('from') === 'dir:nope') return json(404, { error: { code: 'unknown_block', message: 'x' } })
      return json(200, [{ edge, file: url.search, line: 12 }])
    }
    if (url.pathname === '/v1/projects/p1/scan') {
      return json(200, { files: 12345, by_language: { dart: 12000 }, large: true, threshold: 5000,
        top_dirs: [{ path: 'lib', files: 9000 }, { path: 'lib/Đồ án', files: 3000 }] })
    }
    if (url.pathname === '/v1/projects/p1/refresh' && req.method === 'POST') {
      refreshCount += 1
      return json(200, { status: 'ok', reason: null, added: 0, changed: 1, removed: 0, seconds: 0.01, received_count: refreshCount })
    }
    if (url.pathname === '/v1/projects/p1/changes') {
      return json(200, { base: 'git_head', base_commit: 'a'.repeat(40), note: null,
        changed_files: [{ path: 'lib/a.dart', status: 'M', old_path: null }],
        changed_nodes: [node('lib/a.dart::f#function')], impacted: [{ node: node('lib/b.dart::g#function'), score: 1, hops: 1 }],
        tests: [], test_gaps: [], truncated: false, query: Object.fromEntries(url.searchParams) })
    }
    if (url.pathname === '/v1/projects/unknown/changes' || url.pathname === '/v1/projects/nope/changes') return json(404, { error: { code: 'unknown_project', message: 'x' } })
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
