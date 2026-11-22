import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { TerminalManager, defaultShell, resolveTerminalPath } from '../src/main/terminal/manager'

it('chọn shell của người dùng, có dự phòng khi $SHELL không tồn tại', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ng-shell-'))
  const shell = join(dir, 'sh')
  try {
    writeFileSync(shell, '')
    expect(defaultShell('darwin', { SHELL: shell })).toEqual({ file: shell, args: ['-l'] })
    expect(defaultShell('darwin', { SHELL: '/không/có' })).toEqual({ file: '/bin/zsh', args: ['-l'] })
    expect(defaultShell('win32', { SystemRoot: '/không/có', COMSPEC: 'C:\\Windows\\cmd.exe' })).toEqual({ file: 'C:\\Windows\\cmd.exe', args: [] })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('chỉ mở đường dẫn tương đối trong dự án và chặn symlink ra ngoài', () => {
  const root = mkdtempSync(join(tmpdir(), 'ng-link-'))
  const outside = mkdtempSync(join(tmpdir(), 'ng-outside-'))
  try {
    writeFileSync(join(root, 'inside.ts'), '')
    writeFileSync(join(outside, 'outside.ts'), '')
    symlinkSync(join(outside, 'outside.ts'), join(root, 'link.ts'))
    expect(resolveTerminalPath(root, 'inside.ts')).toBe('inside.ts')
    expect(resolveTerminalPath(root, join(root, 'inside.ts'))).toBeNull()
    expect(resolveTerminalPath(root, join(outside, 'outside.ts'))).toBeNull()
    expect(resolveTerminalPath(root, 'link.ts')).toBeNull()
    expect(resolveTerminalPath(root, 'missing.ts')).toBeNull()
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
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

it.skipIf(process.platform === 'win32')('chạy task process với args, cwd và biến môi trường rồi giữ mã thoát', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ng-task-'))
  let output = ''
  const exited = vi.fn()
  const manager = new TerminalManager({ data: (_id, chunk) => { output += chunk }, exit: exited })
  try {
    const { id } = await manager.create(root, 80, 24, {
      label: 'test', type: 'process', command: process.execPath,
      args: ['-e', "console.log(process.env.NG_TASK, process.argv[1]); process.exit(3)", 'có khoảng trắng'],
      env: { NG_TASK: 'giá trị' }
    })
    await vi.waitFor(() => expect(exited).toHaveBeenCalledWith(id, 3), { timeout: 10_000 })
    expect(output).toContain('giá trị có khoảng trắng')
  } finally {
    manager.killAll()
    rmSync(root, { recursive: true, force: true })
  }
})

it.skipIf(process.platform === 'win32')('truyền args của shell task như từng đối số nguyên vẹn', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ng-task-'))
  let output = ''
  const exited = vi.fn()
  const manager = new TerminalManager({ data: (_id, chunk) => { output += chunk }, exit: exited })
  try {
    const { id } = await manager.create(root, 80, 24, {
      label: 'test', type: 'shell', command: 'printf "%s"', args: ["một 'hai'"]
    })
    await vi.waitFor(() => expect(exited).toHaveBeenCalledWith(id, 0), { timeout: 10_000 })
    expect(output).toContain("một 'hai'")
  } finally {
    manager.killAll()
    rmSync(root, { recursive: true, force: true })
  }
})
