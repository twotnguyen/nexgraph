import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { TerminalManager, defaultShell } from '../src/main/terminal/manager'

it('chọn shell của người dùng, có dự phòng khi $SHELL không tồn tại', () => {
  expect(defaultShell('darwin', { SHELL: '/bin/sh' })).toEqual({ file: '/bin/sh', args: ['-l'] })
  expect(defaultShell('darwin', { SHELL: '/không/có' })).toEqual({ file: '/bin/zsh', args: ['-l'] })
  expect(defaultShell('win32', { SystemRoot: '/không/có', COMSPEC: 'C:\\Windows\\cmd.exe' })).toEqual({ file: 'C:\\Windows\\cmd.exe', args: [] })
})

it.skipIf(process.platform === 'win32')('chạy lệnh trong gốc dự án qua pty thật và báo khi phiên kết thúc', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ng-term-'))
  writeFileSync(join(root, 'marker-file.txt'), '')
  let output = ''
  const exited = vi.fn()
  const manager = new TerminalManager({ data: (_id, chunk) => { output += chunk }, exit: exited })
  const { id } = await manager.create(root, 80, 24)
  manager.write(id, 'ls\r')
  await vi.waitFor(() => expect(output).toContain('marker-file.txt'), { timeout: 10_000 })
  manager.write(id, 'exit\r')
  await vi.waitFor(() => expect(exited).toHaveBeenCalledWith(id, 0), { timeout: 10_000 })
  manager.killAll()
  rmSync(root, { recursive: true, force: true })
})
