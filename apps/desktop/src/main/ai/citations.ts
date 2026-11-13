import type { Citation } from '../../shared/graph-types'
import type { EngineApi } from '../engine/api'

const CITE = /\[\[([^[\]\s:]+(?:\.[A-Za-z0-9]+)):(\d+)(?:[-–](\d+))?\]\]/g

export function parseCitations(text: string): { raw: string; file: string; start: number; end: number }[] {
  const seen = new Set<string>()
  const out: { raw: string; file: string; start: number; end: number }[] = []
  for (const m of text.matchAll(CITE)) {
    if (seen.has(m[0])) continue
    seen.add(m[0])
    const start = Number(m[2])
    out.push({ raw: m[0], file: m[1], start, end: m[3] ? Number(m[3]) : start })
  }
  return out
}

/** Hợp lệ khi tệp đã index và khoảng dòng nằm trong tệp; mọi lỗi khác của engine cũng là không kiểm chứng được. */
export async function verifyCitations(api: EngineApi, projectId: string, text: string): Promise<Citation[]> {
  return Promise.all(parseCitations(text).map(async (c): Promise<Citation> => {
    try {
      const slice = await api.code(projectId, c.file, c.start, c.end)
      return slice.end >= c.end && slice.text !== '' ? { ...c, valid: true, reason: null } : { ...c, valid: false, reason: 'out_of_range' }
    } catch (err) {
      const code = (err as { code?: string }).code
      return { ...c, valid: false, reason: code === 'file_not_found' ? 'file_not_found' : 'out_of_range' }
    }
  }))
}
