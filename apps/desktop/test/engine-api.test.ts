import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EngineApi, EngineApiError } from '../src/main/engine/api'
import { subscribeEvents } from '../src/main/engine/events'
import { startEngine, type EngineHandle } from '../src/main/engine/launcher'
import { toIpcResult } from '../src/main/ipc-result'
import type { EngineEvent } from '../src/shared/graph-types'

const fake = {
  command: process.execPath,
  args: [fileURLToPath(new URL('./fixtures/fake-engine.mjs', import.meta.url))]
}
let h: EngineHandle
let api: EngineApi

beforeEach(async () => {
  h = await startEngine(fake, { dataDir: mkdtempSync(join(tmpdir(), 'ng-')), env: { ...process.env, FAKE_MODE: 'ok' } })
  api = new EngineApi(h)
})
afterEach(async () => h.stop())

describe('EngineApi', () => {
  it('opens a project with a unicode path intact', async () => {
    const p = await api.openProject('/Đồ án/ứng dụng app')
    expect(p.project_id).toBe('p1')
    expect(p.path).toBe('/Đồ án/ứng dụng app')
  })

  it('lists projects and starts/cancels jobs', async () => {
    expect((await api.listProjects())[0].name).toBe('demo')
    expect(await api.startIndex('p1')).toMatchObject({ job_id: 'j1' })
    expect(await api.cancelJob('j1')).toEqual({ cancelled: true })
  })

  it('sends neighbors query with comma-joined types', async () => {
    const r = (await api.neighbors('p1', { node: 'lib/a.dart#file', types: ['CALLS', 'IMPORTS'], direction: 'out', depth: 2, limit: 50 })) as unknown as {
      query: Record<string, string>
    }
    expect(r.query).toEqual({ node: 'lib/a.dart#file', types: 'CALLS,IMPORTS', direction: 'out', depth: '2', limit: '50' })
  })

  it('encodes node ids containing / :: and # in the path', async () => {
    const id = 'lib/services/auth_service.dart::AuthService.login#method'
    expect((await api.getNode('p1', id)).id).toBe(id)
  })

  it('throws EngineApiError with the engine error code', async () => {
    const err = await api.neighbors('p1', { node: 'nope' }).catch((e) => e)
    expect(err).toBeInstanceOf(EngineApiError)
    expect(err.code).toBe('unknown_node')
    expect(err.status).toBe(404)
    const bad = await api.openProject('/missing').catch((e) => e)
    expect(bad.code).toBe('bad_path')
  })

  it('subscribeEvents receives events (including one split across packets) and can be cancelled', async () => {
    const got: EngineEvent[] = []
    let closed = false
    const stop = subscribeEvents(h, (e) => got.push(e), () => (closed = true))
    await new Promise((r) => setTimeout(r, 400))
    stop()
    expect(got.map((e) => e.type)).toEqual(['job_progress', 'graph_updated', 'changes_updated'])
    await new Promise((r) => setTimeout(r, 50))
    expect(closed).toBe(false) // huỷ chủ động không gọi onClose
  })
})

