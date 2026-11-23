// @vitest-environment jsdom
// PR #49 (N1): cầu nối menu hệ thống ↔ renderer. Auto Save là mục có trạng thái: bấm phải đổi
// prefs VÀ báo cho người dùng biết đang bật hay tắt (menu native không hiện dấu check).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  run: vi.fn(() => true),
  notify: vi.fn(),
  prefs: { autoSave: 'off' as 'off' | 'afterDelay' }
}))

vi.mock('./commands', () => ({ runCommand: h.run }))
vi.mock('./editorPrefs', () => ({
  getEditorPrefs: () => h.prefs,
  setEditorPrefs: (patch: { autoSave?: 'off' | 'afterDelay' }) => { h.prefs = { ...h.prefs, ...patch } }
}))
vi.mock('../components/common/NotificationCenter', () => ({ notify: h.notify }))

import { installAppMenuBridge } from './appMenuBridge'

let handler: ((action: { id: string }) => void) | null = null
const install = (): (() => void) => {
  Object.assign(window, {
    nexgraph: { menu: { onAction: (cb: (action: { id: string }) => void) => { handler = cb; return () => { handler = null } } } }
  })
  return installAppMenuBridge()
}

beforeEach(() => {
  h.run.mockClear()
  h.notify.mockClear()
  h.prefs = { autoSave: 'off' }
  handler = null
})
afterEach(() => { Reflect.deleteProperty(window, 'nexgraph') })

describe('appMenuBridge', () => {
  it('mục lệnh thường chạy đúng id lệnh', () => {
    const off = install()
    handler!({ id: 'file.save_all' })
    expect(h.run).toHaveBeenCalledWith('file.save_all')
    off()
    expect(handler).toBeNull()
  })

  it('Auto Save bật/tắt prefs và báo trạng thái, không chạy lệnh', () => {
    install()
    handler!({ id: 'app-menu:auto-save' })
    expect(h.prefs.autoSave).toBe('afterDelay')
    expect(h.notify).toHaveBeenLastCalledWith('Đã bật tự lưu')
    expect(h.run).not.toHaveBeenCalled()
    handler!({ id: 'app-menu:auto-save' })
    expect(h.prefs.autoSave).toBe('off')
    expect(h.notify).toHaveBeenLastCalledWith('Đã tắt tự lưu')
  })
})
