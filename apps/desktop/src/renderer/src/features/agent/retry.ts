import type { AgentEvent } from '@nexgraph/contracts/agent-types'
import { tr } from '../../i18n/strings'

type RetryEvent = Extract<AgentEvent, { type: 'retry' }>

/**
 * Câu người dùng đọc được cho một lần thử lại. `event.message` là chi tiết SDK thô
 * (`terminated: other side closed (UND_ERR_SOCKET)`): hữu ích khi gỡ lỗi nhưng không phải câu
 * giải thích, nên chỉ hiện trong mục “Chi tiết kỹ thuật”.
 */
export function retryReason(raw: string): string {
  if (/429|rate.?limit|too many requests|quota|resource_exhausted/i.test(raw)) {
    return tr('Nhà cung cấp AI đang giới hạn tốc độ hoặc hết hạn mức.')
  }
  if (/ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network|fetch failed|terminated|other side closed|premature close|UND_ERR|EPIPE|reset by peer|hang up|stream ended/i.test(raw)) {
    return tr('Không kết nối được tới nhà cung cấp AI.')
  }
  if (/\b5\d\d\b|server error|internal error|overloaded|unavailable|bad gateway/i.test(raw)) {
    return tr('Nhà cung cấp AI tạm thời gặp lỗi.')
  }
  return tr('Nhà cung cấp AI chưa trả lời được.')
}

/** Dòng trạng thái khi Pi tự thử lại; không chứa chi tiết hạ tầng thô. */
export function retryNotice(event: RetryEvent): string {
  return tr('Đang thử lại {attempt}/{max} sau {seconds} giây. {message}', {
    attempt: event.attempt,
    max: event.maxAttempts,
    seconds: Math.ceil(event.delayMs / 1000),
    message: retryReason(event.message)
  })
}