describe('EngineApi: search, architecture, scan', () => {
  it('search encodes unicode and spaces, joins kinds, sends limit', async () => {
    const hits = (await api.search('p1', 'đăng nhập LoginScreen', { kinds: ['method', 'class'], limit: 30 })) as unknown as {
      score: number
      query: Record<string, string>
    }[]
    expect(hits).toHaveLength(2)
    expect(hits[0].score).toBeGreaterThan(hits[1].score)
    expect(hits[0].query).toEqual({ q: 'đăng nhập LoginScreen', kinds: 'method,class', limit: '30' })
    expect(await api.search('p1', 'nope')).toEqual([])
  })

  it('search surfaces bad_param from the engine', async () => {
    const err = await api.search('p1', '"').catch((e) => e)
    expect(err).toBeInstanceOf(EngineApiError)
    expect(err.code).toBe('bad_param')
  })

  it('architecture omits parent at the root and encodes it otherwise', async () => {
    const root = (await api.architecture('p1')) as unknown as { parent: unknown; received_parent: string | null }
    expect(root.parent).toBeNull()
    expect(root.received_parent).toBeNull()
    const sub = (await api.architecture('p1', 'dir:lib/màn hình')) as unknown as { parent: { id: string }; received_parent: string }
    expect(sub.received_parent).toBe('dir:lib/màn hình')
    expect(sub.parent.id).toBe('dir:lib/màn hình')
    const err = await api.architecture('p1', 'dir:nope').catch((e) => e)
    expect(err.code).toBe('unknown_block')
  })

  it('archEvidence sends from, to and limit', async () => {
    const ev = await api.archEvidence('p1', 'dir:lib/screens', 'dir:lib/services', 20)
    expect(ev[0].line).toBe(12)
    const sent = new URLSearchParams(ev[0].file)
    expect(Object.fromEntries(sent)).toEqual({ from: 'dir:lib/screens', to: 'dir:lib/services', limit: '20' })
    const err = await api.archEvidence('p1', 'dir:nope', 'dir:lib').catch((e) => e)
    expect(err.code).toBe('unknown_block')
  })

  it('scan returns top_dirs', async () => {
    const s = await api.scan('p1')
    expect(s.large).toBe(true)
    expect(s.top_dirs[1]).toEqual({ path: 'lib/Đồ án', files: 3000 })
  })

  it('startIndex sends a JSON body only when a subdir is given', async () => {
    expect(await api.startIndex('p1')).toMatchObject({ job_id: 'j1', received_body: null })
    expect(await api.startIndex('p1', { subdir: 'lib/Đồ án' })).toMatchObject({ received_body: { subdir: 'lib/Đồ án' } })
  })
})

describe('EngineApi: refresh and changes', () => {
  it('refresh posts to the project and returns the engine summary', async () => {
    expect(await api.refresh('p1')).toMatchObject({ status: 'ok', changed: 1 })
    expect(await api.refresh('p1')).toMatchObject({ received_count: 2 })
  })

  it('changes sends refresh=false only when asked and returns the report', async () => {
    const a = (await api.changes('p1')) as unknown as { base: string; query: Record<string, string> }
    expect(a.base).toBe('git_head')
    expect(a.query).toEqual({})
    const b = (await api.changes('p1', { refresh: false })) as unknown as { query: Record<string, string> }
    expect(b.query).toEqual({ refresh: 'false' })
    const err = await api.changes('nope').catch((e) => e)
    expect(err.code).toBe('unknown_project')
  })
})

describe('toIpcResult', () => {
  it('wraps success and keeps engine error codes across the IPC boundary', async () => {
    expect(await toIpcResult(async () => 5)).toEqual({ ok: true, data: 5 })
    const e = await toIpcResult(async () => {
      throw new EngineApiError(404, 'unknown_node', 'Không có nút')
    })
    expect(e).toEqual({ ok: false, error: { code: 'unknown_node', message: 'Không có nút' } })
    const other = await toIpcResult(async () => {
      throw new Error('boom')
    })
    expect(other).toEqual({ ok: false, error: { code: 'internal', message: 'Máy chủ nội bộ gặp lỗi. Vui lòng thử lại.' } })
  })
})

type Echo = { method: string; path: string; query: Record<string, string>; body: unknown }
const echo = (p: Promise<unknown>): Promise<Echo> => p as Promise<Echo>

