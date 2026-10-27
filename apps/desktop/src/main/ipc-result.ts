import { EngineApiError } from './engine/api'

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }

/** Electron làm mất `code` khi lỗi đi qua IPC, nên mọi handler trả về một phong bì có mã lỗi của engine. */
export async function toIpcResult<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    if (err instanceof EngineApiError) return { ok: false, error: { code: err.code, message: err.message } }
    return { ok: false, error: { code: 'internal', message: err instanceof Error ? err.message : String(err) } }
  }
}
