import { describe, expect, it, vi } from 'vitest'
import { installPermissionHandlers } from '../src/main/app/permissions'

type RequestHandler = (contents: unknown, permission: string, callback: (granted: boolean) => void, details?: unknown) => void
type CheckHandler = (contents: unknown, permission: string, origin?: string, details?: unknown) => boolean

const fakeSession = () => {
  const state: { request?: RequestHandler; check?: CheckHandler } = {}
  return {
    state,
    setPermissionRequestHandler: (handler: RequestHandler) => { state.request = handler },
    setPermissionCheckHandler: (handler: CheckHandler) => { state.check = handler }
  }
}

describe('quyền của renderer', () => {
  it('từ chối mọi yêu cầu quyền mặc định, chỉ cho ghi clipboard do người dùng bấm', () => {
    const session = fakeSession()
    installPermissionHandlers(session as never)
    const callback = vi.fn()
    for (const permission of ['media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'usb', 'serial',
      'hid', 'fullscreen', 'pointerLock', 'openExternal', 'clipboard-read', 'display-capture']) {
      callback.mockClear()
      session.state.request!({}, permission, callback)
      expect(callback, permission).toHaveBeenCalledWith(false)
    }
    callback.mockClear()
    session.state.request!({}, 'clipboard-sanitized-write', callback)
    expect(callback).toHaveBeenCalledWith(true)
  })

  it('kiểm tra quyền cũng từ chối mặc định', () => {
    const session = fakeSession()
    installPermissionHandlers(session as never)
    for (const permission of ['media', 'geolocation', 'notifications', 'clipboard-read']) {
      expect(session.state.check!({}, permission), permission).toBe(false)
    }
    expect(session.state.check!({}, 'clipboard-sanitized-write')).toBe(true)
  })
})
