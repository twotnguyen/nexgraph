import { afterEach, expect, it, vi } from 'vitest'
import type { CollabEvent } from '../src/shared/api'
import { CollabHub } from '../src/main/collab/hub'

const hubs: CollabHub[] = []
const make = () => {
  const events: CollabEvent[] = []
  const hub = new CollabHub((e) => events.push(e))
  hubs.push(hub)
  return { hub, events }
}
afterEach(() => { for (const h of hubs.splice(0)) h.stop() })

it('máy chia sẻ và hai người tham gia chuyển gói cho nhau; sai mã bị từ chối', async () => {
  const host = make()
  const { port, code } = await host.hub.host({ file: 'src/app.ts', host: 'Máy A' })
  const wrong = make()
  await expect(wrong.hub.join(`127.0.0.1:${port}`, code === '000000' ? '111111' : '000000')).rejects.toMatchObject({ code: 'connect_failed' })
  const a = make()
  const b = make()
  expect(await a.hub.join(`127.0.0.1:${port}`, code)).toEqual({ file: 'src/app.ts', host: 'Máy A' })
  await b.hub.join(`127.0.0.1:${port}`, code)
  await vi.waitFor(() => expect(host.events).toContainEqual({ type: 'peers', count: 2 }))
  expect(host.events.filter((e) => e.type === 'joined')).toHaveLength(2)

  // Người tham gia A gửi: máy chia sẻ và B nhận; A không nhận lại gói của mình.
  a.hub.send(new Uint8Array([1, 2, 3]))
  const got = (events: CollabEvent[]) => events.filter((e): e is Extract<CollabEvent, { type: 'message' }> => e.type === 'message').map((e) => [...e.data])
  await vi.waitFor(() => expect(got(host.events)).toEqual([[1, 2, 3]]))
  await vi.waitFor(() => expect(got(b.events)).toEqual([[1, 2, 3]]))
  expect(got(a.events)).toEqual([])
  // Máy chia sẻ gửi: mọi người tham gia nhận.
  host.hub.send(new Uint8Array([9]))
  await vi.waitFor(() => expect(got(a.events)).toEqual([[9]]))
  await vi.waitFor(() => expect(got(b.events)).toEqual([[1, 2, 3], [9]]))

  host.hub.stop()
  await vi.waitFor(() => expect(a.events).toContainEqual({ type: 'closed' }))
  await expect(make().hub.join('không hợp lệ', '12')).rejects.toMatchObject({ code: 'bad_param' })
})
