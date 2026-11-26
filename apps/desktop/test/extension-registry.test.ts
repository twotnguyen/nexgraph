import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { ExtensionRegistry, readExtension } from '../src/main/features/extensions/registry'

const base = mkdtempSync(join(tmpdir(), 'ng-ext-'))
afterAll(() => rmSync(base, { recursive: true, force: true }))
const sample = resolve(__dirname, '../../../examples/extension-sample')

it('đọc extension mẫu: theme và lệnh có mã kèm tiền tố của extension', async () => {
  const info = await readExtension(sample)
  expect(info).toMatchObject({ id: 'nexgraph-sample', name: 'Mẫu NexGraph' })
  expect(info.themes.map((t) => [t.id, t.appearance])).toEqual([['ext-nexgraph-sample-moss', 'dark']])
  expect(info.commands.map((c) => c.id)).toEqual(['ext.nexgraph-sample.insert-spdx', 'ext.nexgraph-sample.focus-search'])
  expect(info.commands[0].action).toEqual({ type: 'insertText', text: '// SPDX-License-Identifier: Apache-2.0\n' })
})

it('từ chối CSS tuỳ ý, biến lạ, thiếu màu bắt buộc và hành động không hỗ trợ', async () => {
  const write = (name: string, manifest: unknown) => {
    const dir = join(base, name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'extension.json'), JSON.stringify(manifest))
    return dir
  }
  const theme = (colors: Record<string, string>) => ({ id: 'xx', name: 'x', contributes: { themes: [{ id: 'tt', name: 'T', appearance: 'dark', colors }] } })
  const ok = { '--color-bg': '#000', '--color-surface': '#000', '--color-text': '#fff', '--color-muted': '#888', '--color-border': '#333' }
  await expect(readExtension(write('inject', theme({ ...ok, '--color-bg': 'red;}body{display:none' })))).rejects.toMatchObject({ code: 'bad_extension' })
  await expect(readExtension(write('unknown', theme({ ...ok, '--evil': '#000' })))).rejects.toThrow('không được hỗ trợ')
  await expect(readExtension(write('missing', theme({ '--color-bg': '#000' })))).rejects.toThrow('thiếu màu')
  await expect(readExtension(write('script', { id: 'yy', name: 'y', contributes: { commands: [{ id: 'cc', title: 'C', action: { type: 'eval', code: 'x' } }] } }))).rejects.toThrow('action.type')
  await expect(readExtension(write('chain', { id: 'zz', name: 'z', contributes: { commands: [{ id: 'cc', title: 'C', action: { type: 'runCommands', commands: ['ext.other.c'] } }] } }))).rejects.toThrow('runCommands')
  await expect(readExtension(write('bad-id', { id: '../x', name: 'n', contributes: { themes: [] } }))).rejects.toThrow('Mã extension')
})

it('cài chép thư mục (bỏ symlink), liệt kê kèm lỗi manifest hỏng, gỡ được', async () => {
  const registry = new ExtensionRegistry(join(base, 'installed'))
  const source = join(base, 'src-ext')
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, 'extension.json'), readFileSync(join(sample, 'extension.json')))
  writeFileSync(join(base, 'secret.txt'), 'bí mật')
  symlinkSync(join(base, 'secret.txt'), join(source, 'link.txt'))
  expect((await registry.install(source)).id).toBe('nexgraph-sample')
  expect(existsSync(join(base, 'installed', 'nexgraph-sample', 'extension.json'))).toBe(true)
  expect(existsSync(join(base, 'installed', 'nexgraph-sample', 'link.txt'))).toBe(false)
  mkdirSync(join(base, 'installed', 'broken'))
  writeFileSync(join(base, 'installed', 'broken', 'extension.json'), '{ không phải json')
  const listed = await registry.list()
  expect(listed.extensions.map((e) => e.id)).toEqual(['nexgraph-sample'])
  expect(listed.errors).toEqual([{ folder: 'broken', message: 'extension.json không phải JSON hợp lệ' }])
  await registry.remove('nexgraph-sample')
  expect((await registry.list()).extensions).toEqual([])
})
