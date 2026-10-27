import type { EngineStatus } from './engine-status'

/** API mà preload phơi ra renderer qua `window.nexgraph`. */
export interface NexGraphApi {
  engine: {
    status(): Promise<EngineStatus>
    restart(): Promise<void>
    /** Trả về hàm huỷ đăng ký. */
    onStatus(cb: (s: EngineStatus) => void): () => void
  }
}
