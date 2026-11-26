import type { PathConfidence } from '@nexgraph/contracts/graph-types'
import { formatNumber } from './locale'
import { msg, type Message } from './messages'

/**
 * Câu thông báo đường đi / câu hỏi trên graph dựng bằng khoá `Msg` thay vì dictionary `vi.path.*`
 * đã dịch sẵn: state giữ khoá và dịch lúc render, đổi ngôn ngữ tại chỗ vẫn đổi câu (M4 review #57).
 */
const levelLabel = (confidence: PathConfidence): Message =>
  msg(confidence.level === 'EXTRACTED' ? 'trích từ mã' : confidence.level === 'INFERRED' ? 'suy luận' : 'chưa chắc')

export const pathNoLink = (): Message => msg('Không tìm thấy liên kết trực tiếp trong graph')

export function pathFound(hops: number, confidence: PathConfidence | null = null): Message {
  if (!confidence) return msg('Đường đi {hops} bước', { hops })
  const level = levelLabel(confidence)
  if (confidence.score === null) return msg('Đường đi {hops} bước · tin cậy: {level}', { hops, level })
  return msg('Đường đi {hops} bước · tin cậy: {level} {score} (bước {hop})', {
    hops,
    level,
    score: formatNumber(confidence.score),
    hop: confidence.hop
  })
}

/** Câu hỏi trên graph: không khớp node nào, bị cắt theo ngân sách token, hoặc không có gì để nói. */
export function askNotice(nodes: number, truncated: boolean): Message | null {
  if (nodes === 0) return msg('Không tìm thấy node nào khớp câu hỏi')
  return truncated ? msg('Đã cắt theo ngân sách 2.000 token') : null
}
