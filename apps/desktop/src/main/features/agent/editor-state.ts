import { realpathSync } from 'node:fs'
import { relative, sep } from 'node:path'
import type { AgentEditorState } from '../../../shared/agent-types'
import { FsError, resolveInside } from '../../platform/project-fs'

/** Đồng bộ dirty state trước khi gửi câu hỏi, duyệt ghi hoặc hoàn tác. */
export class EditorStateRegistry {
  private readonly states = new Map<string, AgentEditorState[]>()
  private readonly pending = new Map<string, Promise<void>>()
  private readonly revisions = new Map<string, number>()
  private readonly generations = new Map<string, number>()
  private readonly validating = new Map<string, number>()
  private readonly failures = new Map<string, unknown>()

  constructor(private readonly rootOf: (projectId: string) => Promise<string>) {}

  get(projectId: string): AgentEditorState[] {
    if (this.validating.has(projectId)) throw new FsError('conflict', 'Đang đồng bộ trạng thái editor. Hãy thử lại sau khi bản nháp được xác nhận.')
    if (this.failures.has(projectId)) throw this.failures.get(projectId)
    return this.states.get(projectId) ?? []
  }

  update(projectId: string, states: AgentEditorState[]): Promise<void> {
    const revision = (this.revisions.get(projectId) ?? 0) + 1
    const generation = this.generations.get(projectId) ?? 0
    this.revisions.set(projectId, revision)
    this.validating.set(projectId, revision)
    const work = (async () => {
      if (!Array.isArray(states) || states.length > 1_000) throw new FsError('bad_param', 'Trạng thái editor không hợp lệ')
      const root = realpathSync.native(await this.rootOf(projectId))
      const validated = new Map<string, AgentEditorState>()
      for (const state of states) {
        if (!state || typeof state.file !== 'string' || state.file.length > 2_000 || typeof state.dirty !== 'boolean' ||
            (state.version !== undefined && (typeof state.version !== 'string' || state.version.length > 256))) {
          throw new FsError('bad_param', 'Trạng thái tệp không hợp lệ')
        }
        const file = relative(root, resolveInside(root, state.file)).split(sep).join('/')
        const key = process.platform === 'win32' ? file.toLowerCase() : file
        validated.set(key, { file, dirty: state.dirty || validated.get(key)?.dirty === true,
          ...(state.version ? { version: state.version } : {}) })
      }
      if (this.revisions.get(projectId) === revision && (this.generations.get(projectId) ?? 0) === generation) {
        this.states.set(projectId, [...validated.values()])
        this.failures.delete(projectId)
      }
    })()
    this.pending.set(projectId, work)
    const settled = (error?: unknown) => {
      if (this.validating.get(projectId) !== revision) return
      this.validating.delete(projectId)
      if (error) this.failures.set(projectId, error)
    }
    void work.then(() => settled(), settled)
    // Giữ lỗi trong barrier cho thao tác ghi tiếp theo, đồng thời tránh rejection không được xử lý.
    void work.catch(() => {})
    return work
  }

  async wait(projectId: string): Promise<void> {
    const generation = this.generations.get(projectId) ?? 0
    for (;;) {
      const pending = this.pending.get(projectId)
      try { await pending } catch (error) {
        if (this.pending.get(projectId) === pending) throw error
      }
      if ((this.generations.get(projectId) ?? 0) !== generation) throw new FsError('conflict', 'Dự án đã đóng trong lúc đồng bộ editor')
      if (this.pending.get(projectId) === pending) return
    }
  }

  clear(projectId: string): void {
    this.generations.set(projectId, (this.generations.get(projectId) ?? 0) + 1)
    this.revisions.set(projectId, (this.revisions.get(projectId) ?? 0) + 1)
    this.pending.delete(projectId)
    this.validating.delete(projectId)
    this.failures.delete(projectId)
    this.states.delete(projectId)
  }

  clearAll(): void {
    for (const projectId of new Set([...this.pending.keys(), ...this.states.keys()])) this.clear(projectId)
  }
}
