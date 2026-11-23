import type { Citation } from '../../shared/graph-types'
import { parseCitations } from '../../shared/citations'
import type { EngineApi } from '../engine/api'

export { CITATION_SOURCE, type ParsedCitation, parseCitations } from '../../shared/citations'

/**
 * Đường dẫn không ngoặc có thể dính chữ của câu đứng trước (“Theo flow app/service.py”): thử nguyên cụm
 * trước, rồi bỏ dần từ đầu cho tới khi engine nhận ra tệp. Nhờ vậy đường dẫn có dấu cách vẫn mở đúng
 * tệp mà không phải đoán bằng regex.
 */
function candidates(file: string): string[] {
  if (!file.includes(' ')) return [file]
  const parts = file.split(' ')
  return [file, ...parts.slice(1).map((_, i) => parts.slice(i + 1).join(' '))]
}

/** Hợp lệ khi tệp đã index và khoảng dòng nằm trong tệp; mọi lỗi khác của engine cũng là không kiểm chứng được. */
export async function verifyCitations(api: EngineApi, projectId: string, text: string): Promise<Citation[]> {
  return Promise.all(parseCitations(text).map(async (c): Promise<Citation> => {
    let reason: Citation['reason'] = 'file_not_found'
    for (const file of candidates(c.file)) {
      try {
        const slice = await api.code(projectId, file, c.start, c.end)
        if (slice.end >= c.end && slice.text !== '') return { ...c, file, valid: true, reason: null }
        reason = 'out_of_range'
      } catch (err) {
        if ((err as { code?: string }).code !== 'file_not_found') reason = 'out_of_range'
      }
    }
    return { ...c, valid: false, reason }
  }))
}
