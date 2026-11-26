// NG-ACT-2: trang cộng đồng sinh từ `<root>/.nexgraph/graph.json` — đọc/lọc an toàn, giới hạn,
// phục vụ qua `nxpage://` để dùng lại cầu nối chọn nút của #68.
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  COMMUNITY_NODE_LIMIT, COMMUNITY_PAGE_FILE, handlePageRequest, readGraphJsonCommunity, renderCommunityPage
} from '../src/main/features/graph-pages/pages'
import { communityPageUrl } from '@nexgraph/contracts/graph-pages'

const graphFile = (nodes: unknown[], links: unknown[]) => JSON.stringify({ directed: false, nodes, links })

const project = (graph: string | null) => {
  const root = mkdtempSync(join(tmpdir(), 'ng-community-'))
  const dir = join(root, '.nexgraph')
  mkdirSync(dir)
  if (graph !== null) writeFileSync(join(dir, 'graph.json'), graph)
  return { root, dir }
}

const member = (id: string, community: number | string, over: Record<string, unknown> = {}) => ({
  id, label: `fn ${id}`, community, community_name: 'Thanh toán', source_file: `src/${id}.ts`,
  source_location: 'L7', file_type: 'code', ...over
})

describe('lọc cộng đồng từ graph.json', () => {
  it('chỉ trả thành viên của cộng đồng + cạnh giữa chúng, kèm tên và bậc', async () => {
    const nodes = [
      member('a', 1), member('b', 2), member('c', 1), member('d', '1', { community_name: null }),
      { id: 'no-community', label: 'x' }
    ]
    const links = [
      { source: 'a', target: 'c', relation: 'calls' },
      { source: 'a', target: 'b', relation: 'imports' },
      { source: 'c', target: 'd' },
      { source: 'a', target: 'missing' }
    ]
    const { root } = project(graphFile(nodes, links))
    const graph = await readGraphJsonCommunity(root, 1)
    expect(graph).not.toBeNull()
    expect(graph!.community).toBe(1)
    expect(graph!.name).toBe('Thanh toán')
    expect(graph!.total).toBe(3)
    expect(graph!.truncated).toBe(false)
    expect(graph!.nodes.map((n) => n.id).sort()).toEqual(['a', 'c', 'd'])
    expect(graph!.nodes.find((n) => n.id === 'd')!.name ?? null).toBeNull()
    expect(graph!.edges).toEqual([
      { from: 'a', to: 'c', relation: 'calls' },
      { from: 'c', to: 'd', relation: null }
    ])
    expect(graph!.nodes.find((n) => n.id === 'a')!.degree).toBe(2)
  })

  it('giới hạn ~2.000 nút, ưu tiên bậc cao, báo truncated + tổng', async () => {
    const nodes = Array.from({ length: COMMUNITY_NODE_LIMIT + 50 }, (_, i) => member(`n${i}`, 7))
    nodes.push(member('other', 8))
    // n0..n49 nối thành chuỗi để có bậc khác nhau; phần còn lại đứng riêng.
    const links = nodes.slice(0, 49).map((_, i) => ({ source: `n${i}`, target: `n${i + 1}` }))
    const { root } = project(graphFile(nodes, links))
    const graph = await readGraphJsonCommunity(root, 7)
    expect(graph!.nodes).toHaveLength(COMMUNITY_NODE_LIMIT)
    expect(graph!.total).toBe(COMMUNITY_NODE_LIMIT + 50)
    expect(graph!.truncated).toBe(true)
    expect(graph!.nodes.slice(0, 3).map((n) => n.id)).toEqual(['n1', 'n10', 'n11'])
    for (const edge of graph!.edges) {
      expect(graph!.nodes.some((n) => n.id === edge.from)).toBe(true)
      expect(graph!.nodes.some((n) => n.id === edge.to)).toBe(true)
    }
  })

  it('cộng đồng không tồn tại / graph.json hỏng / không có graph.json → null, không ném', async () => {
    const { root } = project(graphFile([member('a', 1)], []))
    await expect(readGraphJsonCommunity(root, 99)).resolves.toBeNull()
    const corrupt = project('{ not json')
    await expect(readGraphJsonCommunity(corrupt.root, 1)).resolves.toBeNull()
    const none = project(null)
    await expect(readGraphJsonCommunity(none.root, 1)).resolves.toBeNull()
    await expect(readGraphJsonCommunity(project(graphFile([member('a', 1)], [])).root, -1)).resolves.toBeNull()
    await expect(readGraphJsonCommunity(project(graphFile([member('a', 1)], [])).root, Number.NaN)).resolves.toBeNull()
  })
})

