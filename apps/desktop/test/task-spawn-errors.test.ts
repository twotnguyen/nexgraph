import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { TerminalManager } from '../src/main/features/terminal/manager'

it.skipIf(process.platform === 'win32')('báo thất bại khi không tìm thấy lệnh process', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ng-task-error-'))
  const exited = vi.fn()
  const manager = new TerminalManager({ data: () => {}, exit: exited })
  try {
    const { id } = await manager.create(root, 80, 24, { label: 'missing', type: 'process', command: join(root, 'missing-command') })
    await vi.waitFor(() => expect(exited.mock.calls.some(([session, code]) => session === id && code !== 0)).toBe(true), { timeout: 2_000 })
  } finally {
    manager.killAll()
    rmSync(root, { recursive: true, force: true })
  }
})
