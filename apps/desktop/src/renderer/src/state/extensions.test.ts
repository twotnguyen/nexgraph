// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import type { ExtensionInfo } from '@shared/api'
import { availableCommands, registerHandler, runCommand } from './commands'
import { setActiveEditor } from './activeEditor'
import { THEMES, currentThemeId } from './useTheme'
import { loadExtensions } from './extensions'

const ext: ExtensionInfo = {
  id: 'demo', name: 'Demo', version: '1.0.0', description: '',
  themes: [{ id: 'ext-demo-night', name: 'Đêm', appearance: 'dark', colors: { '--color-bg': '#101010', '--color-text': '#eeeeee' } }],
  commands: [
    { id: 'ext.demo.hello', title: 'Chèn lời chào', action: { type: 'insertText', text: 'xin chào\n' } },
    { id: 'ext.demo.chain', title: 'Chuỗi', action: { type: 'runCommands', commands: ['view.map', 'view.graph'] } }
  ]
}

it('đăng ký lệnh và theme của extension; nạp lại thì gỡ bản cũ', async () => {
  const list = vi.fn().mockResolvedValue({ extensions: [ext], errors: [] })
  Object.assign(window, { nexgraph: { extensions: { list } } })
  localStorage.setItem('nexgraph.theme', 'ext-demo-night')
  await loadExtensions()

  expect(availableCommands().map((c) => c.id)).toEqual(expect.arrayContaining(['ext.demo.hello', 'ext.demo.chain']))
  const insertText = vi.fn()
  setActiveEditor({ file: 'a.ts', handle: { insertText } as never, text: () => '' })
  runCommand('ext.demo.hello')
  expect(insertText).toHaveBeenCalledWith('xin chào\n')
  const ran: string[] = []
  const offs = ['view.map', 'view.graph'].map((id) => registerHandler(id, () => ran.push(id)))
  runCommand('ext.demo.chain')
  expect(ran).toEqual(['view.map', 'view.graph'])
  offs.forEach((off) => off())

  // Theme đã lưu là theme extension được áp ngay khi nạp; bảng màu nằm trong thẻ style riêng.
  expect(THEMES.some((t) => t.id === 'ext-demo-night')).toBe(true)
  expect(currentThemeId()).toBe('ext-demo-night')
  expect(document.getElementById('nexgraph-extension-themes')?.textContent).toBe(":root[data-theme='ext-demo-night']{--color-bg:#101010;--color-text:#eeeeee}")

  list.mockResolvedValue({ extensions: [], errors: [] })
  await loadExtensions()
  expect(availableCommands().some((c) => c.id.startsWith('ext.'))).toBe(false)
  expect(THEMES.some((t) => t.id.startsWith('ext-'))).toBe(false)
})