describe('phục vụ trang cộng đồng qua nxpage://', () => {
  const opts = (root: string) => ({ roots: new Map([['pid-1', root]]), libsDir: '/nonexistent-libs' })

  it('sinh HTML có thư viện đóng gói, ô tìm, Node info, showInfo và dữ liệu thành viên', async () => {
    const { root } = project(graphFile([member('a', 1), member('b', 1), member('c', 2)], [{ source: 'a', target: 'b', relation: 'calls' }]))
    const res = await handlePageRequest(`nxpage://pid-1/${COMMUNITY_PAGE_FILE}?c=1`, opts(root))
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('http-equiv="Content-Security-Policy"')
    expect(html).toContain('https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js')
    expect(html).toContain('id="search"')
    expect(html).toContain('id="info-content"')
    expect(html).toContain('function showInfo')
    expect(html).toContain('"a"')
    expect(html).not.toContain('"c"')
    expect(communityPageUrl('pid-1', 1)).toBe('nxpage://pid-1/community.html?c=1')
  })

  it('nhãn chứa </script> không phá trang (escape trong JSON)', async () => {
    const { root } = project(graphFile([member('a', 1, { label: 'x</script><script>alert(1)</script>' })], []))
    const html = await handlePageRequest(`nxpage://pid-1/${COMMUNITY_PAGE_FILE}?c=1`, opts(root)).then((r) => r.text())
    expect(html).not.toContain('x</script><script>alert(1)</script>')
    expect(html).toContain('x\\u003c/script')
  })

  it('thiếu c → 400, cộng đồng lạ → 404, graph.json hỏng → 404, dự án lạ → 403', async () => {
    const { root } = project(graphFile([member('a', 1)], []))
    expect((await handlePageRequest(`nxpage://pid-1/${COMMUNITY_PAGE_FILE}`, opts(root))).status).toBe(400)
    expect((await handlePageRequest(`nxpage://pid-1/${COMMUNITY_PAGE_FILE}?c=abc`, opts(root))).status).toBe(400)
    expect((await handlePageRequest(`nxpage://pid-1/${COMMUNITY_PAGE_FILE}?c=9`, opts(root))).status).toBe(404)
    const corrupt = project('{')
    expect((await handlePageRequest(`nxpage://pid-1/${COMMUNITY_PAGE_FILE}?c=1`, opts(corrupt.root))).status).toBe(404)
    expect((await handlePageRequest(`nxpage://pid-2/${COMMUNITY_PAGE_FILE}?c=1`, opts(root))).status).toBe(403)
  })

  it('graph.json hoặc .nexgraph là symlink ra ngoài dự án → không đọc, không dựng trang (cùng containment #68)', async () => {
    const leaked = graphFile([member('a', 1, { label: 'LEAKED' })], [])
    const fileLink = project(null)
    const outside = mkdtempSync(join(tmpdir(), 'ng-outside-'))
    writeFileSync(join(outside, 'secret.json'), leaked)
    symlinkSync(join(outside, 'secret.json'), join(fileLink.dir, 'graph.json'))
    await expect(readGraphJsonCommunity(fileLink.root, 1)).resolves.toBeNull()
    const res = await handlePageRequest(`nxpage://pid-1/${COMMUNITY_PAGE_FILE}?c=1`, opts(fileLink.root))
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('LEAKED')

    const dirLink = mkdtempSync(join(tmpdir(), 'ng-community-'))
    const outsideDir = mkdtempSync(join(tmpdir(), 'ng-outside-'))
    writeFileSync(join(outsideDir, 'graph.json'), leaked)
    symlinkSync(outsideDir, join(dirLink, '.nexgraph'))
    await expect(readGraphJsonCommunity(dirLink, 1)).resolves.toBeNull()
  })

  it('render có tiêu đề NexGraph, bảng màu cộng đồng và thống kê', () => {
    const html = renderCommunityPage({
      community: 3, name: 'Thanh toán', total: 2, truncated: false,
      nodes: [
        { id: 'a', label: 'a', file: 'src/a.ts', line: 1, fileType: 'code', degree: 1, name: 'Thanh toán' },
        { id: 'b', label: 'b', file: null, line: null, fileType: 'document', degree: 0, name: 'Thanh toán' }
      ],
      edges: [{ from: 'a', to: 'b', relation: 'references' }]
    })
    expect(html).toContain('<title>NexGraph')
    expect(html).toContain('#4E79A7')
    expect(html).toContain('2 nodes')
    expect(html).toContain('1 edge')
    expect(html).toContain('Thanh toán')
  })
})
