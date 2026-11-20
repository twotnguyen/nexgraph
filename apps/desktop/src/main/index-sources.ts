import type { IndexOptions, IndexSources } from '../shared/graph-types'
import { readJson, writeJson, type SecretStore } from './ai/settings'

/**
 * Nguồn bổ sung của lần index (W11), theo dự án.
 * Lựa chọn (không bí mật) nằm trong tệp JSON; DSN PostgreSQL nằm trong kho khoá và chỉ rời main trong thân request tới engine.
 */
export class IndexSourceStore {
  constructor(private readonly file: string, private readonly secrets: SecretStore) {}

  hasDsn(pid: string): boolean {
    return !!this.secrets.get(`pg:${pid}`)
  }

  saveDsn(pid: string, dsn: string | null): void {
    if (dsn?.trim()) this.secrets.set(`pg:${pid}`, dsn.trim())
    else this.secrets.remove(`pg:${pid}`)
  }

  remembered(pid: string): IndexSources | null {
    return (readJson(this.file)[pid] as IndexSources | undefined) ?? null
  }

  /** Hộp thoại gửi `sources` thì nhớ lại; nút "Index lại" không gửi thì dùng bản đã nhớ để nguồn không bị rơi. */
  resolve(pid: string, opts?: IndexOptions): { opts: IndexOptions | undefined; postgresDsn?: string } {
    if (opts?.sources) writeJson(this.file, { ...readJson(this.file), [pid]: opts.sources })
    const sources = opts?.sources ?? this.remembered(pid)
    if (!sources) return { opts }
    const dsn = sources.postgres ? this.secrets.get(`pg:${pid}`) : null
    return { opts: { ...opts, sources }, ...(dsn ? { postgresDsn: dsn } : {}) }
  }
}
