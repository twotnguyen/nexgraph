import { describe, expect, it, vi } from 'vitest'
import type { EngineHandle } from '../src/main/engine/launcher'
import { EngineStartError } from '../src/main/engine/launcher'
import { EngineSupervisor } from '../src/main/engine/supervisor'
import type { EngineStatus } from '../src/shared/engine-status'

const health = { status: 'ok', api_version: '1', engine_version: '9.9.9', vendor_commit: 'abc' }

function fakeHandle() {
  let exitCb: ((c: number | null, s: NodeJS.Signals | null) => void) | undefined
  const handle: EngineHandle = {
    baseUrl: 'http://127.0.0.1:1',
    token: 't',
    pid: 1,
    stop: vi.fn(async () => {}),
    onExit: (cb) => (exitCb = cb)
  }
  return { handle, crash: (code: number) => exitCb?.(code, null) }
}

function setup(start: ReturnType<typeof vi.fn>) {
  const seen: EngineStatus[] = []
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => health })))
  const sup = new EngineSupervisor(() => ({ command: 'x', args: [] }), '/d', (s) => seen.push(s), start as never)
  return { sup, seen }
}

describe('EngineSupervisor', () => {
  it('goes starting -> ready with engine version', async () => {
    const { handle } = fakeHandle()
    const { sup, seen } = setup(vi.fn(async () => handle))
    await sup.startEngine()
    expect(seen.map((s) => s.state)).toEqual(['starting', 'ready'])
    expect(sup.getStatus()).toEqual({ state: 'ready', engineVersion: '9.9.9', vendorCommit: 'abc' })
  })

  it('reports error when engine exits after ready', async () => {
    const { handle, crash } = fakeHandle()
    const { sup } = setup(vi.fn(async () => handle))
    await sup.startEngine()
    crash(5)
    expect(sup.getStatus()).toEqual({ state: 'error', message: 'engine thoát (exit 5)',
      messageKey: 'engine thoát (exit {code})', messageVars: { code: 5 } })
  })

  it('keeps the translation key when the engine never becomes ready', async () => {
    const start = vi.fn(async () => { throw new EngineStartError('Engine không sẵn sàng sau 300 ms', 1, '',
      'Engine không sẵn sàng sau {ms} ms', { ms: 300 }) })
    const { sup } = setup(start)
    await sup.startEngine()
    expect(sup.getStatus()).toEqual({ state: 'error', message: 'Engine không sẵn sàng sau 300 ms',
      messageKey: 'Engine không sẵn sàng sau {ms} ms', messageVars: { ms: 300 } })
  })

  it('uses first stderr line when start fails', async () => {
    const { sup } = setup(vi.fn(async () => { throw new EngineStartError('x', 1, 'tb\nNEXGRAPH_TOKEN is required') }))
    await sup.startEngine()
    expect(sup.getStatus()).toEqual({ state: 'error', message: 'NEXGRAPH_TOKEN is required' })
  })

  it('restart stops the old engine and does not report its exit as an error', async () => {
    const a = fakeHandle()
    const b = fakeHandle()
    const start = vi.fn().mockResolvedValueOnce(a.handle).mockResolvedValueOnce(b.handle)
    const { sup } = setup(start)
    await sup.startEngine()
    await sup.restart()
    expect(a.handle.stop).toHaveBeenCalled()
    a.crash(143) // tiến trình cũ báo thoát muộn
    expect(sup.getStatus().state).toBe('ready')
  })

  it('stop terminates the running engine', async () => {
    const { handle } = fakeHandle()
    const { sup } = setup(vi.fn(async () => handle))
    await sup.startEngine()
    await sup.stop()
    expect(handle.stop).toHaveBeenCalled()
  })
})
