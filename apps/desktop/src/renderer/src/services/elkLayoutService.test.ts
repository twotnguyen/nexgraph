import ELK from 'elkjs/lib/elk.bundled.js'
import { describe, expect, it } from 'vitest'
import { layoutDiagram, layoutGraph, toElkGraph, type LayoutRunner } from './elkLayoutService'

const elk = new ELK()
const runner: LayoutRunner = (graph) => elk.layout(graph)
const node = (id: string) => ({ id, width: 180, height: 40 })

describe('toElkGraph', () => {
  it('keeps every node and edge', () => {
    const g = toElkGraph([node('a'), node('b')], [{ id: 'e1', source: 'a', target: 'b' }])
    expect(g.children?.map((c) => c.id)).toEqual(['a', 'b'])
    expect(g.edges?.map((e) => e.id)).toEqual(['e1'])
  })

  it('drops edges pointing at unknown nodes', () => {
    const g = toElkGraph([node('a')], [{ id: 'e1', source: 'a', target: 'missing' }])
    expect(g.edges).toEqual([])
  })
})

describe('layoutGraph', () => {
  it('gives every node finite, distinct coordinates (50 nodes, 80 edges)', async () => {
    const nodes = Array.from({ length: 50 }, (_, i) => node(`n${i}`))
    const edges = Array.from({ length: 80 }, (_, i) => ({ id: `e${i}`, source: `n${i % 50}`, target: `n${(i * 7 + 3) % 50}` }))
    const pos = await layoutGraph(nodes, edges, runner)
    expect(Object.keys(pos)).toHaveLength(50)
    const seen = new Set<string>()
    for (const p of Object.values(pos)) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
      seen.add(`${p.x},${p.y}`)
    }
    expect(seen.size).toBe(50)
  })

  it('returns an empty object for an empty graph', async () => {
    expect(await layoutGraph([], [], runner)).toEqual({})
  })

  it('ignores dangling edges instead of throwing', async () => {
    const pos = await layoutGraph([node('a'), node('b')], [{ id: 'e', source: 'a', target: 'ghost' }], runner)
    expect(Object.keys(pos).sort()).toEqual(['a', 'b'])
  })
})

describe('layoutDiagram', () => {
  it('trả tuyến của cạnh: điểm đầu, các điểm rẽ, điểm cuối theo thứ tự', async () => {
    const runner: LayoutRunner = async (g) => ({
      ...g,
      children: g.children?.map((c, i) => ({ ...c, x: i * 100, y: 0 })),
      edges: [{ id: 'e', sources: ['a'], targets: ['b'], sections: [{ id: 's', startPoint: { x: 1, y: 2 }, bendPoints: [{ x: 1, y: 9 }], endPoint: { x: 5, y: 9 } }] }]
    })
    const out = await layoutDiagram([node('a'), node('b')], [{ id: 'e', source: 'a', target: 'b' }], 'layered-down', runner)
    expect(out.pos.b).toEqual({ x: 100, y: 0 })
    expect(out.routes.e).toEqual([{ x: 1, y: 2 }, { x: 1, y: 9 }, { x: 5, y: 9 }])
  })

  it('layered-down xếp lớp từ trên xuống', () => {
    expect(toElkGraph([node('a')], [], 'layered-down').layoutOptions?.['elk.direction']).toBe('DOWN')
  })
})

