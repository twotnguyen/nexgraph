// NG-UI-1: protocol phục vụ `.nexgraph/` an toàn, thư viện cục bộ, CSP, rebrand.
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PAGE_CSP, VIS_INTEGRITY, discoverGraphPages, handlePageRequest, handleWebRequest,
  injectCsp, isAllowedRequest, lineFromSourceLocation, localLibFor, readGraphJsonIndex, rebrandHtml, resolveGraphPage
} from '../src/main/graph-pages/pages'

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'ng-pages-'))
  const dir = join(root, '.nexgraph')
  mkdirSync(dir)
  writeFileSync(join(dir, 'graph.html'), '<!DOCTYPE html><html><head><title>graphify - graphify-out/graph.html</title></head><body><h1>Graphify Graph</h1><script>const brand = "Graphify";</script></body></html>')
  writeFileSync(join(dir, 'GRAPH_TREE.html'), '<html><head><title>/ — graphify tree viewer</title></head><body><h1>/ — Knowledge Graph</h1></body></html>')
  writeFileSync(join(dir, 'demo-callflow.html'), '<html><head><title>demo — Call Flow</title></head><body></body></html>')
  writeFileSync(join(dir, 'graph.json'), '{"nodes":[]}')
  writeFileSync(join(root, 'secret.txt'), 'outside')
  return { root, dir }
}

const libs = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ng-libs-'))
  writeFileSync(join(dir, 'vis-network-9.1.6.min.js'), readFileSync(new URL('../resources/graph-pages/vis-network-9.1.6.min.js', import.meta.url)))
  writeFileSync(join(dir, 'd3.v7.min.js'), readFileSync(new URL('../resources/graph-pages/d3.v7.min.js', import.meta.url)))
  writeFileSync(join(dir, 'mermaid-11.min.js'), readFileSync(new URL('../resources/graph-pages/mermaid-11.min.js', import.meta.url)))
  return dir
}

const roots = (pid: string, root: string) => new Map([[pid, root]])

describe('khám phá trang trong .nexgraph', () => {
  it('báo trang nào có mặt; tên callflow lấy theo tệp thật', async () => {
    const { root } = fixture()
    await expect(discoverGraphPages(root)).resolves.toEqual({ graph: true, tree: true, callflow: 'demo-callflow.html', dir: join(root, '.nexgraph') })
  })

  it('dự án chưa có .nexgraph → không trang nào (R-N3)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ng-empty-'))
    await expect(discoverGraphPages(root)).resolves.toMatchObject({ graph: false, tree: false, callflow: null })
  })
})

describe('đường dẫn trang trong .nexgraph', () => {
  it('nhận tệp nằm trong .nexgraph', async () => {
    const { root, dir } = fixture()
    // macOS: /tmp là symlink tới /private/tmp — so bằng realpath như mọi test đường dẫn khác.
    await expect(resolveGraphPage(root, 'graph.html')).resolves.toBe(await realpath(join(dir, 'graph.html')))
  })

  it('chặn traversal và symlink ra ngoài', async () => {
    const { root, dir } = fixture()
    await expect(resolveGraphPage(root, '../secret.txt')).resolves.toBeNull()
    await expect(resolveGraphPage(root, '..%2Fsecret.txt')).resolves.toBeNull()
    await expect(resolveGraphPage(root, '/etc/passwd')).resolves.toBeNull()
    symlinkSync(join(root, 'secret.txt'), join(dir, 'leak.html'))
    await expect(resolveGraphPage(root, 'leak.html')).resolves.toBeNull()
  })
})

describe('rebrand + CSP ở lớp phục vụ (ADR 0025)', () => {
  it('đổi tên hiển thị nhưng không đụng mã trong <script>', () => {
    const out = rebrandHtml('<title>graphify - graphify-out/graph.html</title><h1>Graphify Graph</h1><script>const brand = "Graphify";</script>')
    expect(out).toBe('<title>NexGraph - .nexgraph/graph.html</title><h1>NexGraph Graph</h1><script>const brand = "Graphify";</script>')
  })

  it('chèn meta CSP ngay sau <head>', () => {
    const out = injectCsp('<html><head><meta charset="utf-8"></head><body></body></html>', PAGE_CSP)
    expect(out).toContain(`<head><meta http-equiv="Content-Security-Policy" content="${PAGE_CSP.replace(/"/g, '&quot;')}">`)
  })
})

