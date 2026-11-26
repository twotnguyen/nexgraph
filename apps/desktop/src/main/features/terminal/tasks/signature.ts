import { createHmac, timingSafeEqual } from 'node:crypto'
import type { TaskDefinition } from '@nexgraph/contracts/api'

export type SignedTask = TaskDefinition & { signature: string }

/** Dự án mà một chữ ký task thuộc về; chữ ký không dùng lại được ở dự án khác. */
export type TaskScope = { projectId: string; root: string }

/**
 * Nội dung task theo thứ tự cố định, bỏ chữ ký. Dùng để so task renderer gửi với task
 * khai trong tệp của dự án (`listTasks`) — chỉ nội dung khớp mới được main ký (REV-13).
 */
export function taskContentKey(task: TaskDefinition): string {
  return JSON.stringify([
    task.label,
    task.command,
    task.type ?? 'shell',
    task.args ?? [],
    task.cwd ?? '',
    Object.entries(task.env ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  ])
}

/**
 * Chữ ký HMAC cho task đã resolve. `tasks:resolve` chỉ ký task khai trong tệp của dự án và
 * ràng buộc chữ ký với projectId + root; `terminal:create` chỉ chạy task có chữ ký hợp lệ của
 * chính dự án đó, nên renderer bị chiếm quyền không thể tự đặt command/args/env (ví dụ
 * LD_PRELOAD, BASH_ENV) rồi mở tiến trình, cũng không replay chữ ký sang dự án khác.
 */
export type TaskSigner = {
  sign(scope: TaskScope, task: TaskDefinition): SignedTask
  verify(scope: TaskScope, task: unknown): task is SignedTask
}

const canonical = (scope: TaskScope, task: TaskDefinition): string =>
  JSON.stringify([scope.projectId, scope.root, taskContentKey(task)])

export function createTaskSigner(key: Buffer): TaskSigner {
  if (key.length < 32) throw new Error('Khoá ký task phải dài ít nhất 32 byte')
  const mac = (scope: TaskScope, task: TaskDefinition) =>
    createHmac('sha256', key).update(canonical(scope, task)).digest('base64url')
  return {
    sign(scope, task) {
      return { ...task, signature: mac(scope, task) }
    },
    verify(scope, task): task is SignedTask {
      if (!task || typeof task !== 'object') return false
      const candidate = task as TaskDefinition & { signature?: unknown }
      if (typeof candidate.signature !== 'string' || !candidate.signature) return false
      const expected = Buffer.from(mac(scope, candidate), 'utf8')
      const actual = Buffer.from(candidate.signature, 'utf8')
      return expected.length === actual.length && timingSafeEqual(expected, actual)
    }
  }
}
