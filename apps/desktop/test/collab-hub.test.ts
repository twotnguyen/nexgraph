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

/** Token hợp lệ về định dạng nhưng chắc chắn sai. */
const wrongToken = (token: string) => (token === 'A'.repeat(22) ? 'B'.repeat(22) : 'A'.repeat(22))
const serverAddress = (hub: CollabHub) => (hub as unknown as { server: { address(): { address: string } } }).server.address().address

it('máy chia sẻ và hai người tham gia chuyển gói cho nhau; sai mã bị từ chối', async () => {
  const host = make()
  const { port, code } = await host.hub.host({ file: 'src/app.ts', host: 'Máy A' }, 0, '127.0.0.1')
  const wrong = make()
  await expect(wrong.hub.join(`127.0.0.1:${port}`, wrongToken(code))).rejects.toMatchObject({ code: 'connect_failed' })
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

it('mã mời dài 22 ký tự base64url và server chỉ lắng nghe trên địa chỉ được chỉ định', async () => {
  const host = make()
  const { port, code, addresses } = await host.hub.host({ file: 'src/app.ts', host: 'Máy A' }, 0, '127.0.0.1')
  expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/)
  expect(addresses).toEqual(['127.0.0.1'])
  expect(serverAddress(host.hub)).toBe('127.0.0.1')
  expect(serverAddress(host.hub)).not.toBe('0.0.0.0')
  const wrong = make()
  await expect(wrong.hub.join(`127.0.0.1:${port}`, wrongToken(code))).rejects.toMatchObject({ code: 'connect_failed' })
})

it('một IP sai 5 lần thì bị khoá tới hết phiên dù sau đó nhập đúng', async () => {
  const host = make()
  const { port, code } = await host.hub.host({ file: 'src/app.ts', host: 'Máy A' }, 0, '127.0.0.1')
  for (let i = 0; i < 5; i++) {
    await expect(make().hub.join(`127.0.0.1:${port}`, wrongToken(code))).rejects.toMatchObject({ code: 'connect_failed' })
  }
  await expect(make().hub.join(`127.0.0.1:${port}`, code)).rejects.toMatchObject({ code: 'connect_failed' })
  expect(host.hub.hosting).toEqual({ file: 'src/app.ts', host: 'Máy A' })
})

it('20 lần nhập sai trong một phiên thì phiên dừng và phát sự kiện đóng', async () => {
  const host = make()
  const { port, code } = await host.hub.host({ file: 'src/app.ts', host: 'Máy A' }, 0, '127.0.0.1')
  for (let i = 0; i < 20; i++) {
    await expect(make().hub.join(`127.0.0.1:${port}`, wrongToken(code))).rejects.toMatchObject({ code: 'connect_failed' })
  }
  await vi.waitFor(() => expect(host.events).toContainEqual({ type: 'closed', reason: 'too_many_failures' }))
  expect(host.hub.hosting).toBeNull()
})

it('join từ chối định dạng mã 6 số cũ', async () => {
  const { hub } = make()
  await expect(hub.join('127.0.0.1:41234', '123456')).rejects.toMatchObject({ code: 'bad_param' })
})
