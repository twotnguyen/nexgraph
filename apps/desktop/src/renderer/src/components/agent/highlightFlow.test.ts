// F4 mục 4 (A2-F5): "Tô luồng trên graph" phải tô các nút được trích dẫn kể cả khi không có cạnh trực tiếp.
import { describe, expect, it } from 'vitest'
import type { Citation, GraphEdge, GraphNode, PathResult } from '@nexgraph/contracts/graph-types'
import { highlightFlow } from './highlightFlow'

const node = (id: string): GraphNode => ({
  id, kind: 'function', label: id, qualified_name: id, language: 'dart', file: `${id}.dart`,
  line_start: 1, line_end: 3, is_test: false, origin: 'code', signature: null, community: null
})
const edge = (id: number, source: string, target: string): GraphEdge => ({
  id, source, target, type: 'CALLS', subtype: null, confidence: 'EXTRACTED', confidence_score: 0, origin: 'code', evidence: null
})
const cite = (file: string, start = 1): Citation => ({ raw: `${file}:${start}`, file, start, end: start, valid: true, reason: null })

const deps = (paths: (ids: string[]) => PathResult) => ({
  locate: async (_p: string, file: string) => ({ node: node(file) }),
  paths: async (_p: string, ids: string[]) => paths(ids)
})

describe('highlightFlow', () => {
  it('nối được chuỗi nút: trả nút + cạnh, không có ghi chú', async () => {
    const result = await highlightFlow('p1', [cite('a'), cite('b'), cite('c')], deps(([x, y]) => ({
      nodes: [node(x), node(y)], edges: [edge(x === 'a' ? 1 : 2, x, y)], unconnected: []
    })))
    expect(result.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c'])
    expect(result.edges.map((e) => e.id)).toEqual([1, 2])
    expect(result.note).toBeNull()
  })

  it('một cặp không nối trực tiếp: vẫn tô cả 3 nút và các cạnh tìm được, ghi chú nói rõ', async () => {
    const result = await highlightFlow('p1', [cite('a'), cite('b'), cite('c')], deps(([x, y]) => x === 'a' && y === 'b'
      ? { nodes: [node(x), node(y)], edges: [], unconnected: [y] }
      : { nodes: [node(x), node(y)], edges: [edge(7, x, y)], unconnected: [] }))
    expect(result.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c'])
    expect(result.edges.map((e) => e.id)).toEqual([7])
    expect(result.note).toMatch(/Tô 3 nút được trích dẫn/)
    expect(result.note).toMatch(/1 cặp không có liên kết trực tiếp/)
  })

  it('không nối được cặp nào: vẫn trả các nút được trích dẫn, cạnh rỗng', async () => {
    const result = await highlightFlow('p1', [cite('a'), cite('b')], deps(([x, y]) => ({
      nodes: [node(x), node(y)], edges: [], unconnected: [y]
    })))
    expect(result.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(result.edges).toEqual([])
    expect(result.note).toMatch(/Tô 2 nút được trích dẫn/)
  })

  it('thử nối với mọi nút đã có, không chỉ nút liền trước', async () => {
    const calls: string[][] = []
    const result = await highlightFlow('p1', [cite('a'), cite('b'), cite('c')], {
      locate: async (_p: string, file: string) => ({ node: node(file) }),
      paths: async (_p: string, ids: string[]) => {
        calls.push(ids)
        return ids[0] === 'a' && ids[1] === 'b'
          ? { nodes: ids.map(node), edges: [], unconnected: [ids[1]] }
          : { nodes: ids.map(node), edges: [edge(9, ids[0], ids[1])], unconnected: [] }
      }
    })
    expect(calls).toContainEqual(['b', 'c'])
    expect(result.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c'])
    expect(result.edges.map((e) => e.id)).toEqual([9])
  })

  it('ít hơn 2 trích dẫn hợp lệ: không tô, nhắc cần ít nhất hai', async () => {
    const result = await highlightFlow('p1', [cite('a'), { ...cite('b'), valid: false }], deps(() => ({ nodes: [], edges: [], unconnected: [] })))
    expect(result).toMatchObject({ nodes: [], edges: [], note: expect.stringMatching(/ít nhất hai trích dẫn/) })
  })

  it('bỏ qua trích dẫn không định vị được trong graph', async () => {
    const result = await highlightFlow('p1', [cite('a'), cite('b'), cite('c')], {
      locate: async (_p: string, file: string) => {
        if (file === 'b') throw new Error('không có trong đồ thị')
        return { node: node(file) }
      },
      paths: async (_p: string, ids: string[]) => ({ nodes: ids.map(node), edges: [edge(3, ids[0], ids[1])], unconnected: [] })
    })
    expect(result.nodes.map((n) => n.id)).toEqual(['a', 'c'])
    expect(result.edges.map((e) => e.id)).toEqual([3])
  })
})
