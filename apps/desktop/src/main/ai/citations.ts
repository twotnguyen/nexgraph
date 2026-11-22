import type { Citation } from '../../shared/graph-types'
import { parseCitations } from '../../shared/citations'
import type { EngineApi } from '../engine/api'

export { CITATION_SOURCE, type ParsedCitation, parseCitations } from '../../shared/citations'

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
