import { describe, expect, it, vi } from 'vitest'
import type { EngineHandle } from '../src/main/engine/launcher'
import { EngineStartError } from '../src/main/engine/launcher'
import { EngineSupervisor, type RetryPolicy } from '../src/main/engine/supervisor'
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

function setup(start: ReturnType<typeof vi.fn>, retry?: Partial<RetryPolicy>) {
  const seen: EngineStatus[] = []
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => health })))
  const sup = new EngineSupervisor(() => ({ command: 'x', args: [] }), '/d', (s) => seen.push(s), start as never, retry)
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

  it('tự khởi động lại sau khi engine thoát bất thường, trạng thái về sẵn sàng (A1 F2)', async () => {
    vi.useFakeTimers()
    try {
      const a = fakeHandle()
      const b = fakeHandle()
      const start = vi.fn().mockResolvedValueOnce(a.handle).mockResolvedValueOnce(b.handle)
      const { sup } = setup(start)
      await sup.startEngine()
      expect(sup.getStatus().state).toBe('ready')
      a.crash(9)
      expect(sup.getStatus()).toEqual({ state: 'starting', attempt: 1 })
      await vi.advanceTimersByTimeAsync(1000)
      expect(start).toHaveBeenCalledTimes(2)
      expect(sup.getStatus()).toEqual({ state: 'ready', engineVersion: '9.9.9', vendorCommit: 'abc' })
      expect(sup.getHandle()).toBe(b.handle)
    } finally {
      vi.useRealTimers()
    }
  })

  it('lùi dần 1 s, 2 s, 4 s rồi dừng sau N lần và cho khởi động lại thủ công (A1 F2)', async () => {
    vi.useFakeTimers()
    try {
      const start = vi.fn(async () => { throw new EngineStartError('hỏng', 1, 'boom: engine chết ngay') })
      const { sup, seen } = setup(start, { maxRestarts: 3, windowMs: 60_000 })
      await sup.startEngine() // lần 1 lỗi -> hẹn 1 s
      expect(sup.getStatus()).toEqual({ state: 'starting', attempt: 1 })
      await vi.advanceTimersByTimeAsync(1000) // lần 2 lỗi -> hẹn 2 s
      await vi.advanceTimersByTimeAsync(2000) // lần 3 lỗi -> hẹn 4 s
      expect(start).toHaveBeenCalledTimes(3)
      expect(sup.getStatus()).toEqual({ state: 'starting', attempt: 3 })
      await vi.advanceTimersByTimeAsync(4000) // lần 4 lỗi -> hết lượt
      expect(start).toHaveBeenCalledTimes(4)
      expect(sup.getStatus()).toEqual({ state: 'error', message: 'boom: engine chết ngay', restartable: true })
      const before = seen.length
      await vi.advanceTimersByTimeAsync(60_000)
      expect(start).toHaveBeenCalledTimes(4) // không vòng lặp vô hạn
      expect(seen.length).toBe(before)

      // Nút "Khởi động lại engine" cho người dùng một lượt mới.
      const restart = sup.restart()
      await vi.advanceTimersByTimeAsync(0)
      await restart
      expect(start).toHaveBeenCalledTimes(5)
      expect(sup.getStatus().state).toBe('starting')
    } finally {
      vi.useRealTimers()
    }
  })

  it('engine chết ngay sau khi sẵn sàng vẫn bị đếm vào cùng cửa sổ, không lặp mãi', async () => {
    vi.useFakeTimers()
    try {
      const handles = Array.from({ length: 3 }, () => fakeHandle())
      const start = vi.fn()
      for (const h of handles) start.mockResolvedValueOnce(h.handle)
      const { sup } = setup(start, { maxRestarts: 2, windowMs: 60_000 })
      await sup.startEngine()
      handles[0].crash(9) // sẵn sàng rồi chết ngay
      await vi.advanceTimersByTimeAsync(1000)
      handles[1].crash(9)
      await vi.advanceTimersByTimeAsync(2000)
      expect(start).toHaveBeenCalledTimes(3)
      expect(sup.getStatus().state).toBe('ready')
      handles[2].crash(9) // hết 2 lượt trong cửa sổ -> dừng
      expect(sup.getStatus()).toMatchObject({ state: 'error', restartable: true })
      await vi.advanceTimersByTimeAsync(60_000)
      expect(start).toHaveBeenCalledTimes(3) // đã dừng, không spawn thêm
    } finally {
      vi.useRealTimers()
    }
  })

  it('stop() huỷ lần thử đang hẹn giờ', async () => {
    vi.useFakeTimers()
    try {
      const a = fakeHandle()
      const { sup } = setup(vi.fn(async () => a.handle))
      await sup.startEngine()
      a.crash(9)
      expect(sup.getStatus().state).toBe('starting')
      await sup.stop()
      await vi.advanceTimersByTimeAsync(5000)
      expect(sup.getStatus().state).toBe('starting')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the translation key when the engine never becomes ready', async () => {
    const start = vi.fn(async () => { throw new EngineStartError('Engine không sẵn sàng sau 300 ms', 1, '',
      'Engine không sẵn sàng sau {ms} ms', { ms: 300 }) })
    const { sup } = setup(start, { maxRestarts: 0 }) // không tự thử lại: kiểm đúng thông báo cuối
    await sup.startEngine()
    expect(sup.getStatus()).toEqual({ state: 'error', message: 'Engine không sẵn sàng sau 300 ms',
      messageKey: 'Engine không sẵn sàng sau {ms} ms', messageVars: { ms: 300 }, restartable: true })
  })

  it('uses first stderr line when start fails', async () => {
    const { sup } = setup(vi.fn(async () => { throw new EngineStartError('x', 1, 'tb\nNEXGRAPH_TOKEN is required') }), { maxRestarts: 0 })
    await sup.startEngine()
    expect(sup.getStatus()).toEqual({ state: 'error', message: 'NEXGRAPH_TOKEN is required', restartable: true })
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
