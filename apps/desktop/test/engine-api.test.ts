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
    expect(await api.startIndex('p1')).toEqual({ job_id: 'j1' })
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
