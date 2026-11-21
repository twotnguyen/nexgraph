// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KeymapEditor } from '../components/settings/KeymapEditor'
import { BASE_KEYMAPS } from './baseKeymaps'
import { COMMANDS, bindingFor, bindingSource, installKeymap, isCustomBinding, layerKeymap, registerHandler, setBaseKeymap, setBinding } from './commands'

// jsdom không phải macOS: mod = Ctrl, phím mặc định "ctrl+…" thành "mod+…".
const press = (init: KeyboardEventInit & { code?: string }) => fireEvent.keyDown(document.body, init)
const resetKeymap = () => {
  setBaseKeymap('default')
  for (const command of COMMANDS) setBinding(command.id, null)
}

describe('layerKeymap', () => {
  const defaults = { a: 'mod+1', b: 'mod+2', c: 'mod+3', none: '' }

  it('ưu tiên người dùng > base > mặc định và ghi lại lớp quyết định', () => {
    const map = layerKeymap(defaults, { a: 'mod+9', none: 'mod+7' }, { a: 'mod+8' })
    expect(map.get('a')).toEqual({ key: 'mod+8', source: 'user' })
    expect(map.get('none')).toEqual({ key: 'mod+7', source: 'base' })
    expect(map.get('b')).toEqual({ key: 'mod+2', source: 'default' })
  })

  it('lớp trên lấy phím thì lệnh không được liệt kê ở lớp đó bị bỏ phím, lệnh được dời sang phím khác thì không', () => {
    expect(layerKeymap(defaults, { a: 'mod+2' }, {}).get('b')).toEqual({ key: '', source: 'base' })
    expect(layerKeymap(defaults, { a: 'mod+2', b: 'mod+5' }, {}).get('b')).toEqual({ key: 'mod+5', source: 'base' })
    // Người dùng lấy phím mà base vừa gán cho lệnh khác.
    const map = layerKeymap(defaults, { a: 'mod+9' }, { c: 'mod+9' })
    expect(map.get('a')).toEqual({ key: '', source: 'user' })
    expect(map.get('c')).toEqual({ key: 'mod+9', source: 'user' })
  })

  it('bỏ qua lệnh không tồn tại, không để nó lấy phím của lệnh khác', () => {
    const map = layerKeymap(defaults, { gone: 'mod+1' }, { gone2: 'mod+2' })
    expect(map.get('a')).toEqual({ key: 'mod+1', source: 'default' })
    expect(map.get('b')).toEqual({ key: 'mod+2', source: 'default' })
    expect(map.has('gone')).toBe(false)
  })
})

describe('bảng base keymap', () => {
  const defaults = Object.fromEntries(COMMANDS.map((command) => [command.id, command.key ?? '']))
  const stroke = '(?:mod\\+)?(?:ctrl\\+)?(?:alt\\+)?(?:shift\\+)?[^+ ]+'

  it.each(Object.entries(BASE_KEYMAPS))('%s: chỉ trỏ tới lệnh có thật, phím đúng dạng chuẩn và không hai lệnh chung phím', (_id, { keys }) => {
    for (const [id, key] of Object.entries(keys)) {
      expect(Object.hasOwn(defaults, id), id).toBe(true)
      expect(key, id).toMatch(new RegExp(`^${stroke}(?: ${stroke})?$`))
    }
    const own = Object.values(keys)
    expect(new Set(own).size).toBe(own.length)
    // Gộp với phím mặc định: không còn hai lệnh chung phím, không phím đơn nào trùng bước đầu của hợp âm (hợp âm sẽ không bao giờ chạy).
    const merged = [...layerKeymap(defaults, keys, {}).values()].map((entry) => entry.key).filter(Boolean)
    expect(new Set(merged).size).toBe(merged.length)
    const singles = new Set(merged.filter((key) => !key.includes(' ')))
    expect(merged.filter((key) => key.includes(' ') && singles.has(key.split(' ')[0]))).toEqual([])
  })
})

