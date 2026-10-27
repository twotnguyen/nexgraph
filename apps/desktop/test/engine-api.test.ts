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
    expect(got.map((e) => e.type)).toEqual(['job_progress', 'graph_updated'])
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
    expect(other).toEqual({ ok: false, error: { code: 'internal', message: 'boom' } })
  })
})
