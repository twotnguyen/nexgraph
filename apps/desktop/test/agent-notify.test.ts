import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  class FakeNotification {
    static supported = true
    static created: FakeNotification[] = []
    static isSupported() { return FakeNotification.supported }
    handlers = new Map<string, () => void>()
    shown = false
    constructor(public options: { title: string; body: string; silent?: boolean }) { FakeNotification.created.push(this) }
    on(event: string, handler: () => void) { this.handlers.set(event, handler); return this }
    show() { this.shown = true }
  }
  return { FakeNotification }
})
vi.mock('electron', () => ({ Notification: h.FakeNotification, app: { setAppUserModelId: vi.fn() } }))

import type { BrowserWindow } from 'electron'
import { notifyAgent } from '../src/main/features/agent/notify'

const windowState = { destroyed: false, minimized: false }
const win = { isDestroyed: () => windowState.destroyed, isMinimized: () => windowState.minimized, restore: vi.fn(), show: vi.fn(), focus: vi.fn() }
const asWindow = win as unknown as BrowserWindow

beforeEach(() => {
  h.FakeNotification.created = []
  h.FakeNotification.supported = true
  Object.assign(windowState, { destroyed: false, minimized: false })
  for (const fn of [win.restore, win.show, win.focus]) fn.mockClear()
})

describe('notifyAgent', () => {
  it('hiện thông báo im lặng (tiếng do cài đặt của app điều khiển), cắt chữ quá dài', () => {
    notifyAgent(asWindow, 'T'.repeat(500), 'B'.repeat(900))
    const [note] = h.FakeNotification.created
    expect(note.shown).toBe(true)
    expect(note.options).toEqual({ title: 'T'.repeat(120), body: 'B'.repeat(240), silent: true })
  })

  it('bỏ qua yêu cầu sai: tiêu đề/nội dung không phải chuỗi hoặc tiêu đề trống, không có cửa sổ, cửa sổ đã đóng, hệ điều hành không hỗ trợ', () => {
    notifyAgent(asWindow, 7, 'nội dung')
    notifyAgent(asWindow, 'tiêu đề', undefined)
    notifyAgent(asWindow, '   ', 'nội dung')
    notifyAgent(null, 'tiêu đề', 'nội dung')
    windowState.destroyed = true
    notifyAgent(asWindow, 'tiêu đề', 'nội dung')
    windowState.destroyed = false
    h.FakeNotification.supported = false
    notifyAgent(asWindow, 'tiêu đề', 'nội dung')
    expect(h.FakeNotification.created).toEqual([])
  })

  it('bấm vào thông báo thì đưa cửa sổ lên: khôi phục nếu đang thu nhỏ rồi hiện và focus', () => {
    notifyAgent(asWindow, 'Phiên A', 'xong')
    windowState.minimized = true
    h.FakeNotification.created[0].handlers.get('click')!()
    expect(win.restore).toHaveBeenCalledTimes(1)
    expect(win.show).toHaveBeenCalledTimes(1)
    expect(win.focus).toHaveBeenCalledTimes(1)

    notifyAgent(asWindow, 'Phiên A', 'xong lần nữa')
    windowState.minimized = false
    h.FakeNotification.created[1].handlers.get('click')!()
    expect(win.restore).toHaveBeenCalledTimes(1)
    expect(win.focus).toHaveBeenCalledTimes(2)
  })

  it('bấm vào thông báo sau khi cửa sổ đã đóng thì không làm gì và không lỗi', () => {
    notifyAgent(asWindow, 'Phiên A', 'xong')
    windowState.destroyed = true
    expect(() => h.FakeNotification.created[0].handlers.get('click')!()).not.toThrow()
    expect(win.show).not.toHaveBeenCalled()
    expect(win.focus).not.toHaveBeenCalled()
  })
})