describe('EngineApi: F10 wave 1 routes', () => {
  it('report is a GET', async () => {
    expect(await echo(api.report('p1'))).toMatchObject({ method: 'GET', path: '/v1/projects/p1/report' })
  })

  it('paths posts node ids with snake_case options', async () => {
    const r = await echo(api.paths('p1', ['a#file', 'b#file'], { maxHops: 3, directed: false }))
    expect(r).toMatchObject({ method: 'POST', path: '/v1/projects/p1/paths' })
    expect(r.body).toEqual({ node_ids: ['a#file', 'b#file'], max_hops: 3, directed: false })
    expect((await echo(api.paths('p1', ['a', 'b']))).body).toEqual({ node_ids: ['a', 'b'] })
  })

  it('impactOf sends the node id as a query parameter', async () => {
    const id = 'lib/a.dart::A.run#method'
    expect(await echo(api.impactOf('p1', id))).toMatchObject({ method: 'GET', query: { node: id } })
  })

  it('ask posts the question and options', async () => {
    const r = await echo(api.ask('p1', 'đăng nhập ở đâu', { depth: 3, budget: 500, mode: 'dfs' }))
    expect(r.body).toEqual({ question: 'đăng nhập ở đâu', depth: 3, budget: 500, mode: 'dfs' })
  })

  it('recluster posts to communities', async () => {
    expect(await echo(api.recluster('p1'))).toMatchObject({ method: 'POST', path: '/v1/projects/p1/communities' })
  })

  it('tools reads which external tools are installed', async () => {
    expect(await api.tools()).toEqual({ ffmpeg: true, faster_whisper: false, git: true, gh: false, yt_dlp: false })
  })

  it('startIndex sends document and media flags', async () => {
    expect(await api.startIndex('p1', { includeDocs: true })).toMatchObject({ received_body: { include_docs: true } })
    expect(await api.startIndex('p1', { includeDocs: true, includeMedia: true })).toMatchObject({ received_body: { include_docs: true, include_media: true } })
    expect(await api.startIndex('p1', { includeDocs: false, includeMedia: false })).toMatchObject({ received_body: { include_docs: false, include_media: false } })
    expect((await api.startIndex('p1', { exclude: ['a/'] }) as unknown as { received_body: object }).received_body).toEqual({ exclude: ['a/'] })
  })

  it('startIndex sends extra sources; DSN only when PostgreSQL is on (W11)', async () => {
    const body = async (o: Parameters<EngineApi['startIndex']>[1], dsn?: string) =>
      ((await api.startIndex('p1', o, dsn)) as unknown as { received_body: Record<string, unknown> }).received_body
    expect(await body({ sources: { cargo: true, scipFiles: ['a.json'] } }, 'postgresql://x'))
      .toEqual({ sources: { cargo: true, manifests: false, scip_files: ['a.json'], mcp_files: [] } })
    expect(await body({ sources: { postgres: true } }, 'postgresql://x'))
      .toEqual({ sources: { cargo: false, manifests: false, scip_files: [], mcp_files: [], postgres_dsn: 'postgresql://x' } })
  })

  it('startIndex sends exclude patterns', async () => {
    expect(await api.startIndex('p1', { exclude: ['vendor/', '*.g.dart'] })).toMatchObject({ received_body: { exclude: ['vendor/', '*.g.dart'] } })
    expect(await api.startIndex('p1', { subdir: 'lib', exclude: [] })).toMatchObject({ received_body: { subdir: 'lib' } })
  })

  it('exportGraph and pushGraph post format, scope and target', async () => {
    const e = await echo(api.exportGraph('p1', 'obsidian', { kind: 'community', value: 'com:2' }, '/tmp/Đồ án'))
    expect(e.body).toEqual({ format: 'obsidian', scope: { kind: 'community', value: 'com:2' }, out_dir: '/tmp/Đồ án' })
    const p = await echo(api.pushGraph('p1', { target: 'neo4j', uri: 'bolt://localhost:7687', user: 'neo4j', password: 'x', scope: { kind: 'all' } }))
    expect(p).toMatchObject({ path: '/v1/projects/p1/export/push', body: { target: 'neo4j', uri: 'bolt://localhost:7687' } })
  })

  it('flows builds query string with unicode q, kind and limit', async () => {
    const r = await echo(api.flows('p 1', { q: 'đăng nhập', kind: 'route', limit: 5 }))
    expect(r.path).toBe('/v1/projects/p%201/flows')
    expect(r.query).toEqual({ q: 'đăng nhập', kind: 'route', limit: '5' })
  })

  it('map and cycles build their query strings', async () => {
    const m = await echo(api.map('p1', { parent: 'dir:src', detail: 400 }))
    expect(m.path).toBe('/v1/projects/p1/map')
    expect(m.query).toEqual({ parent: 'dir:src', detail: '400' })
    expect((await echo(api.cycles('p1', 20))).query).toEqual({ limit: '20' })
  })

  it('flow requests flow detail by id', async () => {
    const r = await echo(api.flow('p1', 7))
    expect(r.path).toBe('/v1/projects/p1/flows/7')
  })
})
