import type { EngineStatus } from './engine-status'
import type {
  CodeSlice, EngineEvent, GraphNode, GraphStats, NeighborQuery, Neighborhood, ProjectSummary
} from './graph-types'

/** API mà preload phơi ra renderer qua `window.nexgraph`. Lỗi từ engine là Error có thuộc tính `code`. */
export interface NexGraphApi {
  engine: {
    status(): Promise<EngineStatus>
    restart(): Promise<void>
    /** Trả về hàm huỷ đăng ký. */
    onStatus(cb: (s: EngineStatus) => void): () => void
  }
  project: {
    /** Hộp thoại chọn thư mục; `null` khi người dùng huỷ. */
    pickFolder(): Promise<string | null>
    open(path: string): Promise<ProjectSummary>
    list(): Promise<ProjectSummary[]>
  }
  index: {
    start(projectId: string): Promise<{ jobId: string }>
    cancel(jobId: string): Promise<void>
    onEvent(cb: (e: EngineEvent) => void): () => void
  }
  graph: {
    stats(projectId: string): Promise<GraphStats>
    neighbors(projectId: string, q: NeighborQuery): Promise<Neighborhood>
    node(projectId: string, id: string): Promise<GraphNode>
    code(projectId: string, file: string, start?: number, end?: number): Promise<CodeSlice>
  }
}
