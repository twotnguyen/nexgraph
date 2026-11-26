import { randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { handlers, host, ipcMain, safeStorage, win } from '../src/electron-host'

describe('lớp giả lập electron phía host', () => {
  beforeEach(() => {
    handlers.clear()
    host.key = randomBytes(32)
  })

  it('mã hoá rồi giải mã ra đúng chuỗi, kể cả tiếng Việt', () => {
    const enc = safeStorage.encryptString('sk-khoá bí mật')
    expect(enc.toString('utf8')).not.toContain('sk-')
    expect(safeStorage.decryptString(enc)).toBe('sk-khoá bí mật')
  })

  it('từ chối bản mã bị sửa hoặc sai khoá', () => {
    const enc = safeStorage.encryptString('abc')
    enc[enc.length - 1] ^= 1
    expect(() => safeStorage.decryptString(enc)).toThrow()
    const ok = safeStorage.encryptString('abc')
    host.key = randomBytes(32)
    expect(() => safeStorage.decryptString(ok)).toThrow()
  })

  it('không có khoá thì báo không mã hoá được và không mã hoá', () => {
    host.key = null
    expect(safeStorage.isEncryptionAvailable()).toBe(false)
    expect(() => safeStorage.encryptString('abc')).toThrow()
  })

  it('ipcMain.handle đăng ký kênh, webContents.send chuyển về host.send', () => {
    ipcMain.handle('x:echo', (_e, a) => a)
    expect(handlers.get('x:echo')!(null, 7)).toBe(7)
    const sent: unknown[] = []
    host.send = (c, p) => void sent.push([c, p])
    win.webContents.send('engine:event', { type: 'graph_updated' })
    expect(sent).toEqual([['engine:event', { type: 'graph_updated' }]])
  })
})