describe('chỉ mục graph.json cho cầu nối chọn nút', () => {
  it('id Graphify → tệp:dòng, đọc lại theo mtime', async () => {
    const { root, dir } = fixture()
    writeFileSync(join(dir, 'graph.json'), JSON.stringify({ nodes: [
      { id: 'src_service_order_createorder', source_file: 'src/service/order.ts', source_location: 'L5' },
      { id: 'no_source', label: 'x' }
    ] }))
    const index = await readGraphJsonIndex(root)
    expect(index.get('src_service_order_createorder')).toEqual({ file: 'src/service/order.ts', line: 5 })
    expect(index.get('no_source')).toEqual({ file: null, line: null })
    expect(index.get('missing')).toBeUndefined()
    expect(lineFromSourceLocation('L12-L20')).toBe(12)
    expect(lineFromSourceLocation('src/a.ts:L44')).toBe(44)
    expect(lineFromSourceLocation(null)).toBeNull()
  })

  it('không có graph.json → chỉ mục rỗng, không ném', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ng-nograph-'))
    await expect(readGraphJsonIndex(root)).resolves.toEqual(new Map())
  })
})

describe('phục vụ trang qua scheme riêng', () => {
  it('200 + CSP + đổi tên, chỉ đọc trong .nexgraph', async () => {
    const { root } = fixture()
    const res = await handlePageRequest('nxpage://pid-1/graph.html', { roots: roots('pid-1', root), libsDir: libs() })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('http-equiv="Content-Security-Policy"')
    expect(html).toContain('<title>NexGraph - .nexgraph/graph.html</title>')
    expect(html).not.toContain('<title>graphify')
  })

  it('404 cho tệp không có, 403 cho dự án lạ và traversal', async () => {
    const { root } = fixture()
    const opts = { roots: roots('pid-1', root), libsDir: libs() }
    expect((await handlePageRequest('nxpage://pid-1/missing.html', opts)).status).toBe(404)
    expect((await handlePageRequest('nxpage://pid-2/graph.html', opts)).status).toBe(403)
    expect((await handlePageRequest('nxpage://pid-1/..%2Fsecret.txt', opts)).status).toBe(403)
    expect((await handlePageRequest('nxpage://pid-1/%2e%2e%2fsecret.txt', opts)).status).toBe(403)
  })

  it('chỉ phục vụ đuôi tệp cho phép', async () => {
    const { root } = fixture()
    const opts = { roots: roots('pid-1', root), libsDir: libs() }
    expect((await handlePageRequest('nxpage://pid-1/graph.json', opts)).status).toBe(200)
    expect((await handlePageRequest('nxpage://pid-1/graph.json', opts)).headers.get('content-type')).toContain('application/json')
  })
})

describe('3 URL CDN trả từ thư viện đóng gói, còn lại chặn', () => {
  it('ánh xạ đúng URL Graphify sinh ra', () => {
    expect(localLibFor('https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js')).toBe('vis-network-9.1.6.min.js')
    expect(localLibFor('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js')).toBe('mermaid-11.min.js')
    expect(localLibFor('https://d3js.org/d3.v7.min.js')).toBe('d3.v7.min.js')
    expect(localLibFor('https://unpkg.com/vis-network@9.1.7/standalone/umd/vis-network.min.js')).toBeNull()
    expect(localLibFor('https://example.com/x.js')).toBeNull()
  })

  it('vis-network phải byte-identical để SRI của trang khớp', () => {
    const bytes = readFileSync(new URL('../resources/graph-pages/vis-network-9.1.6.min.js', import.meta.url))
    const digest = createHash('sha384').update(bytes).digest('base64')
    expect(digest).toBe(VIS_INTEGRITY)
  })

  it('trả bản cục bộ kèm CORS cho SRI; URL lạ 403', async () => {
    const libsDir = libs()
    const ok = await handleWebRequest('https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js', { libsDir })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('access-control-allow-origin')).toBe('*')
    expect((ok.headers.get('content-type') ?? '')).toContain('javascript')
    expect(Buffer.from(await ok.arrayBuffer()).length).toBeGreaterThan(700_000)
    const bad = await handleWebRequest('https://example.com/a.js', { libsDir })
    expect(bad.status).toBe(403)
  })

  it('allowlist lớp webRequest: nxpage + 3 URL, ngoài ra cancel', () => {
    expect(isAllowedRequest('nxpage://pid-1/graph.html')).toBe(true)
    expect(isAllowedRequest('devtools://devtools/bundled/inspector.html')).toBe(true)
    expect(isAllowedRequest('https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js')).toBe(true)
    expect(isAllowedRequest('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js')).toBe(true)
    expect(isAllowedRequest('https://d3js.org/d3.v7.min.js')).toBe(true)
    expect(isAllowedRequest('https://example.com/track.js')).toBe(false)
    expect(isAllowedRequest('http://127.0.0.1:9999/x')).toBe(false)
    expect(isAllowedRequest('file:///etc/passwd')).toBe(false)
  })
})
