// Menu native (PR #49): cấu trúc template do main dựng — kiểm menu ứng dụng macOS, role soạn
// thảo cho ⌘C/⌘V/⌘Z, Tải lại/DevTools chỉ ở bản chưa đóng gói, zoom, và nhãn theo ngôn ngữ UI.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'

const h = vi.hoisted(() => ({
  isPackaged: false,
  built: [] as unknown[],
  appMenu: null as unknown
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() { return h.isPackaged },
    getName: () => 'NexGraph'
  },
  BrowserWindow: { getFocusedWindow: () => null },
  Menu: {
    buildFromTemplate: (template: unknown) => { h.built.push(template); return { template } },
    setApplicationMenu: (menu: unknown) => { h.appMenu = menu }
  }
}))

import { buildAppMenu, setAppMenuLocale, type MenuBuildOptions } from '../src/main/appMenu'

type Item = MenuItemConstructorOptions & { submenu?: Item[] }
const build = (patch: Partial<MenuBuildOptions> = {}): Item[] => buildAppMenu({
  locale: 'vi', isPackaged: false, platform: 'darwin', send: vi.fn(), appName: 'NexGraph', ...patch
}) as Item[]
const menu = (template: Item[], label: string): Item => {
  const found = template.find((item) => item.label === label)
  if (!found) throw new Error(`thiếu menu ${label}: ${template.map((i) => i.label).join(', ')}`)
  return found
}
const roles = (item: Item): string[] => (item.submenu ?? []).flatMap((sub) => sub.role ? [sub.role] : [])

describe('template menu hệ thống', () => {
  beforeEach(() => { h.built.length = 0; h.appMenu = null; h.isPackaged = false })

  it('macOS: menu đầu tiên là menu ứng dụng có About/Hide/Quit', () => {
    const template = build()
    expect(template[0].label).toBe('NexGraph')
    expect(roles(template[0])).toEqual(expect.arrayContaining(['about', 'hide', 'hideOthers', 'unhide', 'quit']))
  })

  it('macOS: Edit có đủ role soạn thảo để ⌘Z/⌘C/⌘V/⌘X/⌘A chạy trong Monaco và ô nhập', () => {
    const editRoles = roles(menu(build(), 'Sửa'))
    for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'delete', 'selectAll']) expect(editRoles).toContain(role)
    // Vẫn giữ lệnh NexGraph phía dưới nhóm role.
    expect((menu(build(), 'Sửa').submenu ?? []).some((item) => item.label === 'Tìm và mở tệp…')).toBe(true)
  })

  it('bản dev có Tải lại/DevTools, bản đóng gói thì không', () => {
    const dev = roles(menu(build({ isPackaged: false }), 'Xem'))
    expect(dev).toEqual(expect.arrayContaining(['reload', 'toggleDevTools', 'resetZoom', 'zoomIn', 'zoomOut', 'togglefullscreen']))
    const packaged = roles(menu(build({ isPackaged: true }), 'Xem'))
    expect(packaged).not.toContain('reload')
    expect(packaged).not.toContain('toggleDevTools')
    expect(packaged).toEqual(expect.arrayContaining(['resetZoom', 'zoomIn', 'zoomOut']))
  })

  it('Windows/Linux: không có menu ứng dụng, vẫn có menu cửa sổ và Help', () => {
    const template = build({ platform: 'win32' })
    expect(template[0].label).toBe('Tệp')
    expect(menu(template, 'Cửa sổ').submenu?.some((item) => item.label === 'Đóng cửa sổ')).toBe(true)
    expect(menu(template, 'Trợ giúp')).toBeTruthy()
  })

  it('nhãn đổi theo ngôn ngữ UI (vi ↔ en)', () => {
    expect(build({ locale: 'en' }).map((item) => item.label)).toEqual(['NexGraph', 'File', 'Edit', 'View', 'Window', 'Help'])
    expect(build({ locale: 'vi' }).map((item) => item.label)).toEqual(['NexGraph', 'Tệp', 'Sửa', 'Xem', 'Cửa sổ', 'Trợ giúp'])
    const open = menu(build({ locale: 'en' }), 'File').submenu?.find((item) => item.label === 'Open File…')
    expect(open).toBeTruthy()
  })

  it('mục lệnh gửi đúng id sang renderer, không có mục giả "workspace" không backend', () => {
    const send = vi.fn()
    const file = menu(build({ send }), 'Tệp')
    const labels = (file.submenu ?? []).map((item) => item.label ?? '')
    expect(labels.some((label) => /workspace/i.test(label))).toBe(false)
    const newWindow = (file.submenu ?? []).find((item) => item.label === 'Cửa sổ mới')!
    newWindow.click!({} as never, undefined as never, undefined as never)
    expect(send).toHaveBeenCalledWith('window.new')
  })

  it('setAppMenuLocale chỉ nhận vi/en và dựng lại menu', () => {
    const getWindow = () => null
    expect(setAppMenuLocale('fr', getWindow)).toBe(false)
    expect(h.built).toHaveLength(0)
    expect(setAppMenuLocale('en', getWindow)).toBe(true)
    expect(h.built).toHaveLength(1)
    expect((h.appMenu as { template: Item[] }).template[1].label).toBe('File')
    expect(setAppMenuLocale('vi', getWindow)).toBe(true)
    expect((h.appMenu as { template: Item[] }).template[1].label).toBe('Tệp')
  })
})