describe('đổi base keymap', () => {
  let uninstall: () => void
  let off: (() => void)[] = []
  beforeEach(() => {
    localStorage.clear()
    resetKeymap()
    uninstall = installKeymap()
  })
  afterEach(() => {
    cleanup()
    uninstall()
    off.forEach((remove) => remove())
    off = []
    resetKeymap()
  })

  it('áp ngay: phím của lệnh đổi theo base và bấm được, phím cũ thôi chạy', () => {
    const implementation = vi.fn()
    off.push(registerHandler('editor.implementation', implementation))
    expect(bindingFor('editor.implementation')).toBe('shift+f12')
    expect(bindingSource('editor.implementation')).toBe('default')

    setBaseKeymap('vscode')
    expect(bindingFor('editor.implementation')).toBe('mod+f12')
    expect(bindingSource('editor.implementation')).toBe('base')
    expect(localStorage.getItem('nexgraph.keymap.base')).toBe('vscode')
    press({ key: 'F12', code: 'F12', shiftKey: true })
    expect(implementation).not.toHaveBeenCalled()
    press({ key: 'F12', code: 'F12', ctrlKey: true })
    expect(implementation).toHaveBeenCalledOnce()

    setBaseKeymap('default')
    expect(bindingFor('editor.implementation')).toBe('shift+f12')
  })

  it('phím người dùng sửa thắng base dù đổi base, Đặt lại về phím của base', () => {
    setBaseKeymap('jetbrains')
    expect(bindingFor('editor.goto_line')).toBe('mod+l')
    setBinding('editor.goto_line', 'mod+alt+g')
    expect(bindingFor('editor.goto_line')).toBe('mod+alt+g')
    expect(bindingSource('editor.goto_line')).toBe('user')

    setBaseKeymap('sublime') // Sublime không nhắc tới lệnh này
    expect(bindingFor('editor.goto_line')).toBe('mod+alt+g')
    setBaseKeymap('jetbrains')
    expect(bindingFor('editor.goto_line')).toBe('mod+alt+g')

    setBinding('editor.goto_line', null)
    expect(bindingFor('editor.goto_line')).toBe('mod+l')
    expect(bindingSource('editor.goto_line')).toBe('base')
    setBaseKeymap('sublime')
    expect(bindingFor('editor.goto_line')).toBe('mod+g') // mặc định ctrl+g
    expect(bindingSource('editor.goto_line')).toBe('default')
  })

  it('không đóng băng phím trùng phím của base: sửa đúng bằng phím base rồi đổi base vẫn theo base mới', () => {
    setBaseKeymap('vscode')
    setBinding('editor.implementation', 'mod+f12')
    expect(isCustomBinding('editor.implementation')).toBe(false)
    setBaseKeymap('jetbrains')
    expect(bindingFor('editor.implementation')).toBe('mod+alt+b')
  })

  it('lệnh bị base lấy mất phím thì hết phím và phím mới chỉ chạy lệnh của base', () => {
    const implementation = vi.fn()
    const references = vi.fn()
    off.push(registerHandler('editor.implementation', implementation), registerHandler('editor.references', references))
    setBaseKeymap('sublime')
    expect(bindingFor('editor.references')).toBe('shift+f12')
    expect(bindingFor('editor.implementation')).toBe('')
    expect(bindingSource('editor.implementation')).toBe('base')
    press({ key: 'F12', code: 'F12', shiftKey: true })
    expect(references).toHaveBeenCalledOnce()
    expect(implementation).not.toHaveBeenCalled()
  })

  it('người dùng lấy phím của base thì lệnh base đó mất phím', () => {
    setBaseKeymap('jetbrains')
    expect(bindingFor('explorer.toggle')).toBe('mod+1')
    setBinding('debug.toggle', 'mod+1')
    expect(bindingFor('debug.toggle')).toBe('mod+1')
    expect(bindingFor('explorer.toggle')).toBe('')
    setBinding('debug.toggle', null)
    expect(bindingFor('debug.toggle')).toBe('mod+5')
    // Phím đã gỡ khỏi lệnh kia nằm trong phần người dùng nên vẫn trống; Đặt lại nó trả về phím base.
    expect(bindingFor('explorer.toggle')).toBe('')
    setBinding('explorer.toggle', null)
    expect(bindingFor('explorer.toggle')).toBe('mod+1')
  })

  // Import động có chủ ý: base đã lưu được đọc lúc nạp module, nên phải nạp lại module mới thử được.
  it('khôi phục base đã lưu khi mở lại ứng dụng; giá trị lạ về mặc định', async () => {
    localStorage.setItem('nexgraph.keymap.base', 'jetbrains')
    vi.resetModules()
    expect((await import('./commands')).bindingFor('editor.goto_line')).toBe('mod+l')
    for (const bad of ['bogus', 'constructor', '__proto__']) {
      localStorage.setItem('nexgraph.keymap.base', bad)
      vi.resetModules()
      expect((await import('./commands')).bindingFor('editor.goto_line')).toBe('mod+g')
    }
  })

  it('trang Phím tắt: chọn base ở đầu trang, bảng và cột Nguồn đổi ngay; ghi phím mới thành Người dùng, Đặt lại về Base', () => {
    render(<KeymapEditor />)
    const row = () => document.querySelector<HTMLElement>('tr[data-command-id="editor.implementation"]')!
    expect(within(row()).getByText('Shift+F12')).toBeInTheDocument()
    expect(row().querySelector('.keymap-source')).toHaveTextContent('Mặc định')

    fireEvent.change(screen.getByLabelText('Base keymap'), { target: { value: 'vscode' } })
    expect(within(row()).getByText('Ctrl+F12')).toBeInTheDocument()
    expect(row().querySelector('.keymap-source')).toHaveTextContent('Base')

    fireEvent.click(within(row()).getByRole('button', { name: 'Đổi' }))
    const recorder = screen.getByRole('textbox', { name: 'Nhấn tổ hợp phím mới' })
    fireEvent.keyDown(recorder, { key: 'i', code: 'KeyI', ctrlKey: true, altKey: true })
    fireEvent.keyDown(recorder, { key: 'Enter' })
    expect(within(row()).getByText('Ctrl+Alt+I')).toBeInTheDocument()
    expect(row().querySelector('.keymap-source')).toHaveTextContent('Người dùng')

    fireEvent.click(within(row()).getByRole('button', { name: 'Đặt lại' }))
    expect(within(row()).getByText('Ctrl+F12')).toBeInTheDocument()
    expect(row().querySelector('.keymap-source')).toHaveTextContent('Base')
  })
})
