import ELK from 'elkjs/lib/elk.bundled.js'
import { describe, expect, it } from 'vitest'
import { layoutGraph, toElkGraph, type LayoutRunner } from './elkLayoutService'

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
