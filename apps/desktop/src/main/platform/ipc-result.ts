import { EngineApiError } from './engine/api'
import { FsError } from './project-fs'
import { AgentError } from '../features/agent/session'
import { UserError } from './user-error'

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }

/** Electron làm mất `code` khi lỗi đi qua IPC, nên mọi handler trả về một phong bì có mã lỗi của engine. */
export async function toIpcResult<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    if (err instanceof EngineApiError || err instanceof FsError || err instanceof AgentError || err instanceof UserError) return { ok: false, error: { code: err.code, message: err.message } }
    // Lỗi không mong đợi: chi tiết chỉ log ở main, renderer nhận thông báo chung.
    console.error('[ipc] lỗi nội bộ', err)
    return { ok: false, error: { code: 'internal', message: 'Máy chủ nội bộ gặp lỗi. Vui lòng thử lại.' } }
  }
}
