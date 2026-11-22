import { createHmac, timingSafeEqual } from 'node:crypto'
import type { TaskDefinition } from '../../shared/api'

export type SignedTask = TaskDefinition & { signature: string }

/**
 * Chữ ký HMAC cho định nghĩa task đã resolve. `tasks:resolve` ký bằng khoá chỉ sống trong main;
 * `terminal:create` chỉ chạy task có chữ ký hợp lệ, nên renderer bị chiếm quyền không thể tự
 * đặt command/args/env (ví dụ LD_PRELOAD, BASH_ENV) rồi mở tiến trình.
 */
export type TaskSigner = {
  sign(task: TaskDefinition): SignedTask
  verify(task: unknown): task is SignedTask
}

/** Thứ tự khoá env không được đổi chữ ký. */
const canonical = (task: TaskDefinition): string => JSON.stringify([
  task.label,
  task.command,
  task.type ?? 'shell',
  task.args ?? [],
  task.cwd ?? '',
  Object.entries(task.env ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
])

export function createTaskSigner(key: Buffer): TaskSigner {
  if (key.length < 32) throw new Error('Khoá ký task phải dài ít nhất 32 byte')
  const mac = (task: TaskDefinition) => createHmac('sha256', key).update(canonical(task)).digest('base64url')
  return {
    sign(task) {
      return { ...task, signature: mac(task) }
    },
    verify(task): task is SignedTask {
      if (!task || typeof task !== 'object') return false
      const candidate = task as TaskDefinition & { signature?: unknown }
      if (typeof candidate.signature !== 'string' || !candidate.signature) return false
      const expected = Buffer.from(mac(candidate), 'utf8')
      const actual = Buffer.from(candidate.signature, 'utf8')
      return expected.length === actual.length && timingSafeEqual(expected, actual)
    }
  }
}
