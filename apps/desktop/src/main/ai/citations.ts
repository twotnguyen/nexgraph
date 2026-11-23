import type { Citation } from '../../shared/graph-types'
import { parseCitations } from '../../shared/citations'
import type { EngineApi } from '../engine/api'

export { CITATION_SOURCE, type ParsedCitation, parseCitations } from '../../shared/citations'

/**
 * Trần số đường dẫn thử cho mỗi trích dẫn không ngoặc. Mỗi ứng viên là một lời gọi `code()` cục bộ;
 * không giới hạn thì một câu dài có thể thử hàng chục lần. Thực tế model chỉ viết vài chữ tiếng Anh
 * trước đường dẫn (“Theo flow app/service.py”) vì ký tự có dấu phá chuỗi regex, nên trần 6 vẫn giữ
 * đúng các dạng đã kiểm. Quá trần thì trích dẫn thành chip khoá (`file_not_found`) — không có chip giả.
 */
const MAX_CANDIDATES = 6

/**
 * Đường dẫn không ngoặc có thể dính chữ của câu đứng trước (“Theo flow app/service.py”): thử nguyên cụm
 * trước, rồi bỏ dần từ đầu cho tới khi engine nhận ra tệp. Nhờ vậy đường dẫn có dấu cách vẫn mở đúng
 * tệp mà không phải đoán bằng regex.
 */
export function candidates(file: string): string[] {
  if (!file.includes(' ')) return [file]
  const parts = file.split(' ').filter(Boolean)
  const seen = new Set<string>()
  const out: string[] = []
  for (let i = 0; i < parts.length && out.length < MAX_CANDIDATES; i++) {
    const candidate = parts.slice(i).join(' ')
    if (seen.has(candidate)) continue
    seen.add(candidate)
    out.push(candidate)
  }
  return out
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
